package kz.company.shop.orders.dto;

import java.math.BigDecimal;
import java.util.UUID;

/** Compact posted-return totals used by the administrative orders list. */
public record OrderReturnStatisticDto(
        UUID orderId, BigDecimal returnedQuantity, BigDecimal returnedTotal) {}
