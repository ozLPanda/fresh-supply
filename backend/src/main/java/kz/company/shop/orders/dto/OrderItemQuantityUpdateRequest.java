package kz.company.shop.orders.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record OrderItemQuantityUpdateRequest(
        @NotNull @DecimalMin("0.001") @DecimalMax("999.0") @Digits(integer = 3, fraction = 3)
                BigDecimal quantity) {}
