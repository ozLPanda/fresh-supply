package kz.company.shop.files.service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class FileStorageService {
    private static final Set<String> ALLOWED_TYPES =
            Set.of("image/jpeg", "image/png", "image/webp");
    private static final Set<String> PROCUREMENT_DOCUMENT_TYPES =
            Set.of(
                    "image/jpeg",
                    "image/png",
                    "image/webp",
                    "application/pdf",
                    "text/plain",
                    "text/csv",
                    "application/msword",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "application/vnd.ms-excel",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    private final ObjectStorageService objectStorage;

    public FileStorageService(ObjectStorageService objectStorage) {
        this.objectStorage = objectStorage;
    }

    public StoredFile saveProductImage(MultipartFile file) {
        return saveImage(file);
    }

    public StoredFile saveReviewImage(MultipartFile file) {
        return saveImage(file);
    }

    public StoredFile saveProcurementDocument(MultipartFile file) {
        if (file.isEmpty()
                || file.getContentType() == null
                || !PROCUREMENT_DOCUMENT_TYPES.contains(file.getContentType())) {
            throw new AppExceptions.BadRequest(
                    "Разрешены PDF, текстовые документы, таблицы и изображения JPEG, PNG, WEBP");
        }
        if (file.getSize() > 50L * 1024 * 1024) {
            throw new AppExceptions.BadRequest("Размер файла не должен превышать 50 МБ");
        }
        return save(file, "procurement/");
    }

    private StoredFile saveImage(MultipartFile file) {
        if (file.isEmpty()
                || file.getContentType() == null
                || !ALLOWED_TYPES.contains(file.getContentType())) {
            throw new AppExceptions.BadRequest("Разрешены только JPEG, PNG и WEBP");
        }
        return save(file, "");
    }

    private StoredFile save(MultipartFile file, String prefix) {
        try {
            String original = Optional.ofNullable(file.getOriginalFilename()).orElse("file");
            String ext =
                    original.contains(".")
                            ? original.substring(original.lastIndexOf('.')).toLowerCase()
                            : ".bin";
            String name = prefix + UUID.randomUUID() + ext;
            MessageDigest digest = sha256();
            try (InputStream source = file.getInputStream();
                    InputStream stream = new DigestInputStream(source, digest)) {
                objectStorage.put("uploads/" + name, stream, file.getSize(), file.getContentType());
            }
            return new StoredFile(
                    name, original, "/uploads/" + name, HexFormat.of().formatHex(digest.digest()));
        } catch (IOException ex) {
            throw new AppExceptions.BadRequest("Не удалось сохранить файл");
        }
    }

    public void deleteProductImage(String fileName) {
        if (!isSafeObjectKey(fileName)) {
            throw new AppExceptions.BadRequest("Некорректный путь к изображению");
        }
        objectStorage.delete("uploads/" + fileName);
    }

    public void deleteProcurementDocument(String fileName) {
        if (!isSafeObjectKey(fileName) || !fileName.startsWith("procurement/")) {
            throw new AppExceptions.BadRequest("Некорректный путь к файлу");
        }
        objectStorage.delete("uploads/" + fileName);
    }

    public void updateProcurementTextDocument(String fileName, byte[] content) {
        if (!isSafeObjectKey(fileName) || !fileName.startsWith("procurement/")) {
            throw new AppExceptions.BadRequest("Некорректный путь к файлу");
        }
        objectStorage.put(
                "uploads/" + fileName,
                new ByteArrayInputStream(content),
                content.length,
                "text/plain");
    }

    public String contentHash(String fileName) {
        if (!isSafeObjectKey(fileName)) {
            throw new AppExceptions.NotFound("Файл не найден");
        }
        return objectStorage.contentHash("uploads/" + fileName);
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 недоступен", ex);
        }
    }

    private static boolean isSafeObjectKey(String key) {
        return key != null
                && !key.isBlank()
                && !key.startsWith("/")
                && !key.contains("\\")
                && !key.equals("..")
                && !key.startsWith("../")
                && !key.contains("/../");
    }

    public record StoredFile(
            String fileName, String originalFileName, String publicPath, String contentHash) {}
}
