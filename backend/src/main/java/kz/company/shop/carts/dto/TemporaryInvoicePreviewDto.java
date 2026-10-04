package kz.company.shop.carts.dto;

import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.orders.entity.PriceTier;

public record TemporaryInvoicePreviewDto(
        List<TemporaryInvoicePriceOptionDto> priceOptions,
        PriceTier mostFavorablePriceTier,
        BigDecimal mostFavorableTotal) {}
