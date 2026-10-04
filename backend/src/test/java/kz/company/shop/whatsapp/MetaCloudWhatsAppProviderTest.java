package kz.company.shop.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class MetaCloudWhatsAppProviderTest {
    private final WhatsAppProperties properties =
            new WhatsAppProperties("", "12345", "", "verification-secret", "app-secret");
    private final MetaCloudWhatsAppProvider provider =
            new MetaCloudWhatsAppProvider(properties, new ObjectMapper());

    @Test
    void checksVerificationTokenAndSignedBytes() throws Exception {
        byte[] payload = "{\"object\":\"whatsapp_business_account\"}".getBytes(StandardCharsets.UTF_8);
        assertThat(provider.acceptsVerification("subscribe", "verification-secret")).isTrue();
        assertThat(provider.acceptsVerification("subscribe", "wrong")).isFalse();
        assertThat(provider.acceptsVerification("unsubscribe", "verification-secret")).isFalse();

        String signature = sign(payload, "app-secret");
        provider.verifySignature(payload, signature);
        assertThatThrownBy(() -> provider.verifySignature("different".getBytes(StandardCharsets.UTF_8), signature))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("403");
        assertThatThrownBy(() -> provider.verifySignature(payload, "sha256=garbage"))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("403");
    }

    @Test
    void extractsContactAndMessagesFromMatchingBusinessNumber() {
        byte[] payload = """
                {
                  "object": "whatsapp_business_account",
                  "entry": [{"changes": [
                    {"field": "messages", "value": {
                      "metadata": {"phone_number_id": "12345"},
                      "contacts": [{"wa_id": "77001234567", "profile": {"name": "Алия"}}],
                      "messages": [
                        {"id": "wamid.one", "from": "77001234567", "timestamp": "1700000000", "type": "text", "text": {"body": "Есть ли котёл?"}},
                        {"id": "wamid.two", "from": "77001234567", "timestamp": "1700000001", "type": "image", "image": {"id": "media-1", "caption": "Эта модель"}}
                      ]
                    }},
                    {"field": "messages", "value": {
                      "metadata": {"phone_number_id": "other"},
                      "messages": [{"id": "ignored", "from": "70000000000", "timestamp": "1700000000", "type": "text", "text": {"body": "ignore"}}]
                    }}
                  ]}]
                }
                """.getBytes(StandardCharsets.UTF_8);

        var messages = provider.incomingMessages(payload);

        assertThat(messages).hasSize(2);
        assertThat(messages.get(0).messageId()).isEqualTo("wamid.one");
        assertThat(messages.get(0).waId()).isEqualTo("77001234567");
        assertThat(messages.get(0).displayName()).isEqualTo("Алия");
        assertThat(messages.get(0).body()).isEqualTo("Есть ли котёл?");
        assertThat(messages.get(0).occurredAt()).isEqualTo(Instant.ofEpochSecond(1700000000));
        assertThat(messages.get(1).type()).isEqualTo("image");
        assertThat(messages.get(1).mediaId()).isEqualTo("media-1");
        assertThat(messages.get(1).body()).isEqualTo("Эта модель");
    }

    @Test
    void ignoresStatusOnlyEventsAndRejectsMalformedJson() {
        byte[] status = """
                {"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"12345"},"statuses":[{"id":"wamid.one","status":"delivered"}]}}]}]}
                """.getBytes(StandardCharsets.UTF_8);
        assertThat(provider.incomingMessages(status)).isEmpty();
        assertThatThrownBy(() -> provider.incomingMessages("{".getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("400");
    }

    private static String sign(byte[] payload, String secret) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return "sha256=" + HexFormat.of().formatHex(mac.doFinal(payload));
    }
}
