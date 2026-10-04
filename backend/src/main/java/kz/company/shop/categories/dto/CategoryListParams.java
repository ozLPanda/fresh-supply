package kz.company.shop.categories.dto;

public record CategoryListParams(
        int page, int size, String search, Boolean active, String sort, String direction) {}
