package kz.company.shop.orders.dto;

import java.math.BigDecimal;
import java.time.Instant;
import kz.company.shop.orders.entity.PriceTier;

public record OrderItemDto(
        Long id,
        Long productId,
        boolean madeToOrder,
        String sku,
        String nameRu,
        BigDecimal unitPrice,
        BigDecimal confirmedUnitPrice,
        boolean wholesale,
        PriceTier priceTier,
        BigDecimal quantity,
        boolean assembled,
        boolean checked,
        BigDecimal lineTotal,
        BigDecimal confirmedLineTotal,
        BigDecimal stockShortageQuantity,
        Long stockShortageReleasedByUserId,
        String stockShortageReleasedByUserName,
        Instant stockShortageReleasedAt,
        String stockShortageComment) {}
