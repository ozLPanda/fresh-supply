package kz.company.shop.carts.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

public record CartItemRequest(@NotNull Long productId, @Min(1) @Max(999) int quantity) {}
