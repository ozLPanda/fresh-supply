package kz.company.shop.carts.dto;

import java.math.BigDecimal;
import kz.company.shop.orders.entity.PriceTier;

public record CartPriceTierDto(
        PriceTier tier,
        boolean permissionAvailable,
        boolean available,
        BigDecimal subtotal,
        BigDecimal threshold,
        BigDecimal remaining,
        int missingPriceItemCount) {}
