package kz.company.shop.files.service;

import static org.assertj.core.api.Assertions.*;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import kz.company.shop.common.exception.AppExceptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DesktopObjectStorageServiceTest {
    @TempDir Path directory;

    @Test
    void persistsBytesMimeAndHashAcrossServiceRestart() throws Exception {
        var storage = new DesktopObjectStorageService(directory.toString());
        byte[] content = "Документ".getBytes(StandardCharsets.UTF_8);
        storage.put(
                "invoices/one.pdf",
                new ByteArrayInputStream(content),
                content.length,
                "application/pdf");
        var restarted = new DesktopObjectStorageService(directory.toString());
        var object = restarted.get("invoices/one.pdf");
        try (var stream = object.stream()) {
            assertThat(stream.readAllBytes()).isEqualTo(content);
        }
        assertThat(object.size()).isEqualTo(content.length);
        assertThat(object.contentType()).isEqualTo("application/pdf");
        assertThat(restarted.contentHash("invoices/one.pdf"))
                .isEqualTo(storage.contentHash("invoices/one.pdf"));
    }

    @Test
    void failedReplacementPreservesOldObjectAndCleansTemporaryFile() throws Exception {
        var storage = new DesktopObjectStorageService(directory.toString());
        storage.put("file", new ByteArrayInputStream(new byte[] {1}), 1, "text/plain");
        assertThatThrownBy(
                        () ->
                                storage.put(
                                        "file",
                                        new ByteArrayInputStream(new byte[] {2}),
                                        100,
                                        "text/html"))
                .isInstanceOf(AppExceptions.BadRequest.class);
        var object = storage.get("file");
        try (var stream = object.stream()) {
            assertThat(stream.readAllBytes()).containsExactly((byte) 1);
        }
        assertThat(object.contentType()).isEqualTo("text/plain");
        try (var files = Files.list(directory)) {
            assertThat(files.count()).isEqualTo(1);
        }
    }

    @Test
    void traversalKeysStayInsideStorageAndDeleteIsIdempotent() throws Exception {
        var storage = new DesktopObjectStorageService(directory.toString());
        storage.put("../../escape", new ByteArrayInputStream(new byte[] {1}), 1, "text/plain");
        try (var files = Files.list(directory)) {
            assertThat(files.toList()).allMatch(path -> path.getParent().equals(directory));
        }
        storage.delete("../../escape");
        storage.delete("../../escape");
        assertThatThrownBy(() -> storage.get("../../escape"))
                .isInstanceOf(AppExceptions.NotFound.class);
    }

    @Test
    void openedReaderRetainsOriginalSizeAndBytesAfterAtomicOverwrite() throws Exception {
        var storage = new DesktopObjectStorageService(directory.toString());
        storage.put("file", new ByteArrayInputStream(new byte[] {1}), 1, "text/plain");
        var first = storage.get("file");
        try (var input = first.stream()) {
            storage.put("file", new ByteArrayInputStream(new byte[] {2, 3}), 2, "text/plain");
            assertThat(first.size()).isEqualTo(1);
            assertThat(input.readAllBytes()).containsExactly((byte) 1);
        }
    }
}
