package kz.company.shop.carts.dto;

import jakarta.validation.constraints.NotNull;
import kz.company.shop.orders.entity.PriceTier;

public record TemporaryInvoiceCreateRequest(
        @NotNull PriceTier priceTier, @NotNull TemporaryInvoicePreviewRequest selection) {}
