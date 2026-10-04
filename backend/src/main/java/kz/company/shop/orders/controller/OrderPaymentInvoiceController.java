package kz.company.shop.orders.controller;

import java.util.UUID;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.service.OrderPaymentInvoicePdfService;
import kz.company.shop.orders.service.OrderReturnSummaryService;
import kz.company.shop.orders.service.OrderService;
import kz.company.shop.regularbuyers.service.RegularBuyerService;
import kz.company.shop.settings.service.PaymentInvoiceSettingsService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Printing a payment invoice does not release an order or change its payment status. */
@RestController
@RequestMapping("/api/admin/orders")
public class OrderPaymentInvoiceController {
    private final OrderService orders;
    private final OrderReturnSummaryService returns;
    private final RegularBuyerService buyers;
    private final OrderPaymentInvoicePdfService pdf;
    private final AuthContext auth;
    private final PaymentInvoiceSettingsService settings;

    public OrderPaymentInvoiceController(
            OrderService orders,
            OrderReturnSummaryService returns,
            RegularBuyerService buyers,
            OrderPaymentInvoicePdfService pdf,
            AuthContext auth,
            PaymentInvoiceSettingsService settings) {
        this.orders = orders;
        this.returns = returns;
        this.buyers = buyers;
        this.pdf = pdf;
        this.auth = auth;
        this.settings = settings;
    }

    @GetMapping(value = "/{id}/payment-invoice.pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('orders.read')")
    public ResponseEntity<byte[]> paymentInvoice(@PathVariable UUID id) {
        auth.require("orders.read");
        OrderDto order = orders.adminGet(id);
        String buyerDetails =
                buyers.paymentInvoiceBuyerDetails(order.regularBuyerId(), order.regularBuyerName());
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(
                        "Content-Disposition",
                        ContentDisposition.inline()
                                .filename("schet-na-oplatu-" + order.displayCode() + ".pdf")
                                .build()
                                .toString())
                .body(pdf.generate(order, returns.summary(id), buyerDetails, settings.get()));
    }
}
