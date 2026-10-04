package kz.company.shop.carts.controller;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import kz.company.shop.carts.dto.*;
import kz.company.shop.carts.service.CartService;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.orders.service.OrderInvoicePdfService;
import org.springframework.http.ContentDisposition;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@Validated
@RestController
@RequestMapping("/api/cart")
public class CartController {
    private final CartService service;
    private final OrderInvoicePdfService invoicePdfService;
    private final AuthContext auth;

    public CartController(
            CartService service, OrderInvoicePdfService invoicePdfService, AuthContext auth) {
        this.service = service;
        this.invoicePdfService = invoicePdfService;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<CartDto> get() {
        return ApiResponse.ok(service.get(auth.current().id()));
    }

    @PostMapping("/selection-preview")
    public ApiResponse<CartDto> selectionPreview(
            @RequestBody @Valid CartSelectionPreviewRequest request) {
        return ApiResponse.ok(service.selectionPreview(auth.current().id(), request));
    }

    @PostMapping("/items")
    public ApiResponse<CartDto> add(@RequestBody @Valid CartItemRequest request) {
        return ApiResponse.ok(service.add(auth.current().id(), request));
    }

    @PutMapping("/items/{productId}")
    public ApiResponse<CartDto> update(
            @PathVariable Long productId, @RequestParam @Min(1) @Max(999) int quantity) {
        return ApiResponse.ok(service.setQuantity(auth.current().id(), productId, quantity));
    }

    @DeleteMapping("/items/{productId}")
    public ApiResponse<CartDto> remove(@PathVariable Long productId) {
        return ApiResponse.ok(service.remove(auth.current().id(), productId));
    }

    @DeleteMapping
    public ApiResponse<Void> clear() {
        service.clear(auth.current().id());
        return ApiResponse.message("Корзина очищена");
    }

    @PostMapping("/merge")
    public ApiResponse<CartDto> merge(@RequestBody @Valid CartMergeRequest request) {
        return ApiResponse.ok(service.merge(auth.current().id(), request));
    }

    @PostMapping("/temporary-invoice/preview")
    @PreAuthorize("hasAuthority('commerce.invoices.create')")
    public ApiResponse<TemporaryInvoicePreviewDto> temporaryInvoicePreview(
            @RequestBody @Valid TemporaryInvoicePreviewRequest request) {
        auth.require("commerce.invoices.create");
        return ApiResponse.ok(service.temporaryInvoicePreview(auth.current().id(), request));
    }

    @PostMapping(value = "/temporary-invoice.pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    @PreAuthorize("hasAuthority('commerce.invoices.create')")
    public ResponseEntity<byte[]> temporaryInvoice(
            @RequestBody @Valid TemporaryInvoiceCreateRequest request) {
        auth.require("commerce.invoices.create");
        byte[] pdf =
                invoicePdfService.generateTemporary(
                        service.temporaryInvoice(auth.current().id(), request));
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_PDF)
                .header(
                        "Content-Disposition",
                        ContentDisposition.inline()
                                .filename("vremennaya-nakladnaya.pdf")
                                .build()
                                .toString())
                .body(pdf);
    }
}
