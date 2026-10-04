package kz.company.shop.orders.dto;

/** A single, human-readable before/after field change in an order activity event. */
public record OrderActivityChangeDto(String field, String before, String after) {}
