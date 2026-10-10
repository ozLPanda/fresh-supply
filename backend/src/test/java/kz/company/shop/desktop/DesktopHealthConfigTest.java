package kz.company.shop.desktop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;
import kz.company.shop.files.service.ObjectStorageService;
import kz.company.shop.search.EmbeddingProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.actuate.health.Status;

class DesktopHealthConfigTest {
    @TempDir Path root;

    @Test
    void readinessRequiresFrontendAndStorage() throws Exception {
        var config = new DesktopHealthConfig();
        var indicator =
                config.desktopStorageHealthIndicator(
                        mock(ObjectStorageService.class), root.toString());
        assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
        Files.writeString(root.resolve("index.html"), "app");
        assertThat(indicator.health().getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void readinessChecksEmbeddingModelAndDimensionsWithoutLeakingDetails() throws Exception {
        var response =
                new AtomicReference<>(
                        "{\"status\":\"ok\",\"model\":\"intfloat/multilingual-e5-base\",\"dimensions\":768}");
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/health",
                exchange -> {
                    byte[] bytes = response.get().getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, bytes.length);
                    try (var output = exchange.getResponseBody()) {
                        output.write(bytes);
                    }
                });
        server.start();
        try {
            var properties = new EmbeddingProperties();
            properties.setEnabled(true);
            properties.setUrl("http://127.0.0.1:" + server.getAddress().getPort());
            var indicator = new DesktopHealthConfig().desktopEmbeddingsHealthIndicator(properties);
            assertThat(indicator.health().getStatus()).isEqualTo(Status.UP);
            response.set("{\"status\":\"ok\",\"model\":\"wrong-model\",\"dimensions\":768}");
            assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
            assertThat(indicator.health().getDetails()).isEmpty();
            response.set(
                    "{\"status\":\"ok\",\"model\":\"intfloat/multilingual-e5-base\",\"dimensions\":384}");
            assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
        } finally {
            server.stop(0);
        }
    }
}
