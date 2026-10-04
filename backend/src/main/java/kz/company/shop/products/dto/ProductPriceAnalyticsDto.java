package kz.company.shop.products.dto;

import java.math.BigDecimal;
import java.util.List;

/** Internal comparison of each sale price with the current incoming cost. */
public record ProductPriceAnalyticsDto(
        Long id,
        String sku,
        String nameRu,
        String categoryNameRu,
        boolean active,
        BigDecimal incomingPrice,
        List<PriceLevel> priceLevels,
        boolean hasPriceBelowIncoming) {
    public enum PriceType {
        RETAIL,
        WHOLESALE,
        BULK_WHOLESALE,
        SKO
    }

    public record PriceLevel(
            PriceType type, BigDecimal price, BigDecimal markupPercent, boolean belowIncoming) {}
}
