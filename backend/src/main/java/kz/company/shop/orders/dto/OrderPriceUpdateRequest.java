package kz.company.shop.orders.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;
import kz.company.shop.orders.entity.PriceTier;

public record OrderPriceUpdateRequest(
        @NotEmpty List<@Valid OrderPriceUpdateItemRequest> items, PriceTier priceTier) {

    public OrderPriceUpdateRequest(List<@Valid OrderPriceUpdateItemRequest> items) {
        this(items, null);
    }
}
