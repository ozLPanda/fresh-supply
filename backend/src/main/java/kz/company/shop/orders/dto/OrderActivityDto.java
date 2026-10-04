package kz.company.shop.orders.dto;

import java.time.Instant;
import java.util.List;

/** One entry in the staff-visible activity timeline of an order. */
public record OrderActivityDto(
        String id,
        String category,
        String action,
        String description,
        List<OrderActivityChangeDto> changes,
        Long actorUserId,
        String actorName,
        Instant occurredAt) {}
