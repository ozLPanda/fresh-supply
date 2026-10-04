package kz.company.shop.orders.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import kz.company.shop.orders.entity.OrderStatus;

public record OrderStatusUpdateRequest(
        @NotNull OrderStatus status, List<@NotNull @Valid OrderItemUnitRequest> itemUnits) {
    public OrderStatusUpdateRequest(OrderStatus status) {
        this(status, null);
    }
}
