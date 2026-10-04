package kz.company.shop.orders.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record OrderManualItemCreateRequest(
        @NotBlank @Size(max = 260) String nameRu,
        @NotNull @DecimalMin(value = "0.01") BigDecimal unitPrice,
        @NotNull @DecimalMin("0.001") @DecimalMax("999.0") @Digits(integer = 3, fraction = 3)
                BigDecimal quantity) {}
