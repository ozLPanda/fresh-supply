package kz.company.shop.products.dto;

/** One concise before/after comparison from a product-card save. */
public record ProductActivityChangeDto(String field, String before, String after) {}
