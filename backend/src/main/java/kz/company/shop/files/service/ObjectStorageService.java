package kz.company.shop.files.service;

import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.StatObjectArgs;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.config.ObjectStorageConfig;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

@Service
public class ObjectStorageService {
    private final MinioClient client;
    private final String bucket;

    public ObjectStorageService(MinioClient client, ObjectStorageConfig.Properties properties) {
        this.client = client;
        this.bucket = properties.bucket();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ensureBucket() {
        try {
            if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
                client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
            }
        } catch (Exception ex) {
            throw new IllegalStateException("Не удалось подготовить файловое хранилище", ex);
        }
    }

    public void put(String objectKey, InputStream stream, long size, String contentType) {
        try {
            client.putObject(
                    PutObjectArgs.builder().bucket(bucket).object(objectKey).stream(
                                    stream, size, -1)
                            .contentType(contentType)
                            .build());
        } catch (Exception ex) {
            throw new AppExceptions.BadRequest("Не удалось сохранить файл");
        }
    }

    public StoredObject get(String objectKey) {
        try {
            var metadata =
                    client.statObject(
                            StatObjectArgs.builder().bucket(bucket).object(objectKey).build());
            var stream =
                    client.getObject(
                            GetObjectArgs.builder().bucket(bucket).object(objectKey).build());
            return new StoredObject(stream, metadata.size(), metadata.contentType());
        } catch (Exception ex) {
            throw new AppExceptions.NotFound("Файл не найден");
        }
    }

    public void delete(String objectKey) {
        try {
            client.removeObject(
                    RemoveObjectArgs.builder().bucket(bucket).object(objectKey).build());
        } catch (Exception ex) {
            throw new AppExceptions.BadRequest("Не удалось удалить файл");
        }
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
