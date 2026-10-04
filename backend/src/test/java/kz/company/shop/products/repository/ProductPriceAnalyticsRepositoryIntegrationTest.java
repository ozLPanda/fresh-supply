package kz.company.shop.products.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.Set;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto.PriceType;
import kz.company.shop.products.dto.ProductPriceAnalyticsFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;

@SpringBootTest
class ProductPriceAnalyticsRepositoryIntegrationTest {
    @Autowired private ProductRepository products;

    @Test
    void filtersByMarkupPercentUsingTheSelectedPriceType() {
        var result =
                products.findPriceAnalytics(
                        "",
                        null,
                        new ProductPriceAnalyticsFilter(
                                new BigDecimal("50"), null, Set.of(PriceType.RETAIL), false),
                        PageRequest.of(0, 20));

        assertThat(result.getTotalElements()).isGreaterThanOrEqualTo(0);
        assertThat(result.getContent())
                .allSatisfy(
                        product -> {
                            assertThat(product.incomingPrice).isNotNull().isPositive();
                            assertThat(product.price).isNotNull();
                            assertThat(product.price.multiply(BigDecimal.valueOf(100)))
                                    .isGreaterThanOrEqualTo(
                                            product.incomingPrice.multiply(
                                                    BigDecimal.valueOf(150)));
                        });
    }

    @Test
    void readsMarkupAggregationForEveryCategory() {
        var result = products.priceAnalyticsByCategory();

        assertThat(result).allSatisfy(row -> assertThat(row).hasSize(19));
    }
}
