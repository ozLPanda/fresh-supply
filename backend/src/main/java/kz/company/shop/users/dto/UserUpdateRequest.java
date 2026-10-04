package kz.company.shop.users.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record UserUpdateRequest(
        @NotBlank @Size(max = 160) String name,
        @Email @Size(max = 180) String email,
        @NotBlank @Size(max = 40) String phone,
        Boolean active,
        @DecimalMin("0.00") @DecimalMax("100.00") BigDecimal personalDiscountPercent) {}
