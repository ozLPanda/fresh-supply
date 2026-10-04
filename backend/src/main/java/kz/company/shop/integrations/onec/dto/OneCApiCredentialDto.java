package kz.company.shop.integrations.onec.dto;

import java.time.Instant;
import java.util.Set;

public record OneCApiCredentialDto(
        String id,
        String name,
        String token,
        Set<String> permissions,
        Instant expiresAt,
        Instant revokedAt,
        Instant createdAt,
        Instant updatedAt) {}
