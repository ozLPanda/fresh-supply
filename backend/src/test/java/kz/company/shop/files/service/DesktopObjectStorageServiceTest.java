package kz.company.shop.files.service;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import kz.company.shop.common.exception.AppExceptions;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void failedReplacementPreservesOldObjectAndCleansTemporaryFile(boolean snapshots)
            throws Exception {
        var storage = new DesktopObjectStorageService(directory.toString(), snapshots);
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

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void openedReaderRetainsOriginalSizeAndBytesAfterAtomicOverwrite(boolean snapshots)
            throws Exception {
        // A direct original handle is the Unix implementation, unavailable on Windows.
        assumeTrue(snapshots || !System.getProperty("os.name", "").startsWith("Windows"));
        var storage = new DesktopObjectStorageService(directory.toString(), snapshots);
        storage.put("file", new ByteArrayInputStream(new byte[] {1}), 1, "text/plain");
        var first = storage.get("file");
        try (var input = first.stream()) {
            storage.put("file", new ByteArrayInputStream(new byte[] {2, 3}), 2, "text/html");
            assertThat(first.size()).isEqualTo(1);
            assertThat(first.contentType()).isEqualTo("text/plain");
            assertThat(input.readAllBytes()).containsExactly((byte) 1);
        }
        var replacement = storage.get("file");
        try (var input = replacement.stream()) {
            assertThat(replacement.size()).isEqualTo(2);
            assertThat(replacement.contentType()).isEqualTo("text/html");
            assertThat(input.readAllBytes()).containsExactly((byte) 2, (byte) 3);
        }
    }

    @Test
    void diskSnapshotRetainsBytesAfterDeletionWithoutAddingObjectsToStorage() throws Exception {
        var storage = new DesktopObjectStorageService(directory.toString(), true);
        storage.put("file", new ByteArrayInputStream(new byte[] {1, 2}), 2, "text/plain");
        var first = storage.get("file");
        try (var input = first.stream()) {
            storage.delete("file");
            assertThatThrownBy(() -> storage.get("file"))
                    .isInstanceOf(AppExceptions.NotFound.class);
            assertThat(first.size()).isEqualTo(2);
            assertThat(input.readAllBytes()).containsExactly((byte) 1, (byte) 2);
            try (var files = Files.list(directory)) {
                assertThat(files.count()).isZero();
            }
        }
    }

    @Test
    void concurrentSnapshotsAndReplacementsAcrossInstancesReturnCompleteObjects() throws Exception {
        var reader = new DesktopObjectStorageService(directory.toString(), true);
        var writer = new DesktopObjectStorageService(directory.toString(), true);
        byte[] small = new byte[128 * 1024];
        byte[] large = new byte[256 * 1024];
        java.util.Arrays.fill(small, (byte) 1);
        java.util.Arrays.fill(large, (byte) 2);
        writer.put("file", new ByteArrayInputStream(small), small.length, "text/plain");
        var start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var replacements =
                    executor.submit(
                            () -> {
                                start.await();
                                for (int index = 0; index < 32; index++) {
                                    byte[] bytes = index % 2 == 0 ? large : small;
                                    writer.put(
                                            "file",
                                            new ByteArrayInputStream(bytes),
                                            bytes.length,
                                            index % 2 == 0
                                                    ? "application/octet-stream"
                                                    : "text/plain");
                                }
                                return null;
                            });
            var reads =
                    executor.submit(
                            () -> {
                                start.await();
                                for (int index = 0; index < 64; index++) {
                                    var object = reader.get("file");
                                    try (var input = object.stream()) {
                                        byte[] expected =
                                                object.contentType().equals("text/plain")
                                                        ? small
                                                        : large;
                                        assertThat(object.size()).isEqualTo(expected.length);
                                        assertThat(input.readAllBytes()).isEqualTo(expected);
                                    }
                                }
                                return null;
                            });
            start.countDown();
            replacements.get(30, TimeUnit.SECONDS);
            reads.get(30, TimeUnit.SECONDS);
        }
        try (var files = Files.list(directory)) {
            assertThat(files.count()).isEqualTo(1);
        }
    }
}
