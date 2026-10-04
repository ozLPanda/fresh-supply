package kz.company.shop.whatsapp;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class WhatsAppInboxRepositoryTest {
    @Autowired WhatsAppInboxRepository repository;

    @Test
    void storesMessagesOnceAndKeepsLatestPreviewWhenWebhooksArriveOutOfOrder() {
        String waId = "test-" + UUID.randomUUID();
        Instant latest = Instant.parse("2026-09-30T08:00:00Z");
        Instant older = latest.minusSeconds(60);
        IncomingWhatsAppMessage newMessage =
                new IncomingWhatsAppMessage(
                        "wamid-" + UUID.randomUUID(), waId, "Тестовый клиент", "text", "Новое сообщение", null, latest);
        IncomingWhatsAppMessage oldMessage =
                new IncomingWhatsAppMessage(
                        "wamid-" + UUID.randomUUID(), waId, null, "text", "Старое сообщение", null, older);

        repository.saveIncoming(newMessage);
        repository.saveIncoming(newMessage);
        repository.saveIncoming(oldMessage);

        var contacts = repository.contacts(waId, 0, 30);
        assertThat(contacts.total()).isEqualTo(1);
        assertThat(contacts.items()).hasSize(1);
        var contact = contacts.items().get(0);
        assertThat(contact.displayName()).isEqualTo("Тестовый клиент");
        assertThat(contact.lastMessagePreview()).isEqualTo("Новое сообщение");
        assertThat(contact.lastMessageAt()).isEqualTo(latest);

        var messages = repository.messages(contact.id(), 0, 50);
        assertThat(messages.total()).isEqualTo(2);
        assertThat(messages.items()).extracting(WhatsAppMessageDto::body)
                .containsExactly("Старое сообщение", "Новое сообщение");
    }
}
