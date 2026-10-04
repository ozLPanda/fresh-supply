package kz.company.shop.integrations.gpt;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class OpenAiGptProvider implements GptProvider {
    private final GptProperties properties;
    private final GptUsageRecorder usageRecorder;
    private final RestClient restClient;
    private final RestClient imageRestClient;

    public OpenAiGptProvider(GptProperties properties, GptUsageRecorder usageRecorder) {
        this.properties = properties;
        this.usageRecorder = usageRecorder;
        this.restClient = client(properties, properties.getReadTimeout());
        Duration imageTimeout =
                properties.getReadTimeout().compareTo(Duration.ofSeconds(180)) >= 0
                        ? properties.getReadTimeout()
                        : Duration.ofSeconds(180);
        this.imageRestClient = client(properties, imageTimeout);
    }

    @Override
    public GptResult generate(GptRequest request) {
        if (request == null) throw new IllegalArgumentException("GPT request is required");
        return generateRaw(
                restClient,
                request.feature(),
                request.instructions(),
                request.input(),
                request.maxOutputTokens());
    }

    @Override
    public GptResult generateImages(GptImageRequest request) {
        if (request == null || request.imageDataUrls() == null || request.imageDataUrls().isEmpty())
            throw new IllegalArgumentException("GPT images are required");
        List<Map<String, Object>> content = new ArrayList<>();
        content.add(Map.of("type", "input_text", "text", request.input()));
        for (String dataUrl : request.imageDataUrls()) {
            if (dataUrl == null
                    || !dataUrl.matches("(?s)^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$"))
                throw new IllegalArgumentException("Unsupported GPT image");
            content.add(Map.of("type", "input_image", "image_url", dataUrl, "detail", "high"));
        }
        return generateRaw(
                imageRestClient,
                request.feature(),
                request.instructions(),
                List.of(Map.of("role", "user", "content", content)),
                request.maxOutputTokens());
    }

    private static RestClient client(GptProperties properties, Duration readTimeout) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(properties.getConnectTimeout());
        requestFactory.setReadTimeout(readTimeout);
        return RestClient.builder()
                .baseUrl(properties.getBaseUrl())
                .requestFactory(requestFactory)
                .build();
    }

    private GptResult generateRaw(
            RestClient client,
            String feature,
            String instructions,
            Object input,
            Integer maxOutputTokens) {
        boolean orderPhotos =
                "order-assistant-photo-reading".equals(feature)
                        || "order-assistant-photos".equals(feature);
        String effectiveModel =
                orderPhotos ? properties.getOrderPhotoModel() : properties.getModel();
        if (!properties.isEnabled()) {
            throw new GptProviderException("GPT provider is disabled");
        }
        if (properties.getApiKey() == null || properties.getApiKey().isBlank()) {
            throw new GptProviderException("GPT API key is not configured");
        }
        if (effectiveModel == null || effectiveModel.isBlank()) {
            throw new GptProviderException("GPT model is not configured");
        }
        if (input == null || input instanceof String text && text.isBlank()) {
            throw new IllegalArgumentException("GPT input must not be blank");
        }
        if (feature == null || feature.isBlank() || feature.length() > 100) {
            throw new IllegalArgumentException("GPT feature must contain 1 to 100 characters");
        }
        if (maxOutputTokens != null && maxOutputTokens <= 0) {
            throw new IllegalArgumentException("GPT maxOutputTokens must be positive");
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", effectiveModel);
        body.put("input", input);
        body.put("store", false);
        if (orderPhotos) {
            body.put("reasoning", Map.of("effort", "high"));
        } else if (properties.getReasoningEffort() != null
                && !properties.getReasoningEffort().isBlank()) {
            body.put("reasoning", Map.of("effort", properties.getReasoningEffort()));
        }
        if (instructions != null && !instructions.isBlank()) {
            body.put("instructions", instructions);
        }
        if (maxOutputTokens != null) {
            body.put("max_output_tokens", maxOutputTokens);
        }

        long startedAt = System.nanoTime();
        JsonNode response;
        try {
            response =
                    client.post()
                            .uri("/responses")
                            .headers(headers -> headers.setBearerAuth(properties.getApiKey()))
                            .contentType(MediaType.APPLICATION_JSON)
                            .accept(MediaType.APPLICATION_JSON)
                            .body(body)
                            .retrieve()
                            .body(JsonNode.class);
        } catch (RestClientResponseException ex) {
            // Upstream error bodies can contain request data; never copy them into logs or callers.
            usageRecorder.record(
                    new GptUsage(
                            null,
                            feature,
                            effectiveModel,
                            "http_error",
                            ex.getStatusCode().value(),
                            null,
                            null,
                            null,
                            null,
                            null,
                            null,
                            elapsedMs(startedAt)));
            throw new GptProviderException("GPT API returned HTTP " + ex.getStatusCode().value());
        } catch (RestClientException ex) {
            usageRecorder.record(
                    new GptUsage(
                            null,
                            feature,
                            effectiveModel,
                            "request_failed",
                            null,
                            null,
                            null,
                            null,
                            null,
                            null,
                            null,
                            elapsedMs(startedAt)));
            throw new GptProviderException("GPT API request failed", ex);
        }

        StringBuilder text = new StringBuilder();
        if (response != null) {
            for (JsonNode item : response.path("output")) {
                if (!"message".equals(item.path("type").asText())) continue;
                for (JsonNode content : item.path("content")) {
                    if ("output_text".equals(content.path("type").asText())) {
                        text.append(content.path("text").asText());
                    }
                }
            }
        }
        String status =
                response == null ? "invalid_response" : response.path("status").asText("unknown");
        if ("completed".equals(status) && text.isEmpty()) status = "empty_text";
        JsonNode usage = response == null ? null : response.path("usage");
        usageRecorder.record(
                new GptUsage(
                        response == null ? null : response.path("id").asText(null),
                        feature,
                        response == null
                                ? effectiveModel
                                : response.path("model").asText(effectiveModel),
                        status,
                        200,
                        tokenCount(usage, "input_tokens"),
                        tokenCount(usage, "output_tokens"),
                        tokenCount(usage, "total_tokens"),
                        tokenCount(
                                usage == null ? null : usage.path("input_tokens_details"),
                                "cached_tokens"),
                        tokenCount(
                                usage == null ? null : usage.path("input_tokens_details"),
                                "cache_write_tokens"),
                        tokenCount(
                                usage == null ? null : usage.path("output_tokens_details"),
                                "reasoning_tokens"),
                        elapsedMs(startedAt)));
        if (!"completed".equals(status) && !"empty_text".equals(status)) {
            throw new GptProviderException("GPT API did not complete the response");
        }
        if (text.isEmpty()) {
            throw new GptProviderException("GPT API returned no text");
        }
        return new GptResult(
                text.toString(),
                response.path("id").asText(),
                tokenCount(usage, "input_tokens"),
                tokenCount(usage, "output_tokens"));
    }

    private static Long tokenCount(JsonNode node, String field) {
        if (node == null) return null;
        JsonNode value = node.path(field);
        return value.isIntegralNumber() && value.canConvertToLong() ? value.longValue() : null;
    }

    private static long elapsedMs(long startedAt) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
    }
}
