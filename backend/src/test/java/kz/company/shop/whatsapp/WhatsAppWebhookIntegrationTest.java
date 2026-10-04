package kz.company.shop.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
    "app.whatsapp.phone-number-id=12345",
    "app.whatsapp.verify-token=test-verify-token",
    "app.whatsapp.app-secret=test-app-secret"
})
@Transactional
class WhatsAppWebhookIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired WhatsAppInboxRepository repository;

    @Test
    void verifiesWebhookAndStoresSignedIncomingMessageOnlyOnce() throws Exception {
        mvc.perform(get("/api/whatsapp/webhook")
                        .param("hub.mode", "subscribe")
                        .param("hub.verify_token", "test-verify-token")
                        .param("hub.challenge", "challenge-123"))
                .andExpect(status().isOk())
                .andExpect(content().string("challenge-123"));

        String waId = "test-" + UUID.randomUUID();
        String messageId = "wamid-" + UUID.randomUUID();
        byte[] payload = ("""
                {"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{
                "metadata":{"phone_number_id":"12345"},
                "contacts":[{"wa_id":"%s","profile":{"name":"Клиент"}}],
                "messages":[{"id":"%s","from":"%s","timestamp":"1780300000","type":"text","text":{"body":"Есть в наличии?"}}]
                }}]}]}
                """.formatted(waId, messageId, waId)).getBytes(StandardCharsets.UTF_8);
        String signature = signature(payload);

        mvc.perform(post("/api/whatsapp/webhook")
                        .header("X-Hub-Signature-256", signature)
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isOk());
        mvc.perform(post("/api/whatsapp/webhook")
                        .header("X-Hub-Signature-256", signature)
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isOk());
        mvc.perform(post("/api/whatsapp/webhook")
                        .header("X-Hub-Signature-256", "sha256=00")
                        .contentType("application/json")
                        .content(payload))
                .andExpect(status().isForbidden());

        var contacts = repository.contacts(waId, 0, 10);
        assertThat(contacts.total()).isEqualTo(1);
        assertThat(contacts.items().get(0).displayName()).isEqualTo("Клиент");
        var messages = repository.messages(contacts.items().get(0).id(), 0, 10);
        assertThat(messages.total()).isEqualTo(1);
        assertThat(messages.items().get(0).body()).isEqualTo("Есть в наличии?");
    }

    private static String signature(byte[] payload) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("test-app-secret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return "sha256=" + HexFormat.of().formatHex(mac.doFinal(payload));
    }
}
