package kz.company.shop.products.repository;

import kz.company.shop.products.dto.ProductPriceAnalyticsFilter;
import kz.company.shop.products.entity.Product;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface ProductPriceAnalyticsRepository {
    Page<Product> findPriceAnalytics(
            String search, Long categoryId, ProductPriceAnalyticsFilter filter, Pageable pageable);
}
