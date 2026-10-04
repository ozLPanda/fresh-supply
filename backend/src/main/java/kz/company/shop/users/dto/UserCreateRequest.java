package kz.company.shop.users.dto;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.Set;

public record UserCreateRequest(
        @NotBlank @Size(max = 160) String name,
        @Email @Size(max = 180) String email,
        @NotBlank @Size(max = 40) String phone,
        @NotBlank @Size(min = 8, max = 100) String password,
        Boolean active,
        Set<Long> roleIds,
        @DecimalMin("0.00") @DecimalMax("100.00") BigDecimal personalDiscountPercent) {}
