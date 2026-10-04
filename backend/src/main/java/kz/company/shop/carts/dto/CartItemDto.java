package kz.company.shop.carts.dto;

import java.math.BigDecimal;
import kz.company.shop.orders.entity.PriceTier;

public record CartItemDto(
        Long id,
        Long productId,
        String sku,
        String nameRu,
        BigDecimal price,
        BigDecimal regularPrice,
        boolean wholesale,
        boolean available,
        boolean madeToOrder,
        int quantity,
        BigDecimal lineTotal,
        String imagePath,
        String imageContentHash,
        BigDecimal personalDiscountPercent,
        PriceTier priceTier) {}
