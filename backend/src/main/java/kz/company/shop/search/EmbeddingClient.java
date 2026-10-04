package kz.company.shop.search;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class EmbeddingClient {
    private static final Logger log = LoggerFactory.getLogger(EmbeddingClient.class);

    private final EmbeddingProperties properties;
    private final RestClient restClient;

    public EmbeddingClient(EmbeddingProperties properties) {
        this.properties = properties;
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofSeconds(5));
        requestFactory.setReadTimeout(Duration.ofSeconds(30));
        this.restClient =
                RestClient.builder()
                        .baseUrl(properties.getUrl())
                        .requestFactory(requestFactory)
                        .build();
    }

    public boolean enabled() {
        return properties.isEnabled();
    }

    public Optional<List<Float>> embedQuery(String text) {
        return embed("query", List.of(text)).map(response -> response.embeddings().get(0));
    }

    public Optional<List<Float>> embedPassage(String text) {
        return embed("passage", List.of(text)).map(response -> response.embeddings().get(0));
    }

    private Optional<EmbedResponse> embed(String inputType, List<String> texts) {
        if (!properties.isEnabled()) return Optional.empty();
        try {
            EmbedResponse response =
                    restClient
                            .post()
                            .uri("/embed")
                            .contentType(MediaType.APPLICATION_JSON)
                            .accept(MediaType.APPLICATION_JSON)
                            .body(new EmbedRequest(inputType, texts))
                            .retrieve()
                            .body(EmbedResponse.class);
            if (response == null
                    || response.embeddings() == null
                    || response.embeddings().isEmpty()
                    || response.dimensions() != properties.getDimensions()) {
                log.warn("Embedding service returned an invalid response for {}", inputType);
                return Optional.empty();
            }
            return Optional.of(response);
        } catch (RuntimeException ex) {
            log.warn("Embedding service request failed: {}", ex.getMessage());
            return Optional.empty();
        }
    }

    private record EmbedRequest(String inputType, List<String> texts) {}

    private record EmbedResponse(String model, int dimensions, List<List<Float>> embeddings) {}
}
