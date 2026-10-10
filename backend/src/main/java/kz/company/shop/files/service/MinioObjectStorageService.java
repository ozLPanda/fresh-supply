package kz.company.shop.files.service;

import io.minio.*;
import java.io.InputStream;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.config.ObjectStorageConfig;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

@Service
@Profile("!desktop")
public class MinioObjectStorageService extends ObjectStorageService {
    private final MinioClient client;
    private final String bucket;

    public MinioObjectStorageService(
            MinioClient client, ObjectStorageConfig.Properties properties) {
        this.client = client;
        this.bucket = properties.bucket();
    }

    @Override
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

    @Override
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

    @Override
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

    @Override
    public java.util.Set<String> listObjectKeys() {
        try {
            var keys = new java.util.TreeSet<String>();
            for (var result :
                    client.listObjects(
                            ListObjectsArgs.builder().bucket(bucket).recursive(true).build())) {
                var item = result.get();
                if (!item.isDir()) keys.add(item.objectName());
            }
            return keys;
        } catch (Exception ex) {
            throw new AppExceptions.BadRequest("Не удалось прочитать список файлов хранилища");
        }
    }

    @Override
    public String fingerprint(String objectKey) {
        try {
            var stat =
                    client.statObject(
                            StatObjectArgs.builder().bucket(bucket).object(objectKey).build());
            return stat.etag() + ":" + stat.size() + ":" + stat.lastModified();
        } catch (Exception ex) {
            throw new AppExceptions.NotFound("Файл не найден");
        }
    }

    @Override
    public void delete(String objectKey) {
        try {
            client.removeObject(
                    RemoveObjectArgs.builder().bucket(bucket).object(objectKey).build());
        } catch (Exception ex) {
            throw new AppExceptions.BadRequest("Не удалось удалить файл");
        }
    }
}
