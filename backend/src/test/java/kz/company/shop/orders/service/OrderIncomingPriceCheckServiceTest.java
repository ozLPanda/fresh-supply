package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.priceStatistics.repository.PriceChangeSnapshotRepository;
import org.junit.jupiter.api.Test;

class OrderIncomingPriceCheckServiceTest {
    @Test
    void usesTheOldCostFromTheFirstLaterImportForAnOrderBeforeThatImportDate() {
        OrderRepository orders = mock(OrderRepository.class);
        PriceChangeSnapshotRepository snapshots = mock(PriceChangeSnapshotRepository.class);
        OrderIncomingPriceCheckService service =
                new OrderIncomingPriceCheckService(orders, snapshots);
        UUID orderId = UUID.randomUUID();
        Order order = orderOn(LocalDate.of(2026, 8, 19), OrderStatus.NEW, 90, 80);
        when(orders.findWithItemsById(orderId)).thenReturn(Optional.of(order));
        when(snapshots.findIncomingPricesEffectiveBefore(eq(1L), any(Instant.class)))
                .thenReturn(List.of());
        when(snapshots.findIncomingPricesStartingAt(eq(1L), any(Instant.class)))
                .thenReturn(List.of(BigDecimal.valueOf(100)));

        var result = service.check(orderId);

        assertThat(result.applicable()).isTrue();
        assertThat(result.problems())
                .singleElement()
                .satisfies(
                        problem -> {
                            assertThat(problem.orderItemId()).isEqualTo(10L);
                            assertThat(problem.incomingPrice()).isEqualByComparingTo("100");
                        });
        verify(snapshots)
                .findIncomingPricesStartingAt(
                        1L,
                        LocalDate.of(2026, 8, 20)
                                .atStartOfDay(java.time.ZoneId.of("Asia/Almaty"))
                                .toInstant());
    }

    @Test
    void treatsAnImportAsEffectiveForTheWholeOrderDate() {
        OrderRepository orders = mock(OrderRepository.class);
        PriceChangeSnapshotRepository snapshots = mock(PriceChangeSnapshotRepository.class);
        OrderIncomingPriceCheckService service =
                new OrderIncomingPriceCheckService(orders, snapshots);
        UUID orderId = UUID.randomUUID();
        Order order = orderOn(LocalDate.of(2026, 8, 20), OrderStatus.NEW, 110, 80);
        when(orders.findWithItemsById(orderId)).thenReturn(Optional.of(order));
        when(snapshots.findIncomingPricesEffectiveBefore(eq(1L), any(Instant.class)))
                .thenReturn(List.of(BigDecimal.valueOf(120)));

        var result = service.check(orderId);

        assertThat(result.problems())
                .singleElement()
                .extracting(problem -> problem.orderItemId())
                .isEqualTo(10L);
        verify(snapshots)
                .findIncomingPricesEffectiveBefore(
                        1L,
                        LocalDate.of(2026, 8, 21)
                                .atStartOfDay(java.time.ZoneId.of("Asia/Almaty"))
                                .toInstant());
    }

    @Test
    void skipsCompletedOrders() {
        OrderRepository orders = mock(OrderRepository.class);
        PriceChangeSnapshotRepository snapshots = mock(PriceChangeSnapshotRepository.class);
        OrderIncomingPriceCheckService service =
                new OrderIncomingPriceCheckService(orders, snapshots);
        UUID orderId = UUID.randomUUID();
        when(orders.findWithItemsById(orderId))
                .thenReturn(
                        Optional.of(
                                orderOn(LocalDate.of(2026, 8, 20), OrderStatus.COMPLETED, 90, 80)));

        var result = service.check(orderId);

        assertThat(result.applicable()).isFalse();
        assertThat(result.problems()).isEmpty();
        verifyNoInteractions(snapshots);
    }

    private Order orderOn(
            LocalDate date, OrderStatus status, int unitPrice, int snapshotIncomingPrice) {
        Order order = new Order();
        order.orderNumberDate = date;
        order.status = status;
        OrderItem item = new OrderItem();
        item.id = 10L;
        item.productId = 1L;
        item.unitPrice = BigDecimal.valueOf(unitPrice);
        item.incomingPrice = BigDecimal.valueOf(snapshotIncomingPrice);
        order.items = List.of(item);
        return order;
    }
}
