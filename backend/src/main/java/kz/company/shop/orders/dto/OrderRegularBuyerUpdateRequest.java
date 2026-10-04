package kz.company.shop.orders.dto;

import java.util.UUID;

/** Null explicitly clears the recipient binding. */
public record OrderRegularBuyerUpdateRequest(UUID regularBuyerId) {}
