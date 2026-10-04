package kz.company.shop.audit.dto;

import java.time.Instant;

public record AuditLogDto(
        Long id,
        Long actorUserId,
        String actorName,
        String action,
        String entityType,
        String entityId,
        String description,
        Instant createdAt) {}
