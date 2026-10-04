package kz.company.shop.alibabaSourcing.integration;

import java.math.BigDecimal;

/**
 * Provider-neutral representation of a product offer and its supplier.
 *
 * <p>All monetary amounts are represented as supplied by the provider; consumers must use {@link
 * #currency()} together with {@link #priceFrom()} and {@link #priceTo()}.
 */
public record AlibabaSourcingOffer(
        String sourceProductUrl,
        String productName,
        BigDecimal priceFrom,
        BigDecimal priceTo,
        String currency,
        BigDecimal minimumOrderQuantity,
        String minimumOrderUnit,
        String supplierName,
        String supplierUrl,
        String supplierCountry,
        Integer supplierCompanyAgeYears,
        Boolean supplierVerified,
        BigDecimal supplierRating,
        String description,
        String imageUrl) {
    public AlibabaSourcingOffer {
        sourceProductUrl = normalizeRequired(sourceProductUrl, "sourceProductUrl");
        productName = normalizeRequired(productName, "productName");
        supplierName = normalizeRequired(supplierName, "supplierName");
        supplierUrl = normalizeOptional(supplierUrl);
        currency = normalizeOptional(currency);
        minimumOrderUnit = normalizeOptional(minimumOrderUnit);
        supplierCountry = normalizeOptional(supplierCountry);
        description = normalizeOptional(description);
        imageUrl = normalizeOptional(imageUrl);

        requireNonNegative(priceFrom, "priceFrom");
        requireNonNegative(priceTo, "priceTo");
        requireNonNegative(minimumOrderQuantity, "minimumOrderQuantity");
        requireNonNegative(supplierCompanyAgeYears, "supplierCompanyAgeYears");
        requireNonNegative(supplierRating, "supplierRating");
        if (priceFrom != null && priceTo != null && priceTo.compareTo(priceFrom) < 0) {
            throw new IllegalArgumentException("priceTo must not be less than priceFrom");
        }
    }

    private static String normalizeRequired(String value, String field) {
        String normalized = normalizeOptional(value);
        if (normalized == null) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return normalized;
    }

    private static String normalizeOptional(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private static void requireNonNegative(BigDecimal value, String field) {
        if (value != null && value.signum() < 0) {
            throw new IllegalArgumentException(field + " must not be negative");
        }
    }

    private static void requireNonNegative(Integer value, String field) {
        if (value != null && value < 0) {
            throw new IllegalArgumentException(field + " must not be negative");
        }
    }

    /** Alias retained for persistence mappers that use the supplier-oriented field name. */
    public Boolean verifiedSupplier() {
        return supplierVerified;
    }

    /** Alias retained for persistence mappers that use the generic rating field name. */
    public BigDecimal rating() {
        return supplierRating;
    }
}
