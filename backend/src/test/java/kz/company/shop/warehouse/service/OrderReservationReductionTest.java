package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.repository.OrderItemRepository;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.ai.AiPriceSessionRepository;
import kz.company.shop.warehouse.entity.StockReservation;
import kz.company.shop.warehouse.entity.StockReservationStatus;
import kz.company.shop.warehouse.entity.Warehouse;
import kz.company.shop.warehouse.repository.*;
import org.junit.jupiter.api.Test;

class OrderReservationReductionTest {
    @Test
    void duplicateProductLinesShareDemandAndOnlyExcessReservationsAreReleased() {
        Fixture fixture = new Fixture();
        fixture.line(10L, "1.25");
        fixture.line(10L, "1.25");
        StockReservation first = fixture.reservation(10L, "2", 0);
        StockReservation second = fixture.reservation(10L, "2", 1);
        StockReservation third = fixture.reservation(10L, "1", 2);
        StockReservation unrelated = fixture.reservation(20L, "7", 3);
        fixture.held(third, unrelated, second, first);
        Instant firstCreatedAt = first.createdAt;

        fixture.service.reduceOrderReservations(fixture.order, 10L);

        assertThat(first.quantity).isEqualByComparingTo("2");
        assertThat(first.createdAt).isEqualTo(firstCreatedAt);
        assertThat(first.status).isEqualTo(StockReservationStatus.ACTIVE);
        assertThat(second.quantity).isEqualByComparingTo("0.5");
        assertThat(second.status).isEqualTo(StockReservationStatus.ACTIVE);
        assertThat(third.status).isEqualTo(StockReservationStatus.RELEASED);
        assertThat(third.releasedAt).isNotNull();
        assertThat(third.quantity).isEqualByComparingTo("1");
        assertThat(unrelated.quantity).isEqualByComparingTo("7");
        assertThat(unrelated.status).isEqualTo(StockReservationStatus.ACTIVE);
        assertThat(unrelated.releasedAt).isNull();
        verifyNoInteractions(fixture.movements);
        verify(fixture.reservations, never()).save(any());
    }

    @Test
    void partialReservationNeverGrowsAndMissingReservationIsNotCreated() {
        Fixture fixture = new Fixture();
        fixture.line(10L, "4");
        fixture.line(20L, "2");
        StockReservation partial = fixture.reservation(10L, "1", 0);
        fixture.held(partial);

        fixture.service.reduceOrderReservations(fixture.order, 10L);
        fixture.service.reduceOrderReservations(fixture.order, 20L);

        assertThat(partial.quantity).isEqualByComparingTo("1");
        assertThat(partial.status).isEqualTo(StockReservationStatus.ACTIVE);
        verifyNoInteractions(fixture.movements);
        verify(fixture.reservations, never()).save(any());
    }

    @Test
    void removingManualLineDoesNotTouchWarehouse() {
        Fixture fixture = new Fixture();

        fixture.service.reduceOrderReservations(fixture.order, null);

        verifyNoInteractions(fixture.warehouses, fixture.reservations, fixture.movements);
    }

    private static final class Fixture {
        final WarehouseRepository warehouses = mock(WarehouseRepository.class);
        final StockReservationRepository reservations = mock(StockReservationRepository.class);
        final StockMovementRepository movements = mock(StockMovementRepository.class);
        final WarehouseService service = new WarehouseService(
                warehouses, mock(StockDocumentRepository.class), mock(StockDocumentVersionRepository.class),
                mock(StockDocumentLineRepository.class), mock(PriceSettingGroupRepository.class),
                mock(WarehouseCounterpartyRepository.class), movements, mock(StockCostLayerRepository.class),
                reservations, mock(ProductRepository.class), mock(OrderRepository.class),
                mock(OrderItemRepository.class), mock(UserRepository.class), mock(AiPriceSessionRepository.class));
        final Order order = new Order();

        Fixture() {
            order.id = UUID.randomUUID();
            Warehouse warehouse = new Warehouse();
            warehouse.id = 1L;
            when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
            when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        }

        void line(Long productId, String quantity) {
            OrderItem item = new OrderItem();
            item.productId = productId;
            item.quantity = new BigDecimal(quantity);
            order.items.add(item);
        }

        StockReservation reservation(Long productId, String quantity, int offset) {
            StockReservation reservation = new StockReservation();
            reservation.id = UUID.randomUUID();
            reservation.orderId = order.id;
            reservation.warehouseId = 1L;
            reservation.productId = productId;
            reservation.quantity = new BigDecimal(quantity);
            reservation.createdAt = Instant.parse("2026-10-01T00:00:00Z").plusSeconds(offset);
            return reservation;
        }

        void held(StockReservation... held) {
            when(reservations.findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE))
                    .thenReturn(List.of(held));
        }
    }
}
