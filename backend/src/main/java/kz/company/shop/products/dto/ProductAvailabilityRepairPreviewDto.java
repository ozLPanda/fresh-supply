package kz.company.shop.products.dto;

import java.util.List;

public record ProductAvailabilityRepairPreviewDto(
        Long id,
        String sku,
        String currentNameRu,
        String correctedNameRu,
        boolean active,
        boolean madeToOrder,
        List<String> matchedKeywords) {}
