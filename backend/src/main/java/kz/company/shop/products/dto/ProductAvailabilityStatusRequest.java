package kz.company.shop.products.dto;

import jakarta.validation.constraints.NotNull;

public record ProductAvailabilityStatusRequest(@NotNull Status status) {
    public enum Status {
        HIDDEN,
        MADE_TO_ORDER,
        AVAILABLE
    }
}
