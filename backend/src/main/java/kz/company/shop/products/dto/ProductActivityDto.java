package kz.company.shop.products.dto;

import java.time.Instant;
import java.util.List;

/** A single immutable fact about a product collected from the audit and warehouse ledgers. */
public record ProductActivityDto(
        String id,
        String category,
        String type,
        String action,
        String description,
        List<ProductActivityChangeDto> changes,
        Long actorUserId,
        String actorName,
        Instant occurredAt,
        String documentId,
        String documentNumber,
        String orderId) {}
