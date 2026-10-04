package kz.company.shop.orders.dto;

import java.math.BigDecimal;

public record OrderPriceTierItemDto(Long orderItemId, BigDecimal unitPrice) {}
