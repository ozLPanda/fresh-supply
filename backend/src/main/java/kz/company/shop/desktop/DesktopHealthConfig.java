package kz.company.shop.desktop;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import kz.company.shop.files.service.ObjectStorageService;
import kz.company.shop.search.EmbeddingProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
@Profile("desktop")
public class DesktopHealthConfig {
    @Bean
    HealthIndicator desktopStorageHealthIndicator(
            ObjectStorageService storage, @Value("${app.desktop.web-root}") String webRoot) {
        return () -> {
            try {
                storage.ensureBucket();
                boolean frontendAvailable =
                        Files.isReadable(Path.of(webRoot).resolve("index.html"))
                                || new ClassPathResource("static/index.html").exists();
                return frontendAvailable ? Health.up().build() : Health.down().build();
            } catch (Exception ex) {
                return Health.down().build();
            }
        };
    }

    @Bean
    HealthIndicator desktopEmbeddingsHealthIndicator(EmbeddingProperties properties) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2));
        factory.setReadTimeout(Duration.ofSeconds(2));
        RestClient client = RestClient.builder().requestFactory(factory).build();
        return () -> {
            if (!properties.isEnabled()) return Health.up().build();
            try {
                Map<?, ?> health =
                        client.get()
                                .uri(properties.getUrl() + "/health")
                                .retrieve()
                                .body(Map.class);
                boolean compatible =
                        health != null
                                && "ok".equals(health.get("status"))
                                && properties.getModel().equals(health.get("model"))
                                && health.get("dimensions") instanceof Number dimensions
                                && dimensions.intValue() == properties.getDimensions();
                return compatible ? Health.up().build() : Health.down().build();
            } catch (Exception ex) {
                return Health.down().build();
            }
        };
    }
}
