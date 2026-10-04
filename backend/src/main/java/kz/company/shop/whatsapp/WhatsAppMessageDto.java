package kz.company.shop.whatsapp;

import java.time.Instant;

public record WhatsAppMessageDto(
        long id,
        String direction,
        String type,
        String body,
        Instant occurredAt,
        String status) {}
