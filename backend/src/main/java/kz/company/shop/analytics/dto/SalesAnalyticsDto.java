package kz.company.shop.analytics.dto;

import java.math.BigDecimal;
import java.util.List;

/** Sales analytics aggregated in the requested business-time buckets. */
public record SalesAnalyticsDto(
        String groupBy,
        String from,
        String to,
        SummaryDto totals,
        List<SeriesPointDto> series,
        List<BreakdownDto> employees,
        List<BreakdownDto> products,
        List<BreakdownDto> categories,
        List<SeriesPointDto> months,
        List<SeriesPointDto> weekdays,
        List<ActivityDto> activity,
        String timeZone) {
    public record ActivityDto(
            int weekday,
            int hour,
            long orders,
            BigDecimal items,
            BigDecimal revenue,
            BigDecimal netProfit) {}

    public record SummaryDto(
            BigDecimal revenue, BigDecimal netProfit, long orders, BigDecimal items) {}

    public record SeriesPointDto(
            String key,
            String label,
            BigDecimal revenue,
            BigDecimal netProfit,
            long orders,
            BigDecimal items) {}

    public record BreakdownDto(
            Long id,
            String name,
            BigDecimal revenue,
            BigDecimal netProfit,
            long orders,
            BigDecimal items,
            List<SeriesPointDto> series) {}
}
