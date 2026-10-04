package kz.company.shop.procurement.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import kz.company.shop.procurement.entity.ProcurementStatus;

public record ProcurementProjectDto(
        Long id,
        String name,
        String purchaseInformation,
        ProcurementStatus status,
        Long createdByUserId,
        Instant createdAt,
        Instant updatedAt,
        long companiesCount,
        List<ProcurementCompanyDto> companies,
        List<ProcurementFileDto> files,
        List<ProcurementPaymentDto> payments,
        List<ProcurementStatusHistoryDto> statusHistory,
        BigDecimal totalPaid) {}
