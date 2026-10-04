package kz.company.shop.priceStatistics.controller;

import java.util.List;
import java.util.UUID;
import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.CategoryStat;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ImportDetail;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ImportSummary;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.PeriodAnalytics;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ProductStat;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ProductTrendHistory;
import kz.company.shop.priceStatistics.entity.PriceStatisticsScope;
import kz.company.shop.priceStatistics.entity.PriceType;
import kz.company.shop.priceStatistics.service.PriceStatisticsService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/price-statistics")
@PreAuthorize("hasAuthority('products.read')")
public class PriceStatisticsController {
    private final PriceStatisticsService service;
    private final AuthContext auth;

    public PriceStatisticsController(PriceStatisticsService service, AuthContext auth) {
        this.service = service;
        this.auth = auth;
    }

    @GetMapping("/imports")
    public ApiResponse<PageResult<ImportSummary>> imports(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        auth.require("products.read");
        return ApiResponse.ok(service.imports(page, size));
    }

    @GetMapping("/imports/{importId}")
    public ApiResponse<ImportDetail> detail(@PathVariable UUID importId) {
        auth.require("products.read");
        return ApiResponse.ok(service.detail(importId));
    }

    @GetMapping("/imports/{importId}/categories")
    public ApiResponse<List<CategoryStat>> categories(
            @PathVariable UUID importId,
            @RequestParam(defaultValue = "SALES") PriceStatisticsScope scope) {
        auth.require("products.read");
        return ApiResponse.ok(service.categories(importId, scope));
    }

    @GetMapping("/imports/{importId}/products")
    public ApiResponse<PageResult<ProductStat>> products(
            @PathVariable UUID importId,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) String query,
            @RequestParam(defaultValue = "SALES") PriceStatisticsScope scope) {
        auth.require("products.read");
        return ApiResponse.ok(service.products(importId, page, size, categoryId, query, scope));
    }

    @GetMapping("/analytics")
    public ApiResponse<PeriodAnalytics> analytics(
            @RequestParam(defaultValue = "RETAIL") PriceType priceType,
            @RequestParam(defaultValue = "year") String period) {
        auth.require("products.read");
        return ApiResponse.ok(service.periodAnalytics(priceType, period));
    }

    @GetMapping("/analytics/products/{productId}/history")
    public ApiResponse<ProductTrendHistory> productTrendHistory(
            @PathVariable Long productId,
            @RequestParam(defaultValue = "RETAIL") PriceType priceType,
            @RequestParam(defaultValue = "year") String period) {
        auth.require("products.read");
        return ApiResponse.ok(service.productTrendHistory(productId, priceType, period));
    }
}
