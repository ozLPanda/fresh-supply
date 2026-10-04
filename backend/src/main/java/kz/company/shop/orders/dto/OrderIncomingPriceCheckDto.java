package kz.company.shop.orders.dto;

import java.math.BigDecimal;
import java.util.List;

/**
 * Internal-only data for the staff order screen. This endpoint is protected by orders.read and is
 * not available from customer order APIs.
 */
public record OrderIncomingPriceCheckDto(boolean applicable, List<Problem> problems) {
    public record Problem(Long orderItemId, BigDecimal incomingPrice) {}
}
