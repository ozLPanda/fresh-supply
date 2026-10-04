package kz.company.shop.products.dto;

import java.math.BigDecimal;
import java.util.EnumSet;
import java.util.Set;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto.PriceType;

public record ProductPriceAnalyticsFilter(
        BigDecimal minMarkupPercent,
        BigDecimal maxMarkupPercent,
        Set<PriceType> priceTypes,
        boolean matchAllPriceTypes) {
    public ProductPriceAnalyticsFilter {
        priceTypes =
                priceTypes == null || priceTypes.isEmpty()
                        ? EnumSet.allOf(PriceType.class)
                        : EnumSet.copyOf(priceTypes);
    }

    public boolean hasPercentRange() {
        return minMarkupPercent != null || maxMarkupPercent != null;
    }
}
