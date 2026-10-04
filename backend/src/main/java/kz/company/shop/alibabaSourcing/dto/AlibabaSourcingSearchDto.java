package kz.company.shop.alibabaSourcing.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record AlibabaSourcingSearchDto(
        UUID id,
        String status,
        String searchQuery,
        BigDecimal minimumOrderQuantity,
        Integer minimumCompanyAgeYears,
        String errorMessage,
        Instant createdAt,
        Instant completedAt,
        List<AlibabaSourcingOfferDto> results) {}
