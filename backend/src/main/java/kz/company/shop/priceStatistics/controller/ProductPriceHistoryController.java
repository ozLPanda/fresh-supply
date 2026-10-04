package kz.company.shop.priceStatistics.controller;

import kz.company.shop.common.response.ApiResponse;
import kz.company.shop.priceStatistics.dto.ProductPriceHistoryDto;
import kz.company.shop.priceStatistics.service.PriceStatisticsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/products/{productId}/price-history")
public class ProductPriceHistoryController {
    private final PriceStatisticsService service;

    public ProductPriceHistoryController(PriceStatisticsService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<ProductPriceHistoryDto> history(
            @PathVariable Long productId, @RequestParam(defaultValue = "all") String period) {
        return ApiResponse.ok(service.retailHistory(productId, period));
    }
}
