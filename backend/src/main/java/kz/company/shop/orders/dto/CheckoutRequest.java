package kz.company.shop.orders.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.util.List;
import kz.company.shop.orders.entity.FulfillmentType;
import kz.company.shop.orders.entity.PaymentMethod;

public record CheckoutRequest(
        @NotEmpty List<@NotNull @Positive Long> cartItemIds,
        @NotNull FulfillmentType fulfillmentType,
        @NotNull PaymentMethod paymentMethod,
        @Size(max = 500) String address,
        @NotBlank @Size(max = 40) String contactPhone,
        @Size(max = 2000) String comment,
        boolean useDiscountPrices) {
    public CheckoutRequest(
            List<Long> cartItemIds,
            FulfillmentType fulfillmentType,
            PaymentMethod paymentMethod,
            String address,
            String contactPhone,
            String comment) {
        this(cartItemIds, fulfillmentType, paymentMethod, address, contactPhone, comment, false);
    }
}
