package kz.company.shop.orders.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PastOrPresent;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import kz.company.shop.orders.entity.PriceTier;

public record BarcodeOrderCreateRequest(
        @Positive Long customerId,
        @Size(max = 180) String pendingCustomerEmail,
        @Size(max = 40) String pendingCustomerPhone,
        @NotNull PriceTier priceTier,
        @NotNull @PastOrPresent LocalDate orderDate,
        @NotEmpty @Size(max = 200) List<@Valid BarcodeOrderItemRequest> items,
        @Size(max = 2000) String comment,
        boolean allowStockShortage,
        UUID regularBuyerId) {
    public BarcodeOrderCreateRequest(Long customerId, String pendingCustomerEmail,
            String pendingCustomerPhone, PriceTier priceTier, LocalDate orderDate,
            List<BarcodeOrderItemRequest> items, String comment, boolean allowStockShortage) {
        this(customerId, pendingCustomerEmail, pendingCustomerPhone, priceTier, orderDate,
                items, comment, allowStockShortage, null);
    }
}
