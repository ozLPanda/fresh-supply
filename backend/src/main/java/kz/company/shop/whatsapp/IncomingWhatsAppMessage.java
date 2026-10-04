package kz.company.shop.whatsapp;

import java.time.Instant;

public record IncomingWhatsAppMessage(
        String messageId,
        String waId,
        String displayName,
        String type,
        String body,
        String mediaId,
        Instant occurredAt) {}
