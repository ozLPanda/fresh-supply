package kz.company.shop.products.controller;

import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.products.dto.ProductAvailabilityRepairApplyRequest;
import kz.company.shop.products.dto.ProductAvailabilityRepairPreviewDto;
import kz.company.shop.products.dto.ProductAvailabilityRepairResultDto;
import kz.company.shop.products.dto.ProductAvailabilityStatusRequest;
import kz.company.shop.products.dto.ProductCatalogAnalyticsDto;
import kz.company.shop.products.dto.ProductDto;
import kz.company.shop.products.dto.ProductListParams;
import kz.company.shop.products.dto.ProductPriceAnalyticsCategoryDto;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto.PriceType;
import kz.company.shop.products.service.ProductService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/products")
public class ProductController {
    private final ProductService productService;
    private final AuthContext auth;

    public ProductController(ProductService productService, AuthContext auth) {
        this.productService = productService;
        this.auth = auth;
    }

    @GetMapping
    public ApiResponse<PageResult<ProductDto>> list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "12") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) BigDecimal minPrice,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(required = false) Boolean inStock,
            @RequestParam(required = false) Boolean active,
            @RequestParam(required = false) String sort,
            @RequestParam(required = false) String direction,
            @RequestParam(defaultValue = "false") Boolean excludeImportCreated,
            @RequestParam(defaultValue = "false") Boolean missingIncomingPrice,
            @RequestParam(defaultValue = "false") boolean lexicalOnly) {
        boolean canViewInternalPrices = canViewHiddenProducts();
        Boolean visibleOnly = canViewInternalPrices ? active : Boolean.TRUE;
        boolean showMissingIncomingPrice =
                canViewInternalPrices && Boolean.TRUE.equals(missingIncomingPrice);
        return ApiResponse.ok(
                productService.list(
                        new ProductListParams(
                                page,
                                size,
                                search,
                                category,
                                minPrice,
                                maxPrice,
                                inStock,
                                visibleOnly,
                                sort,
                                direction,
                                excludeImportCreated,
                                showMissingIncomingPrice,
                                lexicalOnly || showMissingIncomingPrice,
                                canViewInternalPrices,
                                canViewInternalPrices || lexicalOnly),
                        personalDiscountPercent(canViewInternalPrices)));
    }

    @GetMapping("/category-counts")
    public ApiResponse<Map<Long, Long>> countByCategory() {
        return ApiResponse.ok(productService.countByCategory());
    }

    @GetMapping("/analytics")
    @PreAuthorize("hasAuthority('products.read')")
    public ApiResponse<ProductCatalogAnalyticsDto> analytics(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) BigDecimal minPrice,
            @RequestParam(required = false) BigDecimal maxPrice,
            @RequestParam(required = false) Boolean inStock,
            @RequestParam(required = false) Boolean active,
            @RequestParam(defaultValue = "false") Boolean excludeImportCreated,
            @RequestParam(defaultValue = "false") Boolean missingIncomingPrice) {
        auth.require("products.read");
        return ApiResponse.ok(
                productService.analytics(
                        new ProductListParams(
                                1,
                                1,
                                search,
                                category,
                                minPrice,
                                maxPrice,
                                inStock,
                                active,
                                null,
                                null,
                                excludeImportCreated,
                                Boolean.TRUE.equals(missingIncomingPrice),
                                true,
                                true,
                                true)));
    }

    @GetMapping("/price-analytics")
    @PreAuthorize("hasAuthority('products.read')")
    public ApiResponse<PageResult<ProductPriceAnalyticsDto>> priceAnalytics(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) BigDecimal minMarkupPercent,
            @RequestParam(required = false) BigDecimal maxMarkupPercent,
            @RequestParam(name = "priceType", required = false) Set<PriceType> priceTypes,
            @RequestParam(defaultValue = "false") boolean matchAllPriceTypes) {
        auth.require("products.read");
        return ApiResponse.ok(
                productService.priceAnalytics(
                        page,
                        size,
                        search,
                        categoryId,
                        minMarkupPercent,
                        maxMarkupPercent,
                        priceTypes,
                        matchAllPriceTypes));
    }

    @GetMapping("/price-analytics/categories")
    @PreAuthorize("hasAuthority('products.read')")
    public ApiResponse<List<ProductPriceAnalyticsCategoryDto>> priceAnalyticsByCategory() {
        auth.require("products.read");
        return ApiResponse.ok(productService.priceAnalyticsByCategory());
    }

    @GetMapping("/availability-repair/preview")
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<List<ProductAvailabilityRepairPreviewDto>> previewAvailabilityRepair(
            @RequestParam(name = "keyword") List<String> keywords) {
        auth.require("products.update");
        return ApiResponse.ok(productService.previewAvailabilityRepair(keywords));
    }

    @PostMapping("/availability-repair/apply")
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<ProductAvailabilityRepairResultDto> applyAvailabilityRepair(
            @RequestBody @Valid ProductAvailabilityRepairApplyRequest request) {
        auth.require("products.update");
        return ApiResponse.ok(productService.applyAvailabilityRepair(request));
    }

    /**
     * Storefront product lookup. A hidden product is never exposed here, even to a signed-in
     * administrator who also has access to the back-office API.
     */
    @GetMapping("/{id}/storefront")
    public ApiResponse<ProductDto> getStorefrontProduct(@PathVariable Long id) {
        return ApiResponse.ok(productService.getPublic(id, personalDiscountPercent(false)));
    }

    @GetMapping("/{id}")
    public ApiResponse<ProductDto> get(@PathVariable Long id) {
        return ApiResponse.ok(
                canViewHiddenProducts()
                        ? productService.get(id)
                        : productService.getPublic(id, personalDiscountPercent(false)));
    }

    private boolean canViewHiddenProducts() {
        return auth.optional()
                .map(user -> user.permissions().contains("products.read"))
                .orElse(false);
    }

    private BigDecimal personalDiscountPercent(boolean canViewInternalPrices) {
        if (canViewInternalPrices) return BigDecimal.ZERO;
        return auth.optional().map(user -> user.personalDiscountPercent()).orElse(BigDecimal.ZERO);
    }

    @PostMapping
    @PreAuthorize("hasAuthority('products.create')")
    public ApiResponse<ProductDto> create(@RequestBody @Valid ProductDto dto) {
        auth.require("products.create");
        return ApiResponse.ok(productService.create(dto));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<ProductDto> update(
            @PathVariable Long id, @RequestBody @Valid ProductDto dto) {
        auth.require("products.update");
        return ApiResponse.ok(productService.update(id, dto));
    }

    @PatchMapping("/{id}/availability-status")
    @PreAuthorize("hasAuthority('products.update')")
    public ApiResponse<ProductDto> updateAvailabilityStatus(
            @PathVariable Long id, @RequestBody @Valid ProductAvailabilityStatusRequest request) {
        auth.require("products.update");
        return ApiResponse.ok(productService.updateAvailabilityStatus(id, request.status()));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAuthority('products.delete')")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        auth.require("products.delete");
        productService.delete(id);
        return ApiResponse.message("Товар удален");
    }
}
