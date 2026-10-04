package kz.company.shop.roles.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.Set;

public record RoleDto(
        Long id,
        @NotBlank String code,
        @NotBlank String nameRu,
        String nameKk,
        boolean active,
        Set<Long> permissionIds,
        Set<String> permissions) {}
