package kz.company.shop.productViews.service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.productViews.dto.ProductViewAnalyticsDto;
import kz.company.shop.productViews.dto.ProductViewAnalyticsProjection;
import kz.company.shop.productViews.dto.ProductViewGrouping;
import kz.company.shop.productViews.dto.ProductViewHistoryDto;
import kz.company.shop.productViews.dto.ProductViewRequest;
import kz.company.shop.productViews.entity.ProductViewEvent;
import kz.company.shop.productViews.repository.ProductViewEventRepository;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProductViewService {
    private static final int MIN_PAGE = 1;
    private static final int MIN_SIZE = 1;
    private static final int MAX_SIZE = 100;
    private final ProductViewEventRepository repository;
    private final ProductService productService;
    private final AuthContext auth;

    public ProductViewService(
            ProductViewEventRepository repository,
            ProductService productService,
            AuthContext auth) {
        this.repository = repository;
        this.productService = productService;
        this.auth = auth;
    }

    @Transactional
    public void record(Long productId, ProductViewRequest request) {
        productService.getEntity(productId);
        var current = auth.optional();
        String visitorKey =
                current.map(user -> "user:" + user.id()).orElse("guest:" + request.visitorId());
        Instant cutoff = Instant.now().minus(30, ChronoUnit.MINUTES);
        if (repository.existsByProductIdAndVisitorKeyAndViewedAtAfter(
                productId, visitorKey, cutoff)) {
            return;
        }
        ProductViewEvent event = new ProductViewEvent();
        event.productId = productId;
        event.userId = current.map(user -> user.id()).orElse(null);
        event.visitorKey = visitorKey;
        repository.save(event);
    }

    @Transactional(readOnly = true)
    public PageResult<ProductViewAnalyticsDto> analytics(
            int page, int size, String search, String sort, String direction) {
        int safePage = Math.max(page, MIN_PAGE);
        int safeSize = Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
        PageRequest pageable = PageRequest.of(safePage - 1, safeSize, resolveSort(sort, direction));
        var result = findProductViewAnalytics(search, pageable);
        return new PageResult<>(
                result.getContent().stream()
                        .map(
                                row ->
                                        new ProductViewAnalyticsDto(
                                                row.getProductId(),
                                                row.getSku(),
                                                row.getNameRu(),
                                                row.getCategoryNameRu(),
                                                row.getViews()))
                        .toList(),
                safePage,
                safeSize,
                result.getTotalElements(),
                result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public ProductViewHistoryDto history(Long productId, String groupBy) {
        productService.getEntity(productId);
        ProductViewGrouping grouping = ProductViewGrouping.from(groupBy);
        List<Object[]> rows =
                switch (grouping) {
                    case DAY -> repository.historyByDay(productId);
                    case MONTH -> repository.historyByMonth(productId);
                    case YEAR -> repository.historyByYear(productId);
                };
        return new ProductViewHistoryDto(
                productId,
                rows.stream()
                        .map(
                                row ->
                                        new ProductViewHistoryDto.Point(
                                                String.valueOf(row[0]),
                                                ((Number) row[1]).longValue()))
                        .toList());
    }

    private org.springframework.data.domain.Page<ProductViewAnalyticsProjection>
            findProductViewAnalytics(String search, PageRequest pageable) {
        List<String> variants = ProductSearchTextNormalizer.rawSearchVariants(search);
        if (variants.isEmpty()) return repository.findProductViewAnalytics("", pageable);

        for (String variant : variants) {
            var result = repository.findProductViewAnalytics(variant, pageable);
            if (!result.isEmpty()) return result;
        }
        return repository.findProductViewAnalytics(variants.getFirst(), pageable);
    }

    private Sort resolveSort(String sort, String direction) {
        String property =
                switch (sort == null ? "" : sort) {
                    case "nameRu" -> "nameRu";
                    case "sku" -> "sku";
                    default -> "views";
                };
        Sort.Direction sortDirection =
                "asc".equalsIgnoreCase(direction) ? Sort.Direction.ASC : Sort.Direction.DESC;
        return Sort.by(new Sort.Order(sortDirection, property))
                .and(Sort.by(Sort.Order.asc("productId")));
    }
}
