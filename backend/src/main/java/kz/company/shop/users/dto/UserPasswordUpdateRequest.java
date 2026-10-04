package kz.company.shop.users.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UserPasswordUpdateRequest(@NotBlank @Size(min = 8, max = 100) String newPassword) {}
