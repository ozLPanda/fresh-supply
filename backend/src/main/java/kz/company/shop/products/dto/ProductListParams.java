package kz.company.shop.products.dto;

import java.math.BigDecimal;

public record ProductListParams(
        int page,
        int size,
        String search,
        String category,
        BigDecimal minPrice,
        BigDecimal maxPrice,
        Boolean inStock,
        Boolean active,
        String sort,
        String direction,
        Boolean excludeImportCreated,
        boolean missingIncomingPrice,
        boolean lexicalOnly,
        boolean includeInternalPrices,
        boolean tokenSearch) {
    public ProductListParams(
            int page,
            int size,
            String search,
            String category,
            BigDecimal minPrice,
            BigDecimal maxPrice,
            Boolean inStock,
            Boolean active,
            String sort,
            String direction,
            Boolean excludeImportCreated,
            boolean lexicalOnly) {
        this(
                page,
                size,
                search,
                category,
                minPrice,
                maxPrice,
                inStock,
                active,
                sort,
                direction,
                excludeImportCreated,
                false,
                lexicalOnly,
                false,
                false);
    }
}
