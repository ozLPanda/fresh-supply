package kz.company.shop.orders.controller;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.service.OrderActivityService;
import kz.company.shop.orders.service.OrderComparisonPdfService;
import kz.company.shop.orders.service.OrderIncomingPriceCheckService;
import kz.company.shop.orders.service.OrderInvoicePdfService;
import kz.company.shop.orders.service.OrderReturnSummaryService;
import kz.company.shop.orders.service.OrderService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class OrderControllerTest {
    private final OrderService orders = mock(OrderService.class);
    private final OrderComparisonPdfService comparisonPdf = mock(OrderComparisonPdfService.class);
    private final OrderInvoicePdfService invoicePdf = mock(OrderInvoicePdfService.class);
    private final OrderReturnSummaryService returns = mock(OrderReturnSummaryService.class);
    private final AuthContext auth = mock(AuthContext.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc =
                MockMvcBuilders.standaloneSetup(
                                new OrderController(
                                        orders,
                                        invoicePdf,
                                        comparisonPdf,
                                        mock(OrderIncomingPriceCheckService.class),
                                        returns,
                                        mock(OrderActivityService.class),
                                        auth))
                        .setControllerAdvice(new GlobalExceptionHandler())
                        .build();
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                7L,
                                "admin@example.com",
                                "Admin",
                                null,
                                Set.of("orders.read"),
                                true,
                                BigDecimal.ZERO));
    }

    @Test
    void regularBuyerEndpointChecksPermissionAndPassesBindingAndClear() throws Exception {
        UUID id = UUID.randomUUID();
        UUID buyerId = UUID.randomUUID();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(
                        "/api/admin/orders/" + id + "/regular-buyer")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"regularBuyerId\":\"" + buyerId + "\"}"))
                .andExpect(status().isOk());
        verify(orders).updateRegularBuyer(id, buyerId, 7L);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put(
                        "/api/admin/orders/" + id + "/regular-buyer")
                .contentType(MediaType.APPLICATION_JSON).content("{\"regularBuyerId\":null}"))
                .andExpect(status().isOk());
        verify(orders).updateRegularBuyer(id, null, 7L);
        org.mockito.Mockito.verify(auth, org.mockito.Mockito.times(2)).require("orders.update");
    }

    @Test
    void itemUnitEndpointChecksPermissionAndPassesCurrentActor() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch(
                                        "/api/admin/orders/" + id + "/items/101/measurement-unit")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"measurementUnit\":\"KG\"}"))
                .andExpect(status().isOk());
        verify(auth).require("orders.update");
        verify(orders)
                .updateItemMeasurementUnit(
                        id,
                        101L,
                        new kz.company.shop.orders.dto.OrderItemMeasurementUnitUpdateRequest(
                                kz.company.shop.products.entity.MeasurementUnit.KG),
                        7L);
    }

    @Test
    void itemUnitEndpointRejectsMissingNullAndUnknownUnits() throws Exception {
        for (String body :
                java.util.List.of(
                        "{}", "{\"measurementUnit\":null}", "{\"measurementUnit\":\"LITER\"}")) {
            mvc.perform(
                            org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                                    .patch(
                                            "/api/admin/orders/"
                                                    + UUID.randomUUID()
                                                    + "/items/101/measurement-unit")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(body))
                    .andExpect(status().isBadRequest());
        }
        org.mockito.Mockito.verifyNoInteractions(orders);
    }

    @Test
    void paidOrderStatusReleasePassesSelectedItemUnits() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(
                        org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch(
                                        "/api/admin/orders/" + id + "/status")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"status\":\"COMPLETED\",\"itemUnits\":[{\"orderItemId\":101,\"measurementUnit\":\"PIECE\"}]}"))
                .andExpect(status().isOk());
        verify(orders)
                .updateStatus(
                        id,
                        kz.company.shop.orders.entity.OrderStatus.COMPLETED,
                        7L,
                        java.util.List.of(
                                new kz.company.shop.orders.dto.OrderItemUnitRequest(
                                        101L,
                                        kz.company.shop.products.entity.MeasurementUnit.PIECE)));
    }

    @Test
    void z2PdfUsesOrderReturnsAndCommentChoiceWithoutChangingOrder() throws Exception {
        UUID id = UUID.randomUUID();
        var order = mock(kz.company.shop.orders.dto.OrderDto.class);
        var summary = mock(kz.company.shop.orders.dto.OrderReturnSummaryDto.class);
        when(order.displayCode()).thenReturn("45");
        when(orders.adminGet(id)).thenReturn(order);
        when(returns.summary(id)).thenReturn(summary);
        byte[] pdf = "%PDF-z2".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        when(invoicePdf.generateZ2(order, summary, true)).thenReturn(pdf);
        when(invoicePdf.generateZ2(order, summary, false)).thenReturn(pdf);

        for (String query : java.util.List.of("", "?includePrintComment=false")) {
            mvc.perform(get("/api/admin/orders/" + id + "/invoice-z2.pdf" + query))
                    .andExpect(status().isOk())
                    .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                    .andExpect(header().string("Content-Disposition",
                            "inline; filename=\"nakladnaya-z2-45.pdf\""))
                    .andExpect(content().bytes(pdf));
        }
        verify(invoicePdf).generateZ2(order, summary, true);
        verify(invoicePdf).generateZ2(order, summary, false);
        verify(auth, org.mockito.Mockito.times(2)).require("orders.read");
        verify(orders, org.mockito.Mockito.times(2)).adminGet(id);
        org.mockito.Mockito.verifyNoMoreInteractions(orders, invoicePdf);
    }

    @Test
    void z2PdfDeniesAccessBeforeReadingOrderWithoutPermission() throws Exception {
        org.mockito.Mockito.doThrow(new kz.company.shop.common.exception.AppExceptions.Forbidden("orders.read"))
                .when(auth).require("orders.read");
        mvc.perform(get("/api/admin/orders/{id}/invoice-z2.pdf", UUID.randomUUID()))
                .andExpect(status().isForbidden());
        org.mockito.Mockito.verifyNoInteractions(orders, returns, invoicePdf);
    }

    @Test
    void comparisonPdfUsesReadPermissionAndReturnsInlinePdf() throws Exception {
        UUID orderId = UUID.randomUUID();
        byte[] pdf = "%PDF-comparison".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        when(comparisonPdf.generate(orderId)).thenReturn(pdf);

        mvc.perform(get("/api/admin/orders/{id}/comparison.pdf", orderId))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                .andExpect(
                        header().string(
                                        "Content-Disposition",
                                        org.hamcrest.Matchers.containsString(
                                                "inline; filename=\"order-comparison-"
                                                        + orderId
                                                        + ".pdf\"")))
                .andExpect(content().bytes(pdf));

        verify(auth).require("orders.read");
        verify(orders).adminGet(eq(orderId));
        verify(comparisonPdf).generate(orderId);
    }
}
