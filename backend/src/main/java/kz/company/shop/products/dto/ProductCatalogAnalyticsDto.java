package kz.company.shop.products.dto;

/** Aggregates for the complete filtered catalogue, independent from table pagination. */
public record ProductCatalogAnalyticsDto(
        long totalItems,
        long withoutCategory,
        long activeItems,
        long withoutImages,
        long withoutIncomingPrice) {}
