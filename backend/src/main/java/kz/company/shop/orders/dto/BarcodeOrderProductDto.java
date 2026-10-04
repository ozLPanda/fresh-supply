package kz.company.shop.orders.dto;

import java.math.BigDecimal;

public record BarcodeOrderProductDto(
        Long id,
        String sku,
        String name,
        String mainImageUrl,
        boolean madeToOrder,
        BigDecimal retailPrice,
        BigDecimal wholesalePrice,
        BigDecimal bulkWholesalePrice,
        BigDecimal skoPrice) {}
