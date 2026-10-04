package kz.company.shop.procurement.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

public record ProcurementPaymentDto(
        Long id,
        BigDecimal amount,
        String currency,
        LocalDate paidAt,
        String comment,
        Long createdByUserId,
        Instant createdAt,
        Instant updatedAt) {}
