package kz.company.shop.seo.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Fetch the real Vite/Nginx shell so hashed assets and development HMR remain intact. */
@Component
public class StorefrontTemplate {
    private final URI uri;
    private final HttpClient client =
            HttpClient.newBuilder()
                    .version(HttpClient.Version.HTTP_1_1)
                    .connectTimeout(Duration.ofSeconds(2))
                    .build();
    private String cached;
    private long expiresAt;

    public StorefrontTemplate(
            @Value("${app.seo.template-url:http://frontend:8080/index.html}") String url) {
        uri = URI.create(url);
    }

    public synchronized String get() {
        if (cached != null && System.nanoTime() < expiresAt) return cached;
        try {
            var response =
                    client.send(
                            HttpRequest.newBuilder(uri)
                                    .timeout(Duration.ofSeconds(3))
                                    .GET()
                                    .build(),
                            HttpResponse.BodyHandlers.ofString());
            var document = org.jsoup.Jsoup.parse(response.body());
            if (response.statusCode() != 200
                    || document.select("#root").isEmpty()
                    || document.select("script[type=module][src]").isEmpty()) {
                throw new IllegalStateException("Storefront template is unavailable");
            }
            cached = response.body();
            expiresAt = System.nanoTime() + Duration.ofSeconds(30).toNanos();
            return cached;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Storefront template request interrupted", e);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Storefront template is unavailable", e);
        }
    }
}
