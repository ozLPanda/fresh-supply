package kz.company.shop.alibabaSourcing.controller;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import kz.company.shop.alibabaSourcing.dto.AlibabaSourcingConfigDto;
import kz.company.shop.alibabaSourcing.dto.AlibabaSourcingConfigUpdateRequest;
import kz.company.shop.alibabaSourcing.dto.AlibabaSourcingSearchDto;
import kz.company.shop.alibabaSourcing.dto.AlibabaSourcingSelectOfferRequest;
import kz.company.shop.alibabaSourcing.service.AlibabaSourcingService;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.security.AuthContext;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/products/{productId}/alibaba-sourcing")
public class AlibabaSourcingController {
    private final AlibabaSourcingService service;
    private final AuthContext auth;

    public AlibabaSourcingController(AlibabaSourcingService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('alibabaSourcing.read')")
    public ApiResponse<AlibabaSourcingConfigDto> getConfig(@PathVariable Long productId) {
        auth.require("alibabaSourcing.read");
        return ApiResponse.ok(service.getConfig(productId));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('alibabaSourcing.manage')")
    public ApiResponse<AlibabaSourcingConfigDto> updateConfig(
            @PathVariable Long productId,
            @RequestBody @Valid AlibabaSourcingConfigUpdateRequest request) {
        auth.require("alibabaSourcing.manage");
        return ApiResponse.ok(service.updateConfig(productId, request));
    }

    @GetMapping("/searches")
    @PreAuthorize("hasAuthority('alibabaSourcing.read')")
    public ApiResponse<List<AlibabaSourcingSearchDto>> listSearches(@PathVariable Long productId) {
        auth.require("alibabaSourcing.read");
        return ApiResponse.ok(service.listSearches(productId));
    }

    @GetMapping("/searches/{searchId}")
    @PreAuthorize("hasAuthority('alibabaSourcing.read')")
    public ApiResponse<AlibabaSourcingSearchDto> getSearch(
            @PathVariable Long productId, @PathVariable UUID searchId) {
        auth.require("alibabaSourcing.read");
        return ApiResponse.ok(service.getSearch(productId, searchId));
    }

    @PostMapping("/searches")
    @PreAuthorize("hasAuthority('alibabaSourcing.manage')")
    public ApiResponse<AlibabaSourcingSearchDto> startSearch(@PathVariable Long productId) {
        auth.require("alibabaSourcing.manage");
        return ApiResponse.ok(service.startSearch(productId, auth.current()));
    }

    @PostMapping("/searches/{searchId}/retry")
    @PreAuthorize("hasAuthority('alibabaSourcing.manage')")
    public ApiResponse<AlibabaSourcingSearchDto> retrySearch(
            @PathVariable Long productId, @PathVariable UUID searchId) {
        auth.require("alibabaSourcing.manage");
        return ApiResponse.ok(service.retrySearch(productId, searchId, auth.current()));
    }

    @PutMapping("/selected-offer")
    @PreAuthorize("hasAuthority('alibabaSourcing.manage')")
    public ApiResponse<AlibabaSourcingConfigDto> selectOffer(
            @PathVariable Long productId,
            @RequestBody @Valid AlibabaSourcingSelectOfferRequest request) {
        auth.require("alibabaSourcing.manage");
        return ApiResponse.ok(service.selectOffer(productId, request.offerId(), auth.current()));
    }

    @DeleteMapping("/selected-offer")
    @PreAuthorize("hasAuthority('alibabaSourcing.manage')")
    public ApiResponse<AlibabaSourcingConfigDto> clearSelectedOffer(@PathVariable Long productId) {
        auth.require("alibabaSourcing.manage");
        return ApiResponse.ok(service.clearSelectedOffer(productId));
    }
}
