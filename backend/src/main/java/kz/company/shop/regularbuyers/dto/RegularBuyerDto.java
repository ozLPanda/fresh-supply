package kz.company.shop.regularbuyers.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record RegularBuyerDto(
        UUID id,
        String name,
        String contactName,
        String phone,
        String email,
        String comment,
        boolean archived,
        Instant createdAt,
        Instant updatedAt,
        String taxId,
        String legalAddress,
        List<String> aliases) {
    public RegularBuyerDto {
        aliases = aliases == null ? List.of() : List.copyOf(aliases);
    }

    public RegularBuyerDto(
            UUID id,
            String name,
            String contactName,
            String phone,
            String email,
            String comment,
            boolean archived,
            Instant createdAt,
            Instant updatedAt,
            String taxId,
            String legalAddress) {
        this(
                id,
                name,
                contactName,
                phone,
                email,
                comment,
                archived,
                createdAt,
                updatedAt,
                taxId,
                legalAddress,
                List.of());
    }
}
