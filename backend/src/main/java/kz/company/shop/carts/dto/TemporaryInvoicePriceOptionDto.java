package kz.company.shop.carts.dto;

import java.math.BigDecimal;
import kz.company.shop.orders.entity.PriceTier;

public record TemporaryInvoicePriceOptionDto(
        PriceTier priceTier, BigDecimal total, BigDecimal profit) {}
