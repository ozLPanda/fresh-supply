package kz.company.shop.alibabaSourcing.dto;

import java.math.BigDecimal;

public record AlibabaSourcingOfferDto(
        Long id,
        int position,
        String productName,
        String productUrl,
        BigDecimal priceFrom,
        BigDecimal priceTo,
        String currency,
        BigDecimal minimumOrderQuantity,
        String minimumOrderUnit,
        String companyName,
        String companyUrl,
        String companyCountry,
        Integer companyAgeYears,
        Boolean verifiedSupplier,
        BigDecimal rating,
        Integer reviewCount,
        String description,
        boolean selected) {}
