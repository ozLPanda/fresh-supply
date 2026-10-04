package kz.company.shop.mks;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;

/** One isolated cookie jar. The service serializes all interactions with this transport. */
final class MksTransport {
    static final URI SUPPLIER = URI.create("https://mkskz.master.pro");
    private final CookieManager cookies =
            new CookieManager(null, CookiePolicy.ACCEPT_ORIGINAL_SERVER);
    private final HttpClient client;
    private final ObjectMapper mapper;
    private final URI origin;

    MksTransport(ObjectMapper mapper) {
        this(mapper, SUPPLIER);
    }

    // Package-private alternate origin is used only by local transport tests.
    MksTransport(ObjectMapper mapper, URI origin) {
        this.mapper = mapper;
        this.origin = origin;
        this.client =
                HttpClient.newBuilder()
                        .cookieHandler(cookies)
                        .connectTimeout(Duration.ofSeconds(10))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .build();
    }

    void clearSession() {
        cookies.getCookieStore().removeAll();
    }

    void login(String login, String password) {
        clearSession();
        var response =
                send(
                        "/login/",
                        "application/x-www-form-urlencoded",
                        "email=" + encode(login) + "&password=" + encode(password));
        if (response.statusCode() != 200
                && response.statusCode() != 302
                && response.statusCode() != 303) {
            throw new Failure(false, "Поставщик отклонил вход. Проверьте настройки подключения.");
        }
        // A redirect is never followed; a successful filterinit proves authentication.
    }

    JsonNode post(String path, Map<String, Object> body) {
        try {
            var response = send(path, "application/json", mapper.writeValueAsString(body));
            return json(response);
        } catch (IOException e) {
            throw new Failure(false, "Поставщик вернул неподдерживаемый формат данных.");
        }
    }

    JsonNode get(String path) {
        return json(send(path, "application/json", null));
    }

    private JsonNode json(HttpResponse<byte[]> response) {
        try {
            int status = response.statusCode();
            if (status == 401 || status == 403 || (status >= 300 && status < 400)) {
                throw new Failure(true, "Сессия поставщика истекла. Проверьте данные входа.");
            }
            if (status != 200)
                throw new Failure(false, "Поставщик временно недоступен. Повторите запрос позже.");
            String text = new String(response.body(), StandardCharsets.UTF_8).stripLeading();
            if (text.startsWith("<"))
                throw new Failure(
                        true, "Поставщик запросил повторный вход или проверку в браузере.");
            JsonNode result = mapper.readTree(text);
            if (result == null || !result.isObject())
                throw new Failure(false, "Поставщик вернул неподдерживаемый формат данных.");
            return result;
        } catch (IOException e) {
            throw new Failure(false, "Поставщик вернул неподдерживаемый формат данных.");
        }
    }

    private HttpResponse<byte[]> send(String path, String contentType, String body) {
        try {
            var builder =
                    HttpRequest.newBuilder(origin.resolve(path))
                            .timeout(Duration.ofSeconds(25))
                            .header("Content-Type", contentType)
                            .header("Accept", "application/json, text/plain, */*")
                            .header("Origin", origin.toString())
                            .header(
                                    "Referer",
                                    origin.resolve("/cabinet/action12/initcatalog0").toString())
                            .header("X-Requested-With", "XMLHttpRequest");
            var request =
                    (body == null
                                    ? builder.GET()
                                    : builder.POST(HttpRequest.BodyPublishers.ofString(body)))
                            .build();
            return client.send(request, info -> new BoundedBodySubscriber());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Failure(false, "Запрос к поставщику прерван. Повторите попытку.");
        } catch (IOException | IllegalArgumentException e) {
            throw new Failure(
                    false, "Не удалось подключиться к поставщику. Повторите попытку позже.");
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    static final class Failure extends RuntimeException {
        final boolean authentication;

        Failure(boolean authentication, String safeMessage) {
            super(safeMessage);
            this.authentication = authentication;
        }
    }

    private static final class BoundedBodySubscriber
            implements HttpResponse.BodySubscriber<byte[]> {
        private static final int LIMIT = 8 * 1024 * 1024;
        private final HttpResponse.BodySubscriber<byte[]> delegate =
                HttpResponse.BodySubscribers.ofByteArray();
        private Flow.Subscription subscription;
        private long bytes;

        @Override
        public CompletionStage<byte[]> getBody() {
            return delegate.getBody();
        }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            delegate.onSubscribe(subscription);
        }

        @Override
        public void onNext(List<ByteBuffer> buffers) {
            for (var buffer : buffers) bytes += buffer.remaining();
            if (bytes > LIMIT) {
                subscription.cancel();
                delegate.onError(new IOException("Supplier response exceeds limit"));
            } else delegate.onNext(buffers);
        }

        @Override
        public void onError(Throwable error) {
            delegate.onError(error);
        }

        @Override
        public void onComplete() {
            delegate.onComplete();
        }
    }
}
