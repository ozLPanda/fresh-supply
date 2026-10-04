package kz.company.shop.priceImports.dto;

import java.time.Instant;
import java.util.UUID;

public record ImportCreatedProductImportDto(
        UUID importId, String fileName, Instant completedAt, int createdCount) {}
