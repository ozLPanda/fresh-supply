package kz.company.shop.users.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ProfileUpdateRequest(
        @NotBlank @Size(max = 160) String name, @NotBlank @Size(max = 40) String phone) {}
