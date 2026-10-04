package kz.company.shop.orders.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record OrderItemOrderUpdateRequest(@NotEmpty List<@NotNull Long> itemIds) {}
