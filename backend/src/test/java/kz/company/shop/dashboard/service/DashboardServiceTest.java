package kz.company.shop.dashboard.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import kz.company.shop.audit.repository.AuditLogRepository;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.integrations.onec.repository.IntegrationLogRepository;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.productViews.repository.ProductViewEventRepository;
import kz.company.shop.products.repository.ProductRepository;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

class DashboardServiceTest {
    private final OrderRepository orders = mock(OrderRepository.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final CategoryRepository categories = mock(CategoryRepository.class);
    private final ProductViewEventRepository views = mock(ProductViewEventRepository.class);
    private final AuditLogRepository audit = mock(AuditLogRepository.class);
    private final IntegrationLogRepository integrationLogs = mock(IntegrationLogRepository.class);
    private final DashboardService service =
            new DashboardService(orders, products, categories, views, audit, integrationLogs);

    @Test
    void buildsDailyRevenueFromCompletedPaidOrdersAndHidesTrendWithoutPreviousData() {
        when(orders.countByStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        any(), any(), any()))
                .thenReturn(4L, 2L);
        when(views.countByViewedAtGreaterThanEqualAndViewedAtLessThan(any(), any()))
                .thenReturn(10L, 0L);
        Order paid = new Order();
        paid.status = OrderStatus.COMPLETED;
        paid.createdAt = Instant.now();
        paid.total = new BigDecimal("1500.00");
        when(orders.findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any()))
                .thenReturn(List.of(paid));
        when(products.findByDeletedAtIsNullOrderByCreatedAtDesc(any(Pageable.class)))
                .thenReturn(List.of());
        when(audit.findAllByOrderByCreatedAtDesc(any(Pageable.class))).thenReturn(List.of());

        var result = service.get(7);

        assertThat(result.period()).isEqualTo(7);
        assertThat(result.newOrders().trendPercent()).isEqualTo(100.0);
        assertThat(result.productViews().trendPercent()).isNull();
        assertThat(result.revenue()).hasSize(7);
        assertThat(result.revenue())
                .extracting(point -> point.revenue())
                .contains(new BigDecimal("1500.00"));
        verify(orders)
                .findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any());
    }

    @Test
    void usesWeeklyBucketsForNinetyDays() {
        when(products.findByDeletedAtIsNullOrderByCreatedAtDesc(any(Pageable.class)))
                .thenReturn(List.of());
        when(audit.findAllByOrderByCreatedAtDesc(any(Pageable.class))).thenReturn(List.of());
        when(orders.findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any()))
                .thenReturn(List.of());

        var result = service.get(90);

        assertThat(result.revenue()).hasSize(13);
    }

    @Test
    void calculatesNetProfitFromTheIncomingPriceSavedInTheOrder() {
        when(products.findByDeletedAtIsNullOrderByCreatedAtDesc(any(Pageable.class)))
                .thenReturn(List.of());
        when(audit.findAllByOrderByCreatedAtDesc(any(Pageable.class))).thenReturn(List.of());
        Order paid = new Order();
        paid.status = OrderStatus.COMPLETED;
        paid.createdAt = Instant.now();
        paid.total = new BigDecimal("1500.00");
        OrderItem item = new OrderItem();
        item.quantity = new BigDecimal("2");
        item.incomingPrice = new BigDecimal("500.00");
        item.lineTotal = new BigDecimal("1500.00");
        item.confirmedLineTotal = item.lineTotal;
        paid.items = List.of(item);
        when(orders.findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any()))
                .thenReturn(List.of(paid));

        var result = service.get(7);

        assertThat(result.revenue())
                .extracting(point -> point.netProfit())
                .contains(new BigDecimal("500.00"));
    }

    @Test
    void skipsLinesWithoutIncomingCostAndExcludesOrdersThatAreNotCompleted() {
        when(products.findByDeletedAtIsNullOrderByCreatedAtDesc(any(Pageable.class)))
                .thenReturn(List.of());
        when(audit.findAllByOrderByCreatedAtDesc(any(Pageable.class))).thenReturn(List.of());

        Order completed = new Order();
        completed.status = OrderStatus.COMPLETED;
        completed.createdAt = Instant.now();
        completed.total = new BigDecimal("2000.00");
        completed.items = List.of(item("1000.00", "400.00"), item("1000.00", null));

        Order stillProcessing = new Order();
        stillProcessing.status = OrderStatus.PROCESSING;
        stillProcessing.createdAt = Instant.now();
        stillProcessing.total = new BigDecimal("900.00");
        stillProcessing.items = List.of(item("900.00", "100.00"));

        when(orders.findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any()))
                .thenReturn(List.of(completed, stillProcessing));

        var result = service.get(7);

        assertThat(result.revenue())
                .extracting(point -> point.revenue())
                .contains(new BigDecimal("2000.00"))
                .doesNotContain(new BigDecimal("2900.00"));
        assertThat(result.revenue())
                .extracting(point -> point.netProfit())
                .contains(new BigDecimal("600.00"));
    }

    private OrderItem item(String soldAmount, String incomingPrice) {
        OrderItem item = new OrderItem();
        item.quantity = BigDecimal.ONE;
        item.lineTotal = new BigDecimal(soldAmount);
        item.confirmedLineTotal = item.lineTotal;
        item.incomingPrice = incomingPrice == null ? null : new BigDecimal(incomingPrice);
        return item;
    }
}
