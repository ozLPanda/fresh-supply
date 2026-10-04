package kz.company.shop.procurement.dto;

import java.time.Instant;

public record ProcurementCompanyNoteDto(
        Long id,
        String content,
        Long authorUserId,
        String authorName,
        Instant createdAt,
        Instant updatedAt) {}
