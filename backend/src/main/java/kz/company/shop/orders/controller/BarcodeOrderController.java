package kz.company.shop.orders.controller;

import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.orders.dto.BarcodeOrderCreateRequest;
import kz.company.shop.orders.dto.BarcodeOrderCustomerDto;
import kz.company.shop.orders.dto.BarcodeOrderProductDto;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.dto.OrderPaymentCompletionRequest;
import kz.company.shop.orders.dto.OrderPaymentUpdateRequest;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.orders.service.BarcodeOrderService;
import kz.company.shop.orders.service.OrderService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasAuthority('orders.update')")
public class BarcodeOrderController {
    private final BarcodeOrderService barcodeOrderService;
    private final OrderService orderService;
    private final AuthContext auth;

    public BarcodeOrderController(
            BarcodeOrderService barcodeOrderService, OrderService orderService, AuthContext auth) {
        this.barcodeOrderService = barcodeOrderService;
        this.orderService = orderService;
        this.auth = auth;
    }

    @GetMapping("/barcode-orders/products/{code}")
    public ApiResponse<BarcodeOrderProductDto> findProduct(
            @PathVariable String code,
            @RequestParam PriceTier priceTier,
            @RequestParam LocalDate orderDate) {
        auth.require("orders.update");
        return ApiResponse.ok(barcodeOrderService.findProduct(code, priceTier, orderDate));
    }

    @GetMapping("/barcode-orders/customers")
    public ApiResponse<List<BarcodeOrderCustomerDto>> customers() {
        auth.require("orders.update");
        return ApiResponse.ok(barcodeOrderService.customers());
    }

    @PostMapping("/barcode-orders")
    public ApiResponse<OrderDto> create(@RequestBody @Valid BarcodeOrderCreateRequest request) {
        auth.require("orders.update");
        if (request.allowStockShortage()) {
            auth.require("warehouse.negative_stock");
        }
        return ApiResponse.ok(barcodeOrderService.create(request, auth.current().id()));
    }

    @PostMapping("/orders/{id}/complete-payment")
    public ApiResponse<OrderDto> completePayment(
            @PathVariable UUID id, @RequestBody @Valid OrderPaymentCompletionRequest request) {
        auth.require("orders.update");
        if (request.releaseWithStockShortage()) {
            auth.require("warehouse.negative_stock");
        }
        return ApiResponse.ok(
                orderService.completePayment(
                        id,
                        auth.current().id(),
                        request.paymentMethod(),
                        request.cashAmount(),
                        request.cashlessAmount(),
                        request.cashlessPaymentType(),
                        request.transferAmount(),
                        request.cardAmount(),
                        request.qrAmount(),
                        request.comment(),
                        request.printComment(),
                        request.releaseWithStockShortage(),
                        request.stockShortageComment(),
                        request.itemUnits()));
    }

    @PatchMapping("/orders/{id}/payment")
    public ApiResponse<OrderDto> updateCompletedPayment(
            @PathVariable UUID id, @RequestBody @Valid OrderPaymentUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(
                orderService.updateCompletedPayment(
                        id,
                        auth.current().id(),
                        request.paymentMethod(),
                        request.cashAmount(),
                        request.cashlessAmount(),
                        request.cashlessPaymentType(),
                        request.transferAmount(),
                        request.cardAmount(),
                        request.qrAmount()));
    }
}
