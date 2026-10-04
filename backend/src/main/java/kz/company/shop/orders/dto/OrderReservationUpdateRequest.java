package kz.company.shop.orders.dto;

import java.time.Instant;

/** An omitted value keeps the default reservation duration of 24 hours. */
public record OrderReservationUpdateRequest(Instant expiresAt) {}
