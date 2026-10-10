package kz.company.shop.files.service;

import kz.company.shop.common.exception.AppExceptions;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.nio.channels.Channels;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Native storage: one atomically replaced object includes MIME metadata and file bytes. */
@Service
@Profile("desktop")
public class DesktopObjectStorageService extends ObjectStorageService {
    private static final int MAGIC = 0x4F564F31;
    // Bounded locks also coordinate service instances using the same storage directory.
    private static final Object[] OBJECT_LOCKS = new Object[64];

    static {
        for (int index = 0; index < OBJECT_LOCKS.length; index++) {
            OBJECT_LOCKS[index] = new Object();
        }
    }

    private final Path root;
    private final boolean snapshotReads;

    @Autowired
    public DesktopObjectStorageService(@Value("${app.files.storage.directory}") String directory) {
        this(directory, System.getProperty("os.name", "").startsWith("Windows"));
    }

    // Exercise Windows snapshot semantics on every platform without changing global OS properties.
    DesktopObjectStorageService(String directory, boolean snapshotReads) {
        this.snapshotReads = snapshotReads;
        try {
            Path configured = Path.of(directory).toAbsolutePath().normalize();
            Files.createDirectories(configured);
            this.root = configured.toRealPath();
        } catch (Exception ex) {
            throw new IllegalStateException("Не удалось подготовить файловое хранилище", ex);
        }
    }

    @Override
    public void ensureBucket() {
        if (!Files.isDirectory(root) || !Files.isWritable(root)) {
            throw new IllegalStateException("Файловое хранилище недоступно");
        }
    }

    @Override
    public void put(String objectKey, InputStream stream, long size, String contentType) {
        Path temporary = null;
        try {
            Path target = objectPath(objectKey);
            temporary = Files.createTempFile(root, ".upload-", ".tmp");
            try (var output = new DataOutputStream(Files.newOutputStream(temporary))) {
                output.writeInt(MAGIC);
                output.writeUTF(contentType == null ? "application/octet-stream" : contentType);
                long copied = stream.transferTo(output);
                if (size >= 0 && size != copied)
                    throw new IllegalArgumentException("Size mismatch");
            }
            synchronized (objectLock(target)) {
                Files.move(
                        temporary,
                        target,
                        StandardCopyOption.ATOMIC_MOVE,
                        StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (Exception ex) {
            throw new AppExceptions.BadRequest("Не удалось сохранить файл");
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (Exception ignored) {
                }
            }
        }
    }

    @Override
    public StoredObject get(String objectKey) {
        DataInputStream input = null;
        try {
            Path path = objectPath(objectKey);
            FileChannel channel = openReader(path);
            input = new DataInputStream(Channels.newInputStream(channel));
            long storedSize = channel.size();
            if (input.readInt() != MAGIC) throw new IllegalStateException("Invalid object header");
            String contentType = input.readUTF();
            // Modified UTF-8 is measured from the actual encoded header, not String.length().
            var header = new java.io.ByteArrayOutputStream();
            try (var output = new DataOutputStream(header)) {
                output.writeInt(MAGIC);
                output.writeUTF(contentType);
            }
            return new StoredObject(input, storedSize - header.size(), contentType);
        } catch (Exception ex) {
            if (input != null) {
                try {
                    input.close();
                } catch (Exception ignored) {
                }
            }
            throw new AppExceptions.NotFound("Файл не найден");
        }
    }

    @Override
    public String fingerprint(String objectKey) {
        try {
            var attributes =
                    Files.readAttributes(
                            objectPath(objectKey),
                            java.nio.file.attribute.BasicFileAttributes.class,
                            LinkOption.NOFOLLOW_LINKS);
            return attributes.size()
                    + ":"
                    + attributes.lastModifiedTime()
                    + ":"
                    + attributes.fileKey();
        } catch (Exception ex) {
            throw new AppExceptions.NotFound("Файл не найден");
        }
    }

    @Override
    public void delete(String objectKey) {
        try {
            Path target = objectPath(objectKey);
            synchronized (objectLock(target)) {
                Files.deleteIfExists(target);
            }
        } catch (Exception ex) {
            throw new AppExceptions.BadRequest("Не удалось удалить файл");
        }
    }

    private FileChannel openReader(Path path) throws Exception {
        synchronized (objectLock(path)) {
            if (!snapshotReads) {
                return FileChannel.open(path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS);
            }
            // Windows cannot replace an object while its original read handle is open.
            // Keep immutable bytes on disk rather than buffering an arbitrary object in memory.
            // OS-managed delete-on-close also removes snapshots after process termination.
            Path snapshot = Files.createTempFile("fresh-supply-object-", ".tmp");
            FileChannel reader = null;
            try {
                reader =
                        FileChannel.open(
                                snapshot,
                                StandardOpenOption.READ,
                                StandardOpenOption.WRITE,
                                StandardOpenOption.DELETE_ON_CLOSE,
                                LinkOption.NOFOLLOW_LINKS);
                try (FileChannel source =
                        FileChannel.open(
                                path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
                    Channels.newInputStream(source).transferTo(Channels.newOutputStream(reader));
                }
                reader.position(0);
                return reader;
            } catch (Exception ex) {
                if (reader != null) {
                    try {
                        reader.close();
                    } catch (Exception cleanupFailure) {
                        ex.addSuppressed(cleanupFailure);
                    }
                }
                try {
                    Files.deleteIfExists(snapshot);
                } catch (Exception cleanupFailure) {
                    ex.addSuppressed(cleanupFailure);
                }
                throw ex;
            }
        }
    }

    private static Object objectLock(Path path) {
        return OBJECT_LOCKS[Math.floorMod(path.hashCode(), OBJECT_LOCKS.length)];
    }

    private Path objectPath(String objectKey) throws Exception {
        if (objectKey == null || objectKey.isBlank())
            throw new IllegalArgumentException("Empty object key");
        // Hash keys instead of resolving paths supplied by callers; traversal cannot escape root.
        String name =
                HexFormat.of()
                        .formatHex(
                                MessageDigest.getInstance("SHA-256")
                                        .digest(objectKey.getBytes(StandardCharsets.UTF_8)));
        return root.resolve(name + ".object");
    }
}
