package kz.company.shop.datatransfer;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.DataOutputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.sql.DataSource;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.ObjectStorageService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class DataTransferExportService {
    public static final List<String> EXCLUDED_TABLES =
            List.of(
                    "auth_sessions",
                    "external_api_credentials",
                    "external_api_credential_permissions",
                    "external_api_request_logs",
                    "flyway_schema_history",
                    "web_push_subscriptions");
    private static final Map<String, String> FILE_COLUMNS =
            Map.of(
                    "categories",
                    "image_file_path",
                    "product_images",
                    "file_path",
                    "review_images",
                    "file_path",
                    "procurement_files",
                    "file_path");
    private final DataSource dataSource;
    private final ObjectMapper mapper;
    private final ObjectStorageService storage;
    private final DataTransferBarrier barrier;
    private final Path temporaryDirectory;

    public DataTransferExportService(
            DataSource dataSource,
            ObjectMapper mapper,
            ObjectStorageService storage,
            DataTransferBarrier barrier,
            @Value("${app.data-transfer.temp-dir:${java.io.tmpdir}/ovoshi-data-transfer}")
                    String temporaryDirectory) {
        this.dataSource = dataSource;
        this.mapper = mapper;
        this.storage = storage;
        this.barrier = barrier;
        this.temporaryDirectory = Path.of(temporaryDirectory);
    }

    public Archive export() {
        Path archive = null;
        try (var ignored = barrier.snapshot();
                var connection = dataSource.getConnection()) {
            Files.createDirectories(temporaryDirectory);
            archive = Files.createTempFile(temporaryDirectory, "snapshot-", ".zip");
            if (Files.getFileStore(archive).supportsFileAttributeView("posix")) {
                Files.setPosixFilePermissions(
                        archive, PosixFilePermissions.fromString("rw-------"));
            }
            connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            connection.setReadOnly(true);
            connection.setAutoCommit(false);
            try (var zip =
                    new ZipOutputStream(Files.newOutputStream(archive), StandardCharsets.UTF_8)) {
                writeSnapshot(connection, zip);
            } finally {
                connection.rollback();
            }
            return new Archive(archive, Files.size(archive));
        } catch (Exception ex) {
            if (archive != null) {
                try {
                    Files.deleteIfExists(archive);
                } catch (IOException ignored) {
                }
            }
            if (ex instanceof AppExceptions.BadRequest bad) throw bad;
            if (ex instanceof AppExceptions.NotFound) throw incompleteFiles();
            // JDBC/storage exceptions can contain source details; return a deliberately generic
            // error.
            throw new AppExceptions.BadRequest(
                    "Не удалось подготовить полный архив данных и файлов. Повторите экспорт.");
        }
    }

    void writeSnapshot(Connection connection, ZipOutputStream zip) throws Exception {
        var tables = new ArrayList<TableManifest>();
        var references = new TreeMap<String, FileReference>();
        String schemaVersion = schemaVersion(connection);
        List<SequenceManifest> sequences = sequences(connection);
        List<String> excludedTables = excludedTables(connection);
        int index = 0;
        for (String table : tableNames(connection)) {
            List<ColumnManifest> columns = columns(connection, table);
            String entry = "tables/" + index++ + ".jsonl";
            zip.putNextEntry(new ZipEntry(entry));
            var output = new EntryOutput(zip);
            long rows = writeTable(connection, table, columns, output, references);
            zip.closeEntry();
            tables.add(new TableManifest(table, entry, columns, rows, output.size, output.hash()));
        }
        var fileKeys = new TreeSet<>(references.keySet());
        fileKeys.addAll(storage.listObjectKeys());
        var files = new ArrayList<FileManifest>();
        for (String key : fileKeys) {
            if (key == null || key.isBlank()) throw incompleteFiles();
            String entry = "files/" + hash(key.getBytes(StandardCharsets.UTF_8)) + ".object";
            String before = storage.fingerprint(key);
            var object = storage.get(key);
            try (var rawStream = object.stream()) {
                zip.putNextEntry(new ZipEntry(entry));
                var output = new EntryOutput(zip);
                var data = new DataOutputStream(output);
                data.writeInt(0x4F564F31);
                data.writeUTF(
                        object.contentType() == null
                                ? "application/octet-stream"
                                : object.contentType());
                var payloadHash = MessageDigest.getInstance("SHA-256");
                long copied;
                try (var stream = new DigestInputStream(rawStream, payloadHash)) {
                    copied = stream.transferTo(data);
                }
                data.flush();
                FileReference reference = references.get(key);
                String actualHash = HexFormat.of().formatHex(payloadHash.digest());
                if (copied != object.size()
                        || !before.equals(storage.fingerprint(key))
                        || reference != null && !reference.matches(copied, actualHash)) {
                    throw incompleteFiles();
                }
                zip.closeEntry();
                files.add(new FileManifest(key, entry, output.size, output.hash()));
            }
        }
        zip.putNextEntry(new ZipEntry("manifest.json"));
        var generator = mapper.getFactory().createGenerator(zip);
        generator.disable(JsonGenerator.Feature.AUTO_CLOSE_TARGET);
        mapper.writeValue(
                generator,
                new Manifest(
                        "ovoshi-help-data-transfer",
                        1,
                        Instant.now().toString(),
                        schemaVersion,
                        excludedTables,
                        tables,
                        files,
                        sequences));
        generator.close();
        zip.closeEntry();
    }

    private List<String> excludedTables(Connection connection) throws Exception {
        var excluded = new TreeSet<String>(EXCLUDED_TABLES);
        try (var statement =
                        connection.prepareStatement(
                                """
                select child.relname from pg_catalog.pg_class child
                join pg_catalog.pg_inherits i on i.inhrelid = child.oid
                join pg_catalog.pg_class parent on parent.oid = i.inhparent
                join pg_catalog.pg_namespace n on n.oid = parent.relnamespace
                where n.nspname = 'public' and parent.relname = 'external_api_request_logs'
                order by child.relname
                """);
                var rows = statement.executeQuery()) {
            while (rows.next()) excluded.add(rows.getString(1));
        }
        return List.copyOf(excluded);
    }

    private List<String> tableNames(Connection connection) throws Exception {
        var tables = new ArrayList<String>();
        try (var statement =
                        connection.prepareStatement(
                                """
                select c.relname from pg_catalog.pg_class c
                join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
                order by c.relname
                """);
                var rows = statement.executeQuery()) {
            while (rows.next()) {
                String name = rows.getString(1);
                if (!EXCLUDED_TABLES.contains(name)) tables.add(name);
            }
        }
        return tables;
    }

    private List<ColumnManifest> columns(Connection connection, String table) throws Exception {
        var columns = new ArrayList<ColumnManifest>();
        try (var statement =
                connection.prepareStatement(
                        """
                select a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod)
                from pg_catalog.pg_attribute a
                join pg_catalog.pg_class c on c.oid = a.attrelid
                join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relname = ? and a.attnum > 0 and not a.attisdropped
                order by a.attnum
                """)) {
            statement.setString(1, table);
            try (var rows = statement.executeQuery()) {
                while (rows.next())
                    columns.add(new ColumnManifest(rows.getString(1), rows.getString(2)));
            }
        }
        if (columns.isEmpty()) throw new IllegalStateException("Missing schema columns");
        return columns;
    }

    private long writeTable(
            Connection connection,
            String table,
            List<ColumnManifest> columns,
            OutputStream output,
            Map<String, FileReference> references)
            throws Exception {
        String selectColumns =
                columns.stream()
                        .map(column -> identifier(column.name()))
                        .collect(java.util.stream.Collectors.joining(","));
        try (PreparedStatement statement =
                connection.prepareStatement(
                        "select " + selectColumns + " from public." + identifier(table),
                        ResultSet.TYPE_FORWARD_ONLY,
                        ResultSet.CONCUR_READ_ONLY)) {
            // PostgreSQL JDBC buffers the entire fetched batch. Inline assistant photos and
            // import JSON can make one row tens of MiB, so such tables must fetch one row.
            boolean largeValues =
                    columns.stream()
                            .anyMatch(
                                    column -> {
                                        String type = column.type();
                                        return java.util.Set.of(
                                                                "text",
                                                                "json",
                                                                "jsonb",
                                                                "bytea",
                                                                "xml",
                                                                "character varying",
                                                                "bit varying")
                                                        .contains(type)
                                                || type.endsWith("[]");
                                    });
            statement.setFetchSize(largeValues ? 1 : 500);
            long count = 0;
            try (var rows = statement.executeQuery();
                    var generator = mapper.getFactory().createGenerator(output)) {
                generator.disable(JsonGenerator.Feature.AUTO_CLOSE_TARGET);
                generator.setRootValueSeparator(null);
                while (rows.next()) {
                    generator.writeStartArray();
                    Map<String, String> referenceColumns =
                            FILE_COLUMNS.containsKey(table) ? new LinkedHashMap<>() : null;
                    for (int i = 0; i < columns.size(); i++) {
                        String value = rows.getString(i + 1);
                        if (value == null) generator.writeNull();
                        else generator.writeString(value);
                        if (referenceColumns != null)
                            referenceColumns.put(columns.get(i).name(), value);
                    }
                    generator.writeEndArray();
                    generator.writeRaw('\n');
                    if (referenceColumns != null)
                        collectFileReference(table, referenceColumns, references);
                    count++;
                }
                generator.flush();
            }
            return count;
        }
    }

    private void collectFileReference(
            String table, Map<String, String> values, Map<String, FileReference> references) {
        String path = values.get(FILE_COLUMNS.get(table));
        if (path == null || !path.startsWith("/uploads/")) return;
        String key = path.substring(1);
        String expectedHash =
                values.get(table.equals("categories") ? "image_content_hash" : "content_hash");
        long size = values.get("file_size") == null ? -1 : Long.parseLong(values.get("file_size"));
        FileReference reference = new FileReference(expectedHash, size);
        references.merge(
                key,
                reference,
                (left, right) -> {
                    if (left.sha256 != null
                                    && right.sha256 != null
                                    && !left.sha256.equals(right.sha256)
                            || left.size >= 0 && right.size >= 0 && left.size != right.size)
                        throw incompleteFiles();
                    return new FileReference(
                            left.sha256 == null ? right.sha256 : left.sha256,
                            left.size < 0 ? right.size : left.size);
                });
    }

    private String schemaVersion(Connection connection) throws Exception {
        try (var statement =
                        connection.prepareStatement(
                                "select version from public.flyway_schema_history where success and version is not null order by installed_rank desc limit 1");
                var rows = statement.executeQuery()) {
            if (!rows.next()) throw new IllegalStateException("No migrated schema");
            return rows.getString(1);
        }
    }

    private List<SequenceManifest> sequences(Connection connection) throws Exception {
        var names = new ArrayList<String>();
        try (var statement =
                        connection.prepareStatement(
                                """
                select c.relname from pg_catalog.pg_class c
                join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind = 'S' order by c.relname
                """);
                var rows = statement.executeQuery()) {
            while (rows.next()) names.add(rows.getString(1));
        }
        var sequences = new ArrayList<SequenceManifest>();
        for (String name : names) {
            try (var statement =
                            connection.prepareStatement(
                                    "select last_value, is_called from public."
                                            + identifier(name));
                    var rows = statement.executeQuery()) {
                if (!rows.next()) throw new IllegalStateException("Missing sequence state");
                sequences.add(new SequenceManifest(name, rows.getString(1), rows.getBoolean(2)));
            }
        }
        return sequences;
    }

    private static AppExceptions.BadRequest incompleteFiles() {
        return new AppExceptions.BadRequest(
                "Архив не создан: один из связанных файлов отсутствует или изменился. Повторите экспорт после завершения операций с файлами.");
    }

    private static String identifier(String value) {
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private static String hash(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private record FileReference(String sha256, long size) {
        boolean matches(long actualSize, String actualHash) {
            return (size < 0 || size == actualSize)
                    && (sha256 == null || sha256.equalsIgnoreCase(actualHash));
        }
    }

    private static class EntryOutput extends FilterOutputStream {
        private final MessageDigest digest;
        private long size;

        EntryOutput(OutputStream delegate) throws Exception {
            super(delegate);
            digest = MessageDigest.getInstance("SHA-256");
        }

        @Override
        public void write(int value) throws IOException {
            out.write(value);
            digest.update((byte) value);
            size++;
        }

        @Override
        public void write(byte[] bytes, int offset, int length) throws IOException {
            out.write(bytes, offset, length);
            digest.update(bytes, offset, length);
            size += length;
        }

        @Override
        public void close() throws IOException {
            flush();
        }

        String hash() {
            return HexFormat.of().formatHex(digest.digest());
        }
    }

    public record ColumnManifest(String name, String type) {}

    public record TableManifest(
            String name,
            String entry,
            List<ColumnManifest> columns,
            long rowCount,
            long size,
            String sha256) {}

    public record FileManifest(String key, String entry, long size, String sha256) {}

    public record SequenceManifest(String name, String lastValue, boolean isCalled) {}

    public record Manifest(
            String format,
            int formatVersion,
            String createdAt,
            String schemaVersion,
            List<String> excludedTables,
            List<TableManifest> tables,
            List<FileManifest> files,
            List<SequenceManifest> sequences) {}

    public record Archive(Path path, long size) implements AutoCloseable {
        @Override
        public void close() throws IOException {
            Files.deleteIfExists(path);
        }
    }
}
