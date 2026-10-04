package kz.company.shop.orders.dto;

import jakarta.validation.constraints.NotNull;

public record OrderFulfillmentItemRequest(@NotNull Boolean assembled, @NotNull Boolean checked) {}
