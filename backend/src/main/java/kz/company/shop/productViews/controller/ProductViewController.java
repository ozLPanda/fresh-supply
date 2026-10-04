package kz.company.shop.productViews.controller;

import jakarta.validation.Valid;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.productViews.dto.ProductViewAnalyticsDto;
import kz.company.shop.productViews.dto.ProductViewHistoryDto;
import kz.company.shop.productViews.dto.ProductViewRequest;
import kz.company.shop.productViews.service.ProductViewService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/products")
public class ProductViewController {
    private final ProductViewService service;
    private final AuthContext auth;

    public ProductViewController(ProductViewService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @PostMapping("/{productId}/views")
    public ApiResponse<Void> record(
            @PathVariable Long productId, @RequestBody @Valid ProductViewRequest request) {
        service.record(productId, request);
        return ApiResponse.message("Просмотр учтён");
    }

    @GetMapping("/view-analytics")
    @PreAuthorize("hasAuthority('products.read')")
    public ApiResponse<PageResult<ProductViewAnalyticsDto>> analytics(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String direction) {
        auth.require("products.read");
        return ApiResponse.ok(service.analytics(page, size, search, sort, direction));
    }

    @GetMapping("/{productId}/view-analytics")
    @PreAuthorize("hasAuthority('products.read')")
    public ApiResponse<ProductViewHistoryDto> history(
            @PathVariable Long productId, @RequestParam(defaultValue = "day") String groupBy) {
        auth.require("products.read");
        return ApiResponse.ok(service.history(productId, groupBy));
    }
}
