package kz.company.shop.files.controller;

import java.nio.charset.StandardCharsets;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.ObjectStorageService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

@Controller
public class FileDownloadController {
    private final ObjectStorageService storage;

    public FileDownloadController(ObjectStorageService storage) {
        this.storage = storage;
    }

    @GetMapping("/uploads/{*objectKey}")
    public ResponseEntity<StreamingResponseBody> download(@PathVariable String objectKey) {
        String key = normalizeKey(objectKey);
        if (key.startsWith("procurement/")) {
            throw new AppExceptions.NotFound("Файл не найден");
        }
        var object = storage.get("uploads/" + key);
        String filename = key.substring(key.lastIndexOf('/') + 1);
        MediaType contentType = safeContentType(object.contentType(), filename);
        boolean isImage = "image".equalsIgnoreCase(contentType.getType());
        var disposition =
                (isImage ? ContentDisposition.inline() : ContentDisposition.attachment())
                        .filename(filename, StandardCharsets.UTF_8)
                        .build();

        StreamingResponseBody body =
                output -> {
                    try (var stream = object.stream()) {
                        stream.transferTo(output);
                    }
                };
        return ResponseEntity.ok()
                .contentType(contentType)
                .contentLength(object.size())
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .header(
                        HttpHeaders.CACHE_CONTROL,
                        isImage ? "public, max-age=31536000, immutable" : "private, no-store")
                .body(body);
    }

    private static String normalizeKey(String objectKey) {
        String key = objectKey == null ? "" : objectKey.replaceFirst("^/+", "");
        if (key.isBlank()
                || key.startsWith("/")
                || key.contains("\\")
                || key.equals("..")
                || key.startsWith("../")
                || key.contains("/../")) {
            throw new AppExceptions.NotFound("Файл не найден");
        }
        return key;
    }

    private static MediaType safeContentType(String contentType, String filename) {
        try {
            MediaType parsed = MediaType.parseMediaType(contentType);
            if (!MediaType.APPLICATION_OCTET_STREAM.includes(parsed)) {
                return parsed;
            }
        } catch (IllegalArgumentException | NullPointerException ignored) {
        }
        return MediaTypeFactory.getMediaType(filename).orElse(MediaType.APPLICATION_OCTET_STREAM);
    }
}
