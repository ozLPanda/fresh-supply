package kz.company.shop.settings.controller;

import jakarta.validation.Valid;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.settings.dto.PaymentInvoiceSettingsDto;
import kz.company.shop.settings.service.PaymentInvoiceSettingsService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/settings/payment-invoice")
@PreAuthorize("hasAuthority('pages.settings.view')")
public class PaymentInvoiceSettingsController {
    private final PaymentInvoiceSettingsService service;
    private final AuthContext auth;

    public PaymentInvoiceSettingsController(PaymentInvoiceSettingsService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<PaymentInvoiceSettingsDto> get() {
        auth.require("pages.settings.view");
        return ApiResponse.ok(service.get());
    }

    @PutMapping
    public ApiResponse<PaymentInvoiceSettingsDto> update(@RequestBody @Valid PaymentInvoiceSettingsDto request) {
        auth.require("pages.settings.view");
        return ApiResponse.ok(service.update(request));
    }
}
