package kz.company.shop.orders.controller;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.orders.dto.*;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.orders.service.OrderActivityCategory;
import kz.company.shop.orders.service.OrderActivityService;
import kz.company.shop.orders.service.OrderComparisonPdfService;
import kz.company.shop.orders.service.OrderIncomingPriceCheckService;
import kz.company.shop.orders.service.OrderInvoicePdfService;
import kz.company.shop.orders.service.OrderReturnSummaryService;
import kz.company.shop.orders.service.OrderService;
import kz.company.shop.warehouse.dto.WarehouseDto;
import org.springframework.http.ContentDisposition;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class OrderController {
    private final OrderService service;
    private final OrderInvoicePdfService invoicePdfService;
    private final OrderComparisonPdfService comparisonPdfService;
    private final OrderIncomingPriceCheckService incomingPriceCheckService;
    private final OrderReturnSummaryService returnSummaryService;
    private final OrderActivityService activityService;
    private final AuthContext auth;

    public OrderController(
            OrderService service,
            OrderInvoicePdfService invoicePdfService,
            OrderComparisonPdfService comparisonPdfService,
            OrderIncomingPriceCheckService incomingPriceCheckService,
            OrderReturnSummaryService returnSummaryService,
            OrderActivityService activityService,
            AuthContext auth) {
        this.service = service;
        this.invoicePdfService = invoicePdfService;
        this.comparisonPdfService = comparisonPdfService;
        this.incomingPriceCheckService = incomingPriceCheckService;
        this.returnSummaryService = returnSummaryService;
        this.activityService = activityService;
        this.auth = auth;
    }

    @PostMapping("/orders")
    public ApiResponse<OrderDto> checkout(@RequestBody @Valid CheckoutRequest request) {
        return ApiResponse.ok(service.checkout(auth.current().id(), request));
    }

    @GetMapping("/orders")
    public ApiResponse<List<OrderDto>> mine() {
        return ApiResponse.ok(service.mine(auth.current().id()));
    }

    @GetMapping("/orders/{id}")
    public ApiResponse<OrderDto> mine(@PathVariable UUID id) {
        return ApiResponse.ok(service.mine(auth.current().id(), id));
    }

    @GetMapping("/admin/orders")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<List<OrderDto>> all() {
        auth.require("orders.read");
        return ApiResponse.ok(service.all());
    }

    @GetMapping("/admin/orders/page")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<kz.company.shop.common.response.PageResult<OrderDto>> adminPage(
            @RequestParam(required = false) String search,
            @RequestParam(required = false)
                    @org.springframework.format.annotation.DateTimeFormat(
                            iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE)
                    java.time.LocalDate createdFrom,
            @RequestParam(required = false)
                    @org.springframework.format.annotation.DateTimeFormat(
                            iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE)
                    java.time.LocalDate createdTo,
            @RequestParam(required = false) List<kz.company.shop.orders.entity.OrderStatus> status,
            @RequestParam(required = false) List<kz.company.shop.orders.entity.PriceTier> priceTier,
            @RequestParam(required = false) Boolean stockShortage,
            @RequestParam(required = false) List<UUID> regularBuyerId,
            @RequestParam(defaultValue = "createdAt") String sort,
            @RequestParam(defaultValue = "desc") String direction,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "10") int size) {
        auth.require("orders.read");
        return ApiResponse.ok(
                service.adminPage(
                        search,
                        createdFrom,
                        createdTo,
                        status,
                        priceTier,
                        stockShortage,
                        regularBuyerId,
                        sort,
                        "desc".equalsIgnoreCase(direction),
                        page,
                        size));
    }

    @GetMapping("/admin/orders/summary")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<OrderListSummaryDto> adminSummary(
            @RequestParam(required = false)
                    @org.springframework.format.annotation.DateTimeFormat(
                            iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE)
                    java.time.LocalDate createdFrom,
            @RequestParam(required = false)
                    @org.springframework.format.annotation.DateTimeFormat(
                            iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE)
                    java.time.LocalDate createdTo) {
        auth.require("orders.read");
        return ApiResponse.ok(service.adminSummary(createdFrom, createdTo));
    }

    @GetMapping("/admin/orders/return-statistics")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<List<OrderReturnStatisticDto>> returnStatistics() {
        auth.require("orders.read");
        return ApiResponse.ok(returnSummaryService.statistics());
    }

    @GetMapping("/admin/orders/{id}")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<OrderDto> adminGet(@PathVariable UUID id) {
        auth.require("orders.read");
        return ApiResponse.ok(service.adminGet(id));
    }

    @GetMapping("/admin/orders/{id}/activity")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<kz.company.shop.common.response.PageResult<OrderActivityDto>> activity(
            @PathVariable UUID id,
            @RequestParam(required = false) Long actorUserId,
            @RequestParam(required = false)
                    @org.springframework.format.annotation.DateTimeFormat(
                            iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE)
                    java.time.LocalDate from,
            @RequestParam(required = false)
                    @org.springframework.format.annotation.DateTimeFormat(
                            iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE)
                    java.time.LocalDate to,
            @RequestParam(required = false) java.util.Set<OrderActivityCategory> categories,
            @RequestParam(required = false) java.util.Set<String> actions,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "25") int size) {
        auth.require("orders.read");
        return ApiResponse.ok(
                activityService.list(id, actorUserId, from, to, categories, actions, page, size));
    }

    @GetMapping("/admin/orders/{id}/activity/filter-options")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<OrderActivityFilterOptionsDto> activityFilterOptions(@PathVariable UUID id) {
        auth.require("orders.read");
        return ApiResponse.ok(activityService.filterOptions(id));
    }

    @GetMapping("/admin/orders/{id}/returns")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<OrderReturnSummaryDto> returns(@PathVariable UUID id) {
        auth.require("orders.read");
        return ApiResponse.ok(returnSummaryService.summary(id));
    }

    @GetMapping("/admin/orders/{id}/incoming-price-check")
    @PreAuthorize("hasAuthority('orders.read')")
    public ApiResponse<OrderIncomingPriceCheckDto> incomingPriceCheck(@PathVariable UUID id) {
        auth.require("orders.read");
        return ApiResponse.ok(incomingPriceCheckService.check(id));
    }

    @DeleteMapping("/admin/orders/{id}")
    @PreAuthorize("hasAuthority('orders.delete')")
    public ApiResponse<Void> softDelete(@PathVariable UUID id) {
        auth.require("orders.delete");
        service.softDelete(id, auth.current().id());
        return ApiResponse.ok(null);
    }

    @GetMapping(
            value = "/admin/orders/{id}/invoice.pdf",
            produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('orders.read')")
    public ResponseEntity<byte[]> invoicePdf(
            @PathVariable UUID id,
            @RequestParam(defaultValue = "true") boolean includePrintComment) {
        auth.require("orders.read");
        OrderDto order = service.adminGet(id);
        OrderReturnSummaryDto returnSummary = returnSummaryService.summary(id);
        String fileName = "nakladnaya-" + order.displayCode() + ".pdf";
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(
                        "Content-Disposition",
                        ContentDisposition.inline().filename(fileName).build().toString())
                .body(invoicePdfService.generate(order, returnSummary, includePrintComment));
    }

    @GetMapping(
            value = "/admin/orders/{id}/invoice-z2.pdf",
            produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('orders.read')")
    public ResponseEntity<byte[]> invoiceZ2Pdf(
            @PathVariable UUID id,
            @RequestParam(defaultValue = "true") boolean includePrintComment) {
        auth.require("orders.read");
        OrderDto order = service.adminGet(id);
        OrderReturnSummaryDto returnSummary = returnSummaryService.summary(id);
        String fileName = "nakladnaya-z2-" + order.displayCode() + ".pdf";
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(
                        "Content-Disposition",
                        ContentDisposition.inline().filename(fileName).build().toString())
                .body(invoicePdfService.generateZ2(order, returnSummary, includePrintComment));
    }

    @GetMapping(
            value = "/admin/orders/{id}/comparison.pdf",
            produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('orders.read')")
    public ResponseEntity<byte[]> comparisonPdf(@PathVariable UUID id) {
        auth.require("orders.read");
        // Keep the endpoint's visibility and not-found behavior aligned with the order read API.
        service.adminGet(id);
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(
                        "Content-Disposition",
                        ContentDisposition.inline()
                                .filename("order-comparison-" + id + ".pdf")
                                .build()
                                .toString())
                .body(comparisonPdfService.generate(id));
    }

    @PatchMapping("/admin/orders/{id}/status")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updateStatus(
            @PathVariable UUID id, @RequestBody @Valid OrderStatusUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(
                service.updateStatus(
                        id, request.status(), auth.current().id(), request.itemUnits()));
    }

    @PutMapping("/admin/orders/{id}/reservation")
    @PreAuthorize("hasAuthority('orders.update') and hasAuthority('warehouse.manage')")
    public ApiResponse<OrderDto> reserve(
            @PathVariable UUID id,
            @RequestBody(required = false) OrderReservationUpdateRequest request) {
        auth.require("orders.update");
        auth.require("warehouse.manage");
        return ApiResponse.ok(
                service.reserve(
                        id, request == null ? null : request.expiresAt(), auth.current().id()));
    }

    @PutMapping("/admin/orders/{id}/regular-buyer")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updateRegularBuyer(
            @PathVariable UUID id, @RequestBody @Valid OrderRegularBuyerUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(service.updateRegularBuyer(id, request.regularBuyerId(), auth.current().id()));
    }

    @PatchMapping("/admin/orders/{id}/comment")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updateComment(
            @PathVariable UUID id, @RequestBody @Valid OrderCommentUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(service.updateComment(id, request.comment(), auth.current().id()));
    }

    @PatchMapping("/admin/orders/{id}/print-comment")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updatePrintComment(
            @PathVariable UUID id, @RequestBody @Valid OrderPrintCommentUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(
                service.updatePrintComment(id, request.printComment(), auth.current().id()));
    }

    @PatchMapping("/admin/orders/{id}/prices")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updatePrices(
            @PathVariable UUID id, @RequestBody @Valid OrderPriceUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(service.updatePrices(id, request, auth.current().id()));
    }

    @GetMapping("/admin/orders/{id}/price-setting-documents")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<List<WarehouseDto.DocumentSummary>> priceSettingDocuments(
            @PathVariable UUID id) {
        auth.require("orders.update");
        return ApiResponse.ok(service.priceSettingDocumentsForOrder(id));
    }

    @PostMapping("/admin/orders/{id}/prices/from-price-setting/{documentId}")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updatePricesFromPriceSetting(
            @PathVariable UUID id, @PathVariable UUID documentId) {
        auth.require("orders.update");
        return ApiResponse.ok(
                service.updatePricesFromPriceSettingDocument(id, documentId, auth.current().id()));
    }

    @GetMapping("/admin/orders/{id}/price-tiers/{priceTier}")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<List<OrderPriceTierItemDto>> pricesForTier(
            @PathVariable UUID id, @PathVariable PriceTier priceTier) {
        auth.require("orders.update");
        return ApiResponse.ok(service.pricesForTier(id, priceTier));
    }

    @PatchMapping("/admin/orders/{id}/fulfillment/assignees")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updateFulfillmentAssignees(
            @PathVariable UUID id, @RequestBody OrderFulfillmentAssigneesRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(service.updateFulfillmentAssignees(id, request, auth.current().id()));
    }

    @PatchMapping("/admin/orders/{id}/fulfillment/items/{itemId}")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updateFulfillmentItem(
            @PathVariable UUID id,
            @PathVariable Long itemId,
            @RequestBody @Valid OrderFulfillmentItemRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(
                service.updateFulfillmentItem(id, itemId, request, auth.current().id()));
    }

    @PostMapping("/admin/orders/{id}/manual-items")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> addManualItem(
            @PathVariable UUID id, @RequestBody @Valid OrderManualItemCreateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(service.addManualItem(id, request, auth.current().id()));
    }

    @PostMapping("/admin/orders/{id}/catalog-items")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> addCatalogItem(
            @PathVariable UUID id, @RequestBody @Valid OrderCatalogItemCreateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(service.addCatalogItem(id, request, auth.current().id()));
    }

    @PatchMapping("/admin/orders/{id}/items/{itemId}")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updateItemQuantity(
            @PathVariable UUID id,
            @PathVariable Long itemId,
            @RequestBody @Valid OrderItemQuantityUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(service.updateItemQuantity(id, itemId, request, auth.current().id()));
    }

    @PatchMapping("/admin/orders/{id}/items/{itemId}/measurement-unit")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updateItemMeasurementUnit(
            @PathVariable UUID id,
            @PathVariable Long itemId,
            @RequestBody @Valid OrderItemMeasurementUnitUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(
                service.updateItemMeasurementUnit(id, itemId, request, auth.current().id()));
    }

    @PatchMapping("/admin/orders/{id}/items/order")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> updateItemOrder(
            @PathVariable UUID id, @RequestBody @Valid OrderItemOrderUpdateRequest request) {
        auth.require("orders.update");
        return ApiResponse.ok(service.updateItemOrder(id, request, auth.current().id()));
    }

    @DeleteMapping("/admin/orders/{id}/items/{itemId}")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> deleteItem(@PathVariable UUID id, @PathVariable Long itemId) {
        auth.require("orders.update");
        return ApiResponse.ok(service.deleteItem(id, itemId, auth.current().id()));
    }

    @PostMapping("/admin/orders/{id}/copy")
    @PreAuthorize("hasAuthority('orders.update')")
    public ApiResponse<OrderDto> copy(@PathVariable UUID id) {
        auth.require("orders.update");
        return ApiResponse.ok(service.copy(id, auth.current().id()));
    }

    @PostMapping("/orders/{id}/price-confirmation")
    public ApiResponse<OrderDto> confirmPrices(@PathVariable UUID id) {
        return ApiResponse.ok(service.confirmPrices(auth.current().id(), id));
    }
}
