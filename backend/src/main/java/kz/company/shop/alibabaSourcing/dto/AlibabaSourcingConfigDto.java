package kz.company.shop.alibabaSourcing.dto;

import java.math.BigDecimal;

public record AlibabaSourcingConfigDto(
        Long productId,
        boolean enabled,
        String searchQuery,
        BigDecimal minimumOrderQuantity,
        Integer minimumCompanyAgeYears,
        Long selectedOfferId,
        AlibabaSourcingOfferDto selectedOffer) {}
