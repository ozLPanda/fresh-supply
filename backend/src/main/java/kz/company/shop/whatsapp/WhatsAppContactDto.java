package kz.company.shop.whatsapp;

import java.time.Instant;

public record WhatsAppContactDto(
        long id,
        String waId,
        String displayName,
        String lastMessagePreview,
        Instant lastMessageAt) {}
