package kz.company.shop.orders.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
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
        @Size(max = 2000) String stockShortageComment) {}
