package kz.company.shop.orders.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record OrderPriceUpdateItemRequest(
        @NotNull Long orderItemId, @NotNull @DecimalMin("0.00") BigDecimal unitPrice) {}
