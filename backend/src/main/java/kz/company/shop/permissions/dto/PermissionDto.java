package kz.company.shop.permissions.dto;

public record PermissionDto(
        Long id, String code, String entityName, String actionName, String nameRu) {}
