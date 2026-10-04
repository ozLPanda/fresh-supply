package kz.company.shop.orders.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.dto.OrderReturnSummaryDto;
import kz.company.shop.orders.service.OrderPaymentInvoicePdfService;
import kz.company.shop.orders.service.OrderReturnSummaryService;
import kz.company.shop.orders.service.OrderService;
import kz.company.shop.regularbuyers.service.RegularBuyerService;
import kz.company.shop.settings.dto.PaymentInvoiceSettingsDto;
import kz.company.shop.settings.service.PaymentInvoiceSettingsService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OrderPaymentInvoiceControllerTest {
    private final OrderService orders = mock(OrderService.class);
    private final OrderReturnSummaryService returns = mock(OrderReturnSummaryService.class);
    private final RegularBuyerService buyers = mock(RegularBuyerService.class);
    private final OrderPaymentInvoicePdfService pdf = mock(OrderPaymentInvoicePdfService.class);
    private final AuthContext auth = mock(AuthContext.class);
    private final PaymentInvoiceSettingsService settings = mock(PaymentInvoiceSettingsService.class);
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.standaloneSetup(
                        new OrderPaymentInvoiceController(orders, returns, buyers, pdf, auth, settings))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        when(settings.get()).thenReturn(PaymentInvoiceSettingsDto.defaults());
    }

    @Test
    void returnsInlinePdfUsingOrderAndBuyerDetailsWithoutChangingOrder() throws Exception {
        UUID id = UUID.randomUUID();
        UUID buyerId = UUID.randomUUID();
        OrderDto order = mock(OrderDto.class);
        OrderReturnSummaryDto summary = mock(OrderReturnSummaryDto.class);
        when(order.displayCode()).thenReturn("45");
        when(order.regularBuyerId()).thenReturn(buyerId);
        when(order.regularBuyerName()).thenReturn("ИП Покупатель");
        when(orders.adminGet(id)).thenReturn(order);
        when(returns.summary(id)).thenReturn(summary);
        when(buyers.paymentInvoiceBuyerDetails(buyerId, "ИП Покупатель"))
                .thenReturn("ИИН/БИН: 123456789012, ИП Покупатель, Алматы");
        byte[] bytes = "%PDF-test".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        when(pdf.generate(order, summary, "ИИН/БИН: 123456789012, ИП Покупатель, Алматы", PaymentInvoiceSettingsDto.defaults()))
                .thenReturn(bytes);
        mvc.perform(get("/api/admin/orders/{id}/payment-invoice.pdf", id))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                .andExpect(header().string("Content-Disposition", "inline; filename=\"schet-na-oplatu-45.pdf\""))
                .andExpect(content().bytes(bytes));
        verify(auth).require("orders.read");
        verify(orders).adminGet(id);
        verifyNoMoreInteractions(orders);
    }

    @Test
    void deniesPrintingBeforeReadingOrderWithoutPermission() throws Exception {
        doThrow(new AppExceptions.Forbidden("orders.read")).when(auth).require("orders.read");
        mvc.perform(get("/api/admin/orders/{id}/payment-invoice.pdf", UUID.randomUUID()))
                .andExpect(status().isForbidden());
        verifyNoInteractions(orders, returns, buyers, pdf);
    }

    @Test
    void missingOrDeletedOrderCannotBePrinted() throws Exception {
        when(orders.adminGet(any())).thenThrow(new AppExceptions.NotFound("Заказ не найден"));
        mvc.perform(get("/api/admin/orders/{id}/payment-invoice.pdf", UUID.randomUUID()))
                .andExpect(status().isNotFound());
        verifyNoInteractions(returns, buyers, pdf);
    }
}
