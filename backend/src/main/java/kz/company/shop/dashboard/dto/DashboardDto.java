package kz.company.shop.dashboard.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record DashboardDto(
        int period,
        MetricDto newOrders,
        long activeProducts,
        long activeCategories,
        MetricDto productViews,
        List<RevenuePointDto> revenue,
        List<RecentProductDto> recentProducts,
        List<AuditItemDto> recentActions,
        long productsWithoutImages,
        long importErrors) {

    public record MetricDto(long value, Double trendPercent) {}

    public record RevenuePointDto(
            String key, String label, BigDecimal revenue, BigDecimal netProfit, long orders) {}

    public record RecentProductDto(
            Long id,
            String sku,
            String name,
            BigDecimal price,
            boolean active,
            Instant createdAt) {}

    public record AuditItemDto(
            Long id,
            String actorName,
            String action,
            String entityType,
            String entityId,
            String description,
            Instant createdAt) {}
}
