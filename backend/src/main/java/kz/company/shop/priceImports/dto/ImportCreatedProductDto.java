package kz.company.shop.priceImports.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record ImportCreatedProductDto(
        Long id,
        String sku,
        String nameRu,
        BigDecimal price,
        BigDecimal wholesalePrice,
        BigDecimal bulkWholesalePrice,
        BigDecimal skoPrice,
        boolean active,
        Long categoryId,
        String categoryName,
        UUID importId,
        String importFileName,
        Instant importedAt) {}
