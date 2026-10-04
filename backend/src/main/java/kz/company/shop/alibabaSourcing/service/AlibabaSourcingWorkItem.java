package kz.company.shop.alibabaSourcing.service;

import java.math.BigDecimal;
import java.util.UUID;

record AlibabaSourcingWorkItem(
        UUID searchId,
        Long productId,
        String searchQuery,
        BigDecimal minimumOrderQuantity,
        Integer minimumCompanyAgeYears) {}
