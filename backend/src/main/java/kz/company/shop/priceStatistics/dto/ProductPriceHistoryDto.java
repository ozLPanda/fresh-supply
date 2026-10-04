package kz.company.shop.priceStatistics.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/** Customer-facing retail price changes for a product. */
public record ProductPriceHistoryDto(String period, List<Point> points) {
    public record Point(
            Instant changedAt,
            BigDecimal oldPrice,
            BigDecimal newPrice,
            BigDecimal changePercent) {}
}
