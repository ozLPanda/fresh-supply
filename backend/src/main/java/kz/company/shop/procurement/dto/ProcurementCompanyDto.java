package kz.company.shop.procurement.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import kz.company.shop.procurement.entity.ProcurementCompanyStatus;

public record ProcurementCompanyDto(
        Long id,
        String name,
        String market,
        Integer marketSinceYear,
        Integer reviewsFromYear,
        Integer reviewsToYear,
        String comment,
        ProcurementCompanyStatus companyStatus,
        String decisionComment,
        BigDecimal price,
        String priceCurrency,
        List<ProcurementCompanyLinkDto> links,
        List<ProcurementFileDto> files,
        Instant createdAt,
        Instant updatedAt) {}
