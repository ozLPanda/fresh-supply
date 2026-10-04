package kz.company.shop.carts.dto;

import java.math.BigDecimal;

public record TemporaryInvoiceItemDto(
        String sku,
        String nameRu,
        BigDecimal quantity,
        BigDecimal unitPrice,
        BigDecimal lineTotal) {}
