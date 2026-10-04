package kz.company.shop.orders.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Posted customer returns, calculated from warehouse documents without changing the original sale. */
public record OrderReturnSummaryDto(
        BigDecimal originalTotal,
        BigDecimal returnedTotal,
        BigDecimal remainingTotal,
        List<Item> items,
        List<Document> documents) {
    public record Item(
            Long orderItemId,
            BigDecimal orderedQuantity,
            BigDecimal returnedQuantity,
            BigDecimal remainingQuantity,
            BigDecimal originalAmount,
            BigDecimal returnedAmount,
            BigDecimal remainingAmount) {}

    public record Document(
            UUID id,
            String documentNumber,
            Instant postedAt,
            BigDecimal total,
            List<Line> lines) {}

    public record Line(
            Long orderItemId, String productName, BigDecimal quantity, BigDecimal amount) {}
}
