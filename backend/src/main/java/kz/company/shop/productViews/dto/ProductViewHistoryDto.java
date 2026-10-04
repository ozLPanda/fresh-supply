package kz.company.shop.productViews.dto;

import java.util.List;

/** Time-series data for the expandable product-view analytics row. */
public record ProductViewHistoryDto(Long productId, List<Point> points) {
    public record Point(String period, long views) {}
}
