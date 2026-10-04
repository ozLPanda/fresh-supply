package kz.company.shop.priceImports.dto;

import java.util.UUID;

public record PriceImportCommitDto(
        UUID id, String status, int created, int updated, int unchanged, int skipped) {}
