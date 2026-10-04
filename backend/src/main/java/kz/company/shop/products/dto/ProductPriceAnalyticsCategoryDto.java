package kz.company.shop.products.dto;

import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto.PriceType;

/** Aggregated markup statistics for a product category. */
public record ProductPriceAnalyticsCategoryDto(
        Long categoryId,
        String categoryNameRu,
        long productCount,
        List<PriceLevelSummary> priceLevels) {
    public record PriceLevelSummary(
            PriceType type,
            long productCount,
            BigDecimal averageMarkupPercent,
            BigDecimal minimumMarkupPercent,
            BigDecimal maximumMarkupPercent) {}
}
