package kz.company.shop.whatsapp;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WhatsAppInboxService {
    private final WhatsAppProvider provider;
    private final WhatsAppInboxRepository repository;
    private final WhatsAppProperties properties;

    public WhatsAppInboxService(
            WhatsAppProvider provider,
            WhatsAppInboxRepository repository,
            WhatsAppProperties properties) {
        this.provider = provider;
        this.repository = repository;
        this.properties = properties;
    }

    @Transactional
    public void receive(byte[] payload, String signature) {
        provider.verifySignature(payload, signature);
        for (IncomingWhatsAppMessage message : provider.incomingMessages(payload)) {
            repository.saveIncoming(message);
        }
    }

    public WhatsAppStatusDto status() {
        return new WhatsAppStatusDto(
                properties.isWebhookConfigured(),
                properties.phoneNumberId() == null || properties.phoneNumberId().isBlank()
                        ? null
                        : properties.phoneNumberId());
    }

    @Transactional(readOnly = true)
    public WhatsAppPageDto<WhatsAppContactDto> contacts(String query, int page, int size) {
        return repository.contacts(query, page, size);
    }

    @Transactional(readOnly = true)
    public WhatsAppPageDto<WhatsAppMessageDto> messages(long contactId, int page, int size) {
        return repository.messages(contactId, page, size);
    }
}
