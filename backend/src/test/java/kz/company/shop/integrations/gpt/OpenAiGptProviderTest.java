package kz.company.shop.integrations.gpt;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class OpenAiGptProviderTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void sendsConfiguredRequestAndCollectsTextAcrossOutputItems() throws Exception {
        GptUsageRecorder recorder = mock(GptUsageRecorder.class);
        AtomicReference<JsonNode> sent = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer server =
                server(
                        200,
                        """
                        {"id":"resp_123","model":"gpt-6-luna","status":"completed","output":[
                          {"type":"reasoning"},
                          {"type":"message","content":[{"type":"output_text","text":"Hello "}]},
                          {"type":"message","content":[{"type":"output_text","text":"world"}]}
                        ],"usage":{"input_tokens":12,"output_tokens":5,"total_tokens":17,
                          "input_tokens_details":{"cached_tokens":3,"cache_write_tokens":2},
                          "output_tokens_details":{"reasoning_tokens":1}}}
                        """,
                        sent,
                        authorization);
        try {
            GptResult result =
                    new OpenAiGptProvider(properties(server), recorder)
                            .generate(new GptRequest("product_summary", "Be brief", "Hi", 50));
            assertEquals("Hello world", result.text());
            assertEquals("resp_123", result.responseId());
            assertEquals(12, result.inputTokens());
            assertEquals(5, result.outputTokens());
            assertEquals("Bearer test-key", authorization.get());
            assertEquals("gpt-6-luna", sent.get().path("model").asText());
            assertEquals("Hi", sent.get().path("input").asText());
            assertEquals("Be brief", sent.get().path("instructions").asText());
            assertEquals(50, sent.get().path("max_output_tokens").asInt());
            assertFalse(sent.get().path("store").asBoolean(true));
            ArgumentCaptor<GptUsage> recorded = ArgumentCaptor.forClass(GptUsage.class);
            verify(recorder).record(recorded.capture());
            assertEquals("resp_123", recorded.getValue().responseId());
            assertEquals("product_summary", recorded.getValue().feature());
            assertEquals("gpt-6-luna", recorded.getValue().model());
            assertEquals("completed", recorded.getValue().status());
            assertEquals(12L, recorded.getValue().inputTokens());
            assertEquals(5L, recorded.getValue().outputTokens());
            assertEquals(17L, recorded.getValue().totalTokens());
            assertEquals(3L, recorded.getValue().cachedInputTokens());
            assertEquals(2L, recorded.getValue().cacheWriteTokens());
            assertEquals(1L, recorded.getValue().reasoningOutputTokens());
            assertTrue(recorded.getValue().durationMs() >= 0);
        } finally {
            server.stop(0);
        }
    }

    @Test
    void sendsImagesAsResponsesInputAndRecordsUsage() throws Exception {
        GptUsageRecorder recorder = mock(GptUsageRecorder.class);
        AtomicReference<JsonNode> sent = new AtomicReference<>();
        HttpServer server =
                server(
                        200,
                        "{\"id\":\"resp_image\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"{}\"}]}],\"usage\":{\"input_tokens\":30,\"output_tokens\":4}}",
                        sent,
                        null);
        try {
            GptResult result =
                    new OpenAiGptProvider(properties(server), recorder)
                            .generateImages(
                                    new GptImageRequest(
                                            "warehouse_inventory_photo",
                                            "Read first column",
                                            "page 1",
                                            List.of("data:image/jpeg;base64,/9j/"),
                                            100));
            assertEquals("{}", result.text());
            JsonNode content = sent.get().path("input").get(0).path("content");
            assertEquals("input_text", content.get(0).path("type").asText());
            assertEquals("page 1", content.get(0).path("text").asText());
            assertEquals("input_image", content.get(1).path("type").asText());
            assertEquals("data:image/jpeg;base64,/9j/", content.get(1).path("image_url").asText());
            ArgumentCaptor<GptUsage> usage = ArgumentCaptor.forClass(GptUsage.class);
            verify(recorder).record(usage.capture());
            assertEquals("warehouse_inventory_photo", usage.getValue().feature());
            assertEquals(30L, usage.getValue().inputTokens());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void imageRequestsUseLongerReadTimeoutThanTextRequests() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/responses",
                exchange -> {
                    calls.incrementAndGet();
                    try {
                        Thread.sleep(180);
                    } catch (InterruptedException ex) {
                        Thread.currentThread().interrupt();
                    }
                    byte[] bytes =
                            "{\"id\":\"slow\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"ok\"}]}]}"
                                    .getBytes(StandardCharsets.UTF_8);
                    try {
                        exchange.getResponseHeaders().set("Content-Type", "application/json");
                        exchange.sendResponseHeaders(200, bytes.length);
                        exchange.getResponseBody().write(bytes);
                    } catch (IOException ignored) {
                        // The short text request is expected to disconnect before the delayed
                        // response.
                    } finally {
                        exchange.close();
                    }
                });
        server.start();
        try {
            GptProperties properties = properties(server);
            properties.setReadTimeout(Duration.ofMillis(50));
            OpenAiGptProvider provider =
                    new OpenAiGptProvider(properties, mock(GptUsageRecorder.class));
            assertThrows(
                    GptProviderException.class,
                    () -> provider.generate(new GptRequest("text", null, "Hi", null)));
            assertEquals(
                    "ok",
                    provider.generateImages(
                                    new GptImageRequest(
                                            "image",
                                            null,
                                            "Read",
                                            List.of("data:image/jpeg;base64,/9j/"),
                                            100))
                            .text());
            assertEquals(2, calls.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void failsClosedWhenDisabledOrMissingKey() {
        GptProperties properties = new GptProperties();
        OpenAiGptProvider provider =
                new OpenAiGptProvider(properties, mock(GptUsageRecorder.class));
        assertEquals(
                "GPT provider is disabled",
                assertThrows(
                                GptProviderException.class,
                                () -> provider.generate(new GptRequest("test", null, "Hi", null)))
                        .getMessage());
        properties.setEnabled(true);
        assertEquals(
                "GPT API key is not configured",
                assertThrows(
                                GptProviderException.class,
                                () -> provider.generate(new GptRequest("test", null, "Hi", null)))
                        .getMessage());
    }

    @Test
    void rejectsIncompleteAndHttpErrorWithoutExposingUpstreamBody() throws Exception {
        GptUsageRecorder recorder = mock(GptUsageRecorder.class);
        HttpServer incomplete =
                server(
                        200,
                        "{\"id\":\"resp_incomplete\",\"status\":\"incomplete\",\"output\":[],\"usage\":{\"input_tokens\":10,\"output_tokens\":2,\"total_tokens\":12}}",
                        null,
                        null);
        try {
            assertEquals(
                    "GPT API did not complete the response",
                    assertThrows(
                                    GptProviderException.class,
                                    () ->
                                            new OpenAiGptProvider(properties(incomplete), recorder)
                                                    .generate(
                                                            new GptRequest(
                                                                    "test", null, "Hi", null)))
                            .getMessage());
        } finally {
            incomplete.stop(0);
        }
        ArgumentCaptor<GptUsage> incompleteUsage = ArgumentCaptor.forClass(GptUsage.class);
        verify(recorder).record(incompleteUsage.capture());
        assertEquals("incomplete", incompleteUsage.getValue().status());
        assertEquals(12L, incompleteUsage.getValue().totalTokens());
        HttpServer failed = server(429, "sensitive upstream body", null, null);
        try {
            GptProviderException exception =
                    assertThrows(
                            GptProviderException.class,
                            () ->
                                    new OpenAiGptProvider(properties(failed), recorder)
                                            .generate(new GptRequest("test", null, "Hi", null)));
            assertEquals("GPT API returned HTTP 429", exception.getMessage());
            assertTrue(exception.getCause() == null);
            ArgumentCaptor<GptUsage> failedUsage = ArgumentCaptor.forClass(GptUsage.class);
            verify(recorder, org.mockito.Mockito.times(2)).record(failedUsage.capture());
            assertEquals("http_error", failedUsage.getAllValues().get(1).status());
            assertEquals(429, failedUsage.getAllValues().get(1).httpStatus());
        } finally {
            failed.stop(0);
        }
    }

    private GptProperties properties(HttpServer server) {
        GptProperties properties = new GptProperties();
        properties.setEnabled(true);
        properties.setApiKey("test-key");
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        return properties;
    }

    private HttpServer server(
            int status,
            String body,
            AtomicReference<JsonNode> sent,
            AtomicReference<String> authorization)
            throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(
                "/responses",
                exchange -> {
                    if (sent != null) sent.set(mapper.readTree(exchange.getRequestBody()));
                    if (authorization != null)
                        authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(status, bytes.length);
                    exchange.getResponseBody().write(bytes);
                    exchange.close();
                });
        server.start();
        return server;
    }
}
