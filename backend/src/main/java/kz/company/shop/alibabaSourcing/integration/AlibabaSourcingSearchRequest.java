package kz.company.shop.alibabaSourcing.integration;

import java.math.BigDecimal;

/** Normalized criteria passed to a supplier-search provider. */
public record AlibabaSourcingSearchRequest(
        String searchTerm,
        BigDecimal minimumOrderQuantity,
        Integer minimumCompanyAgeYears,
        int resultLimit) {
    public static final int MAX_RESULT_LIMIT = 10;

    public AlibabaSourcingSearchRequest(
            String searchTerm, BigDecimal minimumOrderQuantity, Integer minimumCompanyAgeYears) {
        this(searchTerm, minimumOrderQuantity, minimumCompanyAgeYears, MAX_RESULT_LIMIT);
    }

    public AlibabaSourcingSearchRequest {
        searchTerm = normalizeRequired(searchTerm, "searchTerm");
        if (searchTerm.length() > 500) {
            throw new IllegalArgumentException("searchTerm must not exceed 500 characters");
        }
        requireNonNegative(minimumOrderQuantity, "minimumOrderQuantity");
        requireNonNegative(minimumCompanyAgeYears, "minimumCompanyAgeYears");
        if (resultLimit < 1 || resultLimit > MAX_RESULT_LIMIT) {
            throw new IllegalArgumentException(
                    "resultLimit must be between 1 and " + MAX_RESULT_LIMIT);
        }
    }

    private static String normalizeRequired(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
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
}
