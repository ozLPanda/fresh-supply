package kz.company.shop.users.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;
import java.util.Set;

public record UserDto(
        Long id,
        @NotBlank String name,
        @Email String email,
        String phone,
        Boolean active,
        BigDecimal personalDiscountPercent,
        String password,
        Set<Long> roleIds,
        Set<Long> permissionIds,
        Set<String> permissions) {}
