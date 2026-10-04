package kz.company.shop.mks;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class MksTransportTest {
    @Test
    void keepsCookiesIsolatedAndNeverFollowsLoginRedirect() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var cookie = new AtomicReference<String>();
        var loginBody = new AtomicReference<String>();
        var productMethod = new AtomicReference<String>();
        server.createContext(
                "/login/",
                exchange -> {
                    loginBody.set(
                            new String(
                                    exchange.getRequestBody().readAllBytes(),
                                    StandardCharsets.UTF_8));
                    exchange.getResponseHeaders().add("Set-Cookie", "fixture-session=one; Path=/");
                    exchange.getResponseHeaders()
                            .add("Location", "https://invalid.example/never-follow");
                    exchange.sendResponseHeaders(302, -1);
                    exchange.close();
                });
        server.createContext(
                "/api/filterinit/",
                exchange -> {
                    cookie.set(exchange.getRequestHeaders().getFirst("Cookie"));
                    byte[] response = "{\"catalog_tree\":[]}".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.createContext(
                "/api/product/21/",
                exchange -> {
                    cookie.set(exchange.getRequestHeaders().getFirst("Cookie"));
                    productMethod.set(exchange.getRequestMethod());
                    byte[] response = "{\"id\":\"21\"}".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.start();
        try {
            var origin = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
            var first = new MksTransport(new ObjectMapper(), origin);
            var second = new MksTransport(new ObjectMapper(), origin);
            first.login("fixture+login", "fixture&password");
            assertThat(loginBody.get())
                    .isEqualTo("email=fixture%2Blogin&password=fixture%26password");
            first.post("/api/filterinit/", Map.of());
            assertThat(cookie.get()).contains("fixture-session=one");
            second.post("/api/filterinit/", Map.of());
            assertThat(cookie.get()).isNull();
            assertThat(first.get("/api/product/21/").path("id").asText()).isEqualTo("21");
            assertThat(cookie.get()).contains("fixture-session=one");
            assertThat(productMethod.get()).isEqualTo("GET");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void sanitizesLoginHtmlAndRemoteErrorBodies() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/api/filter/",
                exchange -> {
                    byte[] response =
                            "<html>private upstream detail</html>".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200, response.length);
                    exchange.getResponseBody().write(response);
                    exchange.close();
                });
        server.start();
        try {
            var transport =
                    new MksTransport(
                            new ObjectMapper(),
                            URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
            assertThatThrownBy(() -> transport.post("/api/filter/", Map.of()))
                    .isInstanceOf(MksTransport.Failure.class)
                    .hasMessageNotContaining("private upstream detail");
            assertThatThrownBy(() -> transport.get("/api/filter/"))
                    .isInstanceOf(MksTransport.Failure.class)
                    .hasMessageNotContaining("private upstream detail");
        } finally {
            server.stop(0);
        }
    }
}
