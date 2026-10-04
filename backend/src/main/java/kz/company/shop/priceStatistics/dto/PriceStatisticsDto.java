package kz.company.shop.priceStatistics.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class PriceStatisticsDto {
    private PriceStatisticsDto() {}

    public record ImportSummary(
            UUID importId,
            Instant startedAt,
            Instant completedAt,
            List<String> fileNames,
            List<String> createdByNames,
            int importCount,
            int changedProducts,
            int changedPricePoints,
            BigDecimal averageChangePercent,
            List<PriceTypeSummary> priceTypes,
            String source,
            String sourceName) {}

    public record PriceTypeSummary(
            String priceType,
            int changedProducts,
            int changedPricePoints,
            BigDecimal averageChangePercent) {}

    public record ImportDetail(ImportSummary summary) {}

    public record CategoryStat(
            Long categoryId,
            String categoryName,
            int changedProducts,
            int changedPricePoints,
            BigDecimal averageChangePercent) {}

    public record ProductStat(
            Long productId,
            String sku,
            String productName,
            Long categoryId,
            String categoryName,
            int changedPricePoints,
            BigDecimal averageChangePercent,
            List<PriceChange> changes) {}

    public record PriceChange(
            String priceType, BigDecimal oldPrice, BigDecimal newPrice, BigDecimal changePercent) {}

    public record PeriodAnalytics(
            String priceType,
            String period,
            int changedProducts,
            int increasedProducts,
            int decreasedProducts,
            int unstableProducts,
            BigDecimal averageNetChangePercent,
            List<ProductTrend> products,
            List<CategoryTrend> categories) {}

    public record ProductTrend(
            Long productId,
            String sku,
            String productName,
            Long categoryId,
            String categoryName,
            BigDecimal startPrice,
            BigDecimal currentPrice,
            BigDecimal netChangePercent,
            int updateCount,
            int increaseCount,
            int decreaseCount,
            BigDecimal averageAbsoluteChangePercent,
            BigDecimal maximumAbsoluteChangePercent) {}

    public record CategoryTrend(
            Long categoryId,
            String categoryName,
            int productCount,
            int increasedProducts,
            int decreasedProducts,
            int updateCount,
            BigDecimal averageNetChangePercent,
            BigDecimal averageVolatilityPercent,
            BigDecimal maximumVolatilityPercent) {}

    /** Internal price history used by the admin analytics drill-down. */
    public record ProductTrendHistory(
            Long productId,
            String sku,
            String productName,
            String priceType,
            String period,
            List<PriceTrendPoint> points) {}

    public record PriceTrendPoint(
            Instant changedAt,
            BigDecimal oldPrice,
            BigDecimal newPrice,
            BigDecimal changePercent,
            String source,
            String sourceName) {}
}
