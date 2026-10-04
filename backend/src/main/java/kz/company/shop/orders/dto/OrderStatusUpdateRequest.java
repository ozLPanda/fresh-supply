package kz.company.shop.orders.dto;

import jakarta.validation.constraints.NotNull;
import kz.company.shop.orders.entity.OrderStatus;

public record OrderStatusUpdateRequest(@NotNull OrderStatus status) {}
