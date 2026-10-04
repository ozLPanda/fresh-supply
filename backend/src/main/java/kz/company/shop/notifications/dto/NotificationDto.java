package kz.company.shop.notifications.dto;

import java.time.Instant;
import java.util.UUID;
import kz.company.shop.notifications.entity.NotificationType;

public record NotificationDto(
        Long id,
        NotificationType type,
        String title,
        String message,
        UUID orderId,
        String displayCode,
        String actionUrl,
        boolean read,
        Instant createdAt) {}
