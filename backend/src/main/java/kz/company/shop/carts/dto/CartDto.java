package kz.company.shop.carts.dto;

import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.orders.entity.PriceTier;

public record CartDto(
        List<CartItemDto> items,
        int itemCount,
        BigDecimal total,
        PriceTier priceTier,
        List<CartPriceTierDto> priceTiers) {}
