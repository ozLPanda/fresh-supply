package kz.company.shop.productViews.repository;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

@SpringBootTest
class ProductViewEventRepositoryIntegrationTest {
    @Autowired private ProductViewEventRepository repository;

    @Test
    void readsPagedProductViewAnalyticsWithCountSorting() {
        var result =
                repository.findProductViewAnalytics(
                        "", PageRequest.of(0, 20, Sort.by(Sort.Order.desc("views"))));

        assertThat(result.getContent()).allSatisfy(row -> assertThat(row.getViews()).isPositive());
    }

    @Test
    void readsEverySupportedHistoryGrouping() {
        assertThat(repository.historyByDay(-1L)).isEmpty();
        assertThat(repository.historyByMonth(-1L)).isEmpty();
        assertThat(repository.historyByYear(-1L)).isEmpty();
    }
}
