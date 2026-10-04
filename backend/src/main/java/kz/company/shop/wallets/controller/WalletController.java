package kz.company.shop.wallets.controller;

import jakarta.validation.Valid;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.wallets.dto.*;
import kz.company.shop.wallets.service.WalletService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
public class WalletController {
    private final WalletService service;
    private final AuthContext auth;

    public WalletController(WalletService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping("/wallet")
    public ApiResponse<WalletDto> mine() {
        return ApiResponse.ok(service.get(auth.current().id()));
    }

    @GetMapping("/admin/users/{userId}/wallet")
    @PreAuthorize("hasAuthority('balances.manage')")
    public ApiResponse<WalletDto> getForUser(@PathVariable Long userId) {
        auth.require("balances.manage");
        return ApiResponse.ok(service.get(userId));
    }

    @PostMapping("/admin/users/{userId}/wallet/credits")
    @PreAuthorize("hasAuthority('balances.manage')")
    public ApiResponse<WalletDto> credit(
            @PathVariable Long userId, @RequestBody @Valid BalanceCreditRequest request) {
        auth.require("balances.manage");
        return ApiResponse.ok(service.credit(userId, auth.current().id(), request));
    }
}
