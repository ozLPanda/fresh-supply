package kz.company.shop.regularbuyers.dto;

import java.time.Instant;
import java.util.UUID;

public record RegularBuyerDto(UUID id, String name, String contactName, String phone,
        String email, String comment, boolean archived, Instant createdAt, Instant updatedAt,
        String taxId, String legalAddress) {}
