package kz.company.shop.carts.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.util.List;

public record CartSelectionPreviewRequest(
        @NotEmpty List<@NotNull @Positive Long> cartItemIds, boolean useDiscountPrices) {
    public CartSelectionPreviewRequest(List<Long> cartItemIds) {
        this(cartItemIds, false);
    }
}
