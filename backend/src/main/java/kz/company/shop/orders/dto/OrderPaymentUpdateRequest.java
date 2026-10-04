package kz.company.shop.orders.dto;

import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import kz.company.shop.orders.entity.CashlessPaymentType;
import kz.company.shop.orders.entity.PaymentMethod;

/** Payment allocation correction for an already completed order. */
public record OrderPaymentUpdateRequest(
        @NotNull PaymentMethod paymentMethod,
        BigDecimal cashAmount,
        BigDecimal cashlessAmount,
        CashlessPaymentType cashlessPaymentType,
        BigDecimal transferAmount,
        BigDecimal cardAmount,
        BigDecimal qrAmount) {}
