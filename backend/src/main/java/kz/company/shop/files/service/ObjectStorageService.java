package kz.company.shop.files.service;

import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import kz.company.shop.common.exception.AppExceptions;

public abstract class ObjectStorageService {
    public abstract void ensureBucket();

    public abstract void put(String objectKey, InputStream stream, long size, String contentType);

    public abstract StoredObject get(String objectKey);

    public abstract void delete(String objectKey);

    /** Extra stored keys, including objects not currently referenced by business rows. */
    public java.util.Set<String> listObjectKeys() {
        return java.util.Set.of();
    }

    /** Detect concurrent external replacement while a snapshot is reading the object. */
    public String fingerprint(String objectKey) {
        return contentHash(objectKey);
    }

    public String contentHash(String objectKey) {
        MessageDigest digest = sha256();
        try (InputStream stream = get(objectKey).stream()) {
            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = stream.read(buffer)) >= 0) {
                digest.update(buffer, 0, bytesRead);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (AppExceptions.NotFound ex) {
            throw ex;
        } catch (Exception ex) {
            throw new AppExceptions.NotFound("Файл не найден");
        }
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 недоступен", ex);
        }
    }

    public record StoredObject(InputStream stream, long size, String contentType) {}
}
