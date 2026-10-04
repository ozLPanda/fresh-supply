package kz.company.shop.productViews.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import kz.company.shop.common.security.AuthContext;
import kz.company.shop.productViews.dto.ProductViewAnalyticsProjection;
import kz.company.shop.productViews.dto.ProductViewGrouping;
import kz.company.shop.productViews.dto.ProductViewRequest;
import kz.company.shop.productViews.entity.ProductViewEvent;
import kz.company.shop.productViews.repository.ProductViewEventRepository;
import kz.company.shop.products.service.ProductService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;

class ProductViewServiceTest {
    private final ProductViewEventRepository repository = mock(ProductViewEventRepository.class);
    private final ProductService products = mock(ProductService.class);
    private final AuthContext auth = mock(AuthContext.class);
    private final ProductViewService service = new ProductViewService(repository, products, auth);

    @Test
    void doesNotSaveDuplicateGuestViewWithinThirtyMinutes() {
        when(auth.optional()).thenReturn(Optional.empty());
        when(repository.existsByProductIdAndVisitorKeyAndViewedAtAfter(
                        eq(42L), eq("guest:browser-1"), any(Instant.class)))
                .thenReturn(true);

        service.record(42L, new ProductViewRequest("browser-1"));

        verify(products).getEntity(42L);
        verify(repository, never()).save(any(ProductViewEvent.class));
    }

    @Test
    void savesFirstGuestView() {
        when(auth.optional()).thenReturn(Optional.empty());

        service.record(42L, new ProductViewRequest("browser-1"));

        verify(repository).save(any(ProductViewEvent.class));
    }

    @Test
    void returnsPaginatedAnalyticsAndUsesRequestedSearch() {
        ProductViewAnalyticsProjection row = mock(ProductViewAnalyticsProjection.class);
        when(row.getProductId()).thenReturn(42L);
        when(row.getSku()).thenReturn("42");
        when(row.getNameRu()).thenReturn("Насос");
        when(row.getCategoryNameRu()).thenReturn("Оборудование");
        when(row.getViews()).thenReturn(12L);
        when(repository.findProductViewAnalytics(eq("насос"), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(row)));

        var result = service.analytics(1, 20, " насос ", "views", "desc");

        assertThat(result.items())
                .containsExactly(
                        new kz.company.shop.productViews.dto.ProductViewAnalyticsDto(
                                42L, "42", "Насос", "Оборудование", 12L));
        ArgumentCaptor<Pageable> pageable = ArgumentCaptor.forClass(Pageable.class);
        verify(repository).findProductViewAnalytics(eq("насос"), pageable.capture());
        assertThat(pageable.getValue().getSort().getOrderFor("views").getDirection())
                .isEqualTo(org.springframework.data.domain.Sort.Direction.DESC);
    }

    @Test
    void returnsHistoryGroupedByMonth() {
        when(repository.historyByMonth(42L))
                .thenReturn(List.of(new Object[] {"2026-08", 7L}, new Object[] {"2026-09", 3L}));

        var result = service.history(42L, "month");

        assertThat(result.productId()).isEqualTo(42L);
        assertThat(result.points())
                .containsExactly(
                        new kz.company.shop.productViews.dto.ProductViewHistoryDto.Point(
                                "2026-08", 7L),
                        new kz.company.shop.productViews.dto.ProductViewHistoryDto.Point(
                                "2026-09", 3L));
        verify(products).getEntity(42L);
        verify(repository).historyByMonth(42L);
    }

    @Test
    void parsesGroupingsCaseInsensitively() {
        assertThat(ProductViewGrouping.from("YEAR")).isEqualTo(ProductViewGrouping.YEAR);
    }
}
