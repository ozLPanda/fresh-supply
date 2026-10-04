package kz.company.shop.orders.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.GlobalExceptionHandler;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.dto.BarcodeOrderCustomerDto;
import kz.company.shop.orders.dto.BarcodeOrderProductDto;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.entity.CashlessPaymentType;
import kz.company.shop.orders.entity.PaymentMethod;
import kz.company.shop.orders.service.BarcodeOrderService;
import kz.company.shop.orders.service.OrderService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class BarcodeOrderControllerTest {
    private final BarcodeOrderService barcodeOrders = mock(BarcodeOrderService.class);
    private final OrderService orders = mock(OrderService.class);
    private final AuthContext auth = mock(AuthContext.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc =
                MockMvcBuilders.standaloneSetup(
                                new BarcodeOrderController(barcodeOrders, orders, auth))
                        .setControllerAdvice(new GlobalExceptionHandler())
                        .build();
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                7L,
                                "admin@example.com",
                                "Admin",
                                null,
                                Set.of("orders.update"),
                                true,
                                BigDecimal.ZERO));
    }

    @Test
    void releasePassesSelectedItemUnitsToService() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(
                        post("/api/admin/orders/" + id + "/complete-payment")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"paymentMethod\":\"CASH\",\"itemUnits\":[{\"orderItemId\":101,\"measurementUnit\":\"KG\"}]}"))
                .andExpect(status().isOk());
        verify(orders)
                .completePayment(
                        id,
                        7L,
                        PaymentMethod.CASH,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        false,
                        null,
                        List.of(
                                new kz.company.shop.orders.dto.OrderItemUnitRequest(
                                        101L, kz.company.shop.products.entity.MeasurementUnit.KG)));
    }

    @Test
    void releaseRejectsMissingOrUnsupportedMeasurementUnits() throws Exception {
        for (String item :
                List.of(
                        "{\"orderItemId\":101}",
                        "{\"orderItemId\":101,\"measurementUnit\":\"LITER\"}",
                        "null")) {
            mvc.perform(
                            post("/api/admin/orders/" + UUID.randomUUID() + "/complete-payment")
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(
                                            "{\"paymentMethod\":\"CASH\",\"itemUnits\":["
                                                    + item
                                                    + "]}"))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(orders);
    }

    @Test
    void lookupChecksPermissionAndReturnsProduct() throws Exception {
        when(barcodeOrders.findProduct(any(), any(), any()))
                .thenReturn(
                        new BarcodeOrderProductDto(
                                11L,
                                "ABC-001",
                                "Товар",
                                "/uploads/product.webp",
                                false,
                                new BigDecimal("250"),
                                new BigDecimal("200"),
                                new BigDecimal("180"),
                                new BigDecimal("170")));

        mvc.perform(
                        get("/api/admin/barcode-orders/products/ABC-001")
                                .param("priceTier", "RETAIL")
                                .param("orderDate", "2026-09-01"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sku").value("ABC-001"))
                .andExpect(jsonPath("$.data.name").value("Товар"));

        verify(auth).require("orders.update");
        verify(barcodeOrders).findProduct(any(), any(), any());
    }

    @Test
    void customersUseOrderPermissionAndExposeLimitedData() throws Exception {
        when(barcodeOrders.customers())
                .thenReturn(
                        List.of(
                                new BarcodeOrderCustomerDto(
                                        4L, "Клиент", "client@example.com", "+7")));

        mvc.perform(get("/api/admin/barcode-orders/customers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(4))
                .andExpect(jsonPath("$.data[0].name").value("Клиент"))
                .andExpect(jsonPath("$.data[0].password").doesNotExist());

        verify(auth).require("orders.update");
        verify(barcodeOrders).customers();
    }

    @Test
    void createPassesExplicitMeasurementUnit() throws Exception {
        when(barcodeOrders.create(any(), eq(7L))).thenReturn(mock(OrderDto.class));
        mvc.perform(
                        post("/api/admin/barcode-orders")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                {"priceTier":"RETAIL","orderDate":"2026-09-01",
                                 "items":[{"productId":11,"quantity":0.1,"unitPrice":200,"measurementUnit":"KG"}]}
                                """))
                .andExpect(status().isOk());
        var captured =
                org.mockito.ArgumentCaptor.forClass(
                        kz.company.shop.orders.dto.BarcodeOrderCreateRequest.class);
        verify(barcodeOrders).create(captured.capture(), eq(7L));
        org.assertj.core.api.Assertions.assertThat(
                        captured.getValue().items().getFirst().measurementUnit())
                .isEqualTo(kz.company.shop.products.entity.MeasurementUnit.KG);
    }

    @Test
    void createRejectsUnsupportedMeasurementUnit() throws Exception {
        mvc.perform(
                        post("/api/admin/barcode-orders")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                {"priceTier":"RETAIL","orderDate":"2026-09-01",
                                 "items":[{"productId":11,"quantity":0.1,"unitPrice":200,"measurementUnit":"LITER"}]}
                                """))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(barcodeOrders, orders);
    }

    @Test
    void createChecksPermissionAndPassesCurrentAdmin() throws Exception {
        when(barcodeOrders.create(any(), eq(7L))).thenReturn(mock(OrderDto.class));

        mvc.perform(
                        post("/api/admin/barcode-orders")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "customerId": null,
                                          "priceTier": "WHOLESALE",
                                          "orderDate": "2026-09-01",
                                          "items": [{"productId": 11, "quantity": 0.1, "unitPrice": 200}],
                                          "comment": "Со сканера"
                                        }
                                        """))
                .andExpect(status().isOk());

        verify(auth).require("orders.update");
        verify(barcodeOrders).create(any(), eq(7L));
    }

    @Test
    void createWithStockShortageRequiresDedicatedPermission() throws Exception {
        when(barcodeOrders.create(any(), eq(7L))).thenReturn(mock(OrderDto.class));

        mvc.perform(
                        post("/api/admin/barcode-orders")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "customerId": null,
                                          "priceTier": "RETAIL",
                                          "orderDate": "2026-09-01",
                                          "items": [{"productId": 11, "quantity": 1, "unitPrice": 250}],
                                          "allowStockShortage": true
                                        }
                                        """))
                .andExpect(status().isOk());

        verify(auth).require("warehouse.negative_stock");
        verify(barcodeOrders).create(any(), eq(7L));
    }

    @Test
    void createRejectsEmptyItemsBeforePermissionCheck() throws Exception {
        mvc.perform(
                        post("/api/admin/barcode-orders")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"priceTier\":\"RETAIL\",\"items\":[]}"))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(barcodeOrders, orders);
    }

    @Test
    void createRejectsQuantityBelowOneThousandthBeforePermissionCheck() throws Exception {
        mvc.perform(
                        post("/api/admin/barcode-orders")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "priceTier": "RETAIL",
                                          "orderDate": "2026-09-01",
                                          "items": [{"productId": 11, "quantity": 0.0001, "unitPrice": 200}]
                                        }
                                        """))
                .andExpect(status().isBadRequest());

        verifyNoInteractions(barcodeOrders, orders);
    }

    @Test
    void completePaymentChecksPermissionAndPassesCurrentAdmin() throws Exception {
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000015");
        when(orders.completePayment(
                        orderId,
                        7L,
                        PaymentMethod.CASH,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        false,
                        null,
                        null))
                .thenReturn(mock(OrderDto.class));

        mvc.perform(
                        post("/api/admin/orders/" + orderId + "/complete-payment")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"paymentMethod\":\"CASH\"}"))
                .andExpect(status().isOk());

        verify(auth).require("orders.update");
        verify(orders)
                .completePayment(
                        orderId,
                        7L,
                        PaymentMethod.CASH,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        false,
                        null,
                        null);
    }

    @Test
    void changesCompletedOrderPaymentWithOrdersUpdatePermission() throws Exception {
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000018");
        when(orders.updateCompletedPayment(
                        orderId,
                        7L,
                        PaymentMethod.CASHLESS,
                        null,
                        null,
                        CashlessPaymentType.CARD,
                        null,
                        null,
                        null))
                .thenReturn(mock(OrderDto.class));

        mvc.perform(
                        patch("/api/admin/orders/" + orderId + "/payment")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"paymentMethod\":\"CASHLESS\",\"cashlessPaymentType\":\"CARD\"}"))
                .andExpect(status().isOk());

        verify(auth).require("orders.update");
        verify(orders)
                .updateCompletedPayment(
                        orderId,
                        7L,
                        PaymentMethod.CASHLESS,
                        null,
                        null,
                        CashlessPaymentType.CARD,
                        null,
                        null,
                        null);
    }

    @Test
    void shortageReleaseRequiresSeparatePermission() throws Exception {
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000016");
        when(orders.completePayment(
                        orderId,
                        7L,
                        PaymentMethod.CASH,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        true,
                        "Отпущено по согласованию",
                        null))
                .thenReturn(mock(OrderDto.class));

        mvc.perform(
                        post("/api/admin/orders/" + orderId + "/complete-payment")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {
                                          "paymentMethod":"CASH",
                                          "releaseWithStockShortage":true,
                                          "stockShortageComment":"Отпущено по согласованию"
                                        }
                                        """))
                .andExpect(status().isOk());

        verify(auth).require("orders.update");
        verify(auth).require("warehouse.negative_stock");
        verify(orders)
                .completePayment(
                        orderId,
                        7L,
                        PaymentMethod.CASH,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        true,
                        "Отпущено по согласованию",
                        null);
    }
}
