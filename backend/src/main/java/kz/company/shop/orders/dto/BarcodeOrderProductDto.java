package kz.company.shop.orders.dto;

import java.math.BigDecimal;
import kz.company.shop.products.entity.MeasurementUnit;

public record BarcodeOrderProductDto(
        Long id,
        String sku,
        String name,
        String mainImageUrl,
        boolean madeToOrder,
        BigDecimal retailPrice,
        BigDecimal wholesalePrice,
        BigDecimal bulkWholesalePrice,
        BigDecimal skoPrice,
        MeasurementUnit measurementUnit) {
    public BarcodeOrderProductDto(
            Long id,
            String sku,
            String name,
            String mainImageUrl,
            boolean madeToOrder,
            BigDecimal retailPrice,
            BigDecimal wholesalePrice,
            BigDecimal bulkWholesalePrice,
            BigDecimal skoPrice) {
        this(
                id,
                sku,
                name,
                mainImageUrl,
                madeToOrder,
                retailPrice,
                wholesalePrice,
                bulkWholesalePrice,
                skoPrice,
                MeasurementUnit.PIECE);
    }
}
