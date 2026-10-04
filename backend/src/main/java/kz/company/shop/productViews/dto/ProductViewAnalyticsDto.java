package kz.company.shop.productViews.dto;

/** A product row with the total number of recorded unique views. */
public record ProductViewAnalyticsDto(
        Long productId, String sku, String nameRu, String categoryNameRu, long views) {}
