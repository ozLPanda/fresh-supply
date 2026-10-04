package kz.company.shop.products.controller;

import java.time.LocalDate;
import java.util.Set;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.products.dto.ProductActivityDto;
import kz.company.shop.products.dto.ProductActivityFilterOptionsDto;
import kz.company.shop.products.service.ProductActivityCategory;
import kz.company.shop.products.service.ProductActivityService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/products")
public class ProductActivityController {
    private final ProductActivityService service;
    private final AuthContext auth;

    public ProductActivityController(ProductActivityService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping("/{productId}/activity")
    @PreAuthorize("hasAuthority('products.read')")
    public ApiResponse<PageResult<ProductActivityDto>> list(
            @PathVariable Long productId,
            @RequestParam(required = false) Long actorUserId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Set<ProductActivityCategory> categories,
            @RequestParam(required = false) Set<String> types,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "25") int size) {
        auth.require("products.read");
        return ApiResponse.ok(service.list(productId, actorUserId, from, to, categories, types, page, size));
    }

    @GetMapping("/{productId}/activity/filter-options")
    @PreAuthorize("hasAuthority('products.read')")
    public ApiResponse<ProductActivityFilterOptionsDto> filterOptions(@PathVariable Long productId) {
        auth.require("products.read");
        return ApiResponse.ok(service.filterOptions(productId));
    }
}
