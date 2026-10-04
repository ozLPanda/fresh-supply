package kz.company.shop.seo.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class StorefrontTemplateTest {
    @Test
    void reusesValidShellWithHashedAssetsDuringCacheWindow() throws Exception {
        var requests = new AtomicInteger();
        String shell =
                "<!doctype html><div id='root'></div><script type='module' src='/assets/app-123.js'></script>";
        HttpServer server = server(200, shell, requests);
        try {
            var template = new StorefrontTemplate(url(server));
            assertThat(template.get()).isEqualTo(shell);
            assertThat(template.get()).isEqualTo(shell);
            assertThat(requests).hasValue(1);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsUnavailableOrIncompleteShells() throws Exception {
        for (String body :
                new String[] {
                    "<html>upstream error</html>",
                    "<div id='root'></div>",
                    "<script type='module' src='/app.js'></script>"
                }) {
            HttpServer server = server(200, body, new AtomicInteger());
            try {
                assertThatThrownBy(() -> new StorefrontTemplate(url(server)).get())
                        .isInstanceOf(IllegalStateException.class);
            } finally {
                server.stop(0);
            }
        }
        HttpServer server =
                server(
                        503,
                        "<div id='root'></div><script type='module' src='/app.js'></script>",
                        new AtomicInteger());
        try {
            assertThatThrownBy(() -> new StorefrontTemplate(url(server)).get())
                    .isInstanceOf(IllegalStateException.class);
        } finally {
            server.stop(0);
        }
    }

    private static HttpServer server(int status, String body, AtomicInteger requests)
            throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/index.html",
                exchange -> {
                    requests.incrementAndGet();
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(status, bytes.length);
                    try (var output = exchange.getResponseBody()) {
                        output.write(bytes);
                    }
                });
        server.start();
        return server;
    }

    private static String url(HttpServer server) {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/index.html";
    }
}
