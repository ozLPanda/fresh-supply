package kz.company.shop.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LoginRequest(
        @NotBlank @Size(max = 40) String phone,
        @NotBlank @Size(min = 8, max = 100) String password) {}
