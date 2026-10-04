package kz.company.shop.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotBlank @Size(max = 160) String name,
        @Email @Size(max = 180) String email,
        @NotBlank @Size(max = 40) String phone,
        @NotBlank @Size(min = 8, max = 100) String password) {}
