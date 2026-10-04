package kz.company.shop.orders.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.orders.entity.CashlessPaymentType;
import kz.company.shop.orders.entity.PaymentMethod;

public record OrderPaymentCompletionRequest(
        @NotNull PaymentMethod paymentMethod,
        BigDecimal cashAmount,
        BigDecimal cashlessAmount,
        CashlessPaymentType cashlessPaymentType,
        BigDecimal transferAmount,
        BigDecimal cardAmount,
        BigDecimal qrAmount,
        @Size(max = 2000) String comment,
        @Size(max = 2000) String printComment,
        boolean releaseWithStockShortage,
        @Size(max = 2000) String stockShortageComment,
        List<@NotNull @Valid OrderItemUnitRequest> itemUnits) {
    /** Compatibility overload for callers that predate invoice measurement metadata. */
    public OrderPaymentCompletionRequest(
            PaymentMethod paymentMethod,
            BigDecimal cashAmount,
            BigDecimal cashlessAmount,
            CashlessPaymentType cashlessPaymentType,
            BigDecimal transferAmount,
            BigDecimal cardAmount,
            BigDecimal qrAmount,
            String comment,
            String printComment,
            boolean releaseWithStockShortage,
            String stockShortageComment) {
        this(
                paymentMethod,
                cashAmount,
                cashlessAmount,
                cashlessPaymentType,
                transferAmount,
                cardAmount,
                qrAmount,
                comment,
                printComment,
                releaseWithStockShortage,
                stockShortageComment,
                null);
    }
}
