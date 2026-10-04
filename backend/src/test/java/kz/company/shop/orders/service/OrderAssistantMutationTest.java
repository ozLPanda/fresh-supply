package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.carts.service.CartService;
import kz.company.shop.notifications.service.NotificationService;
import kz.company.shop.orders.dto.BarcodeOrderItemRequest;
import kz.company.shop.orders.entity.*;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.products.entity.*;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.regularbuyers.service.RegularBuyerService;
import kz.company.shop.users.service.UserService;
import kz.company.shop.wallets.service.WalletService;
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OrderAssistantMutationTest {
    final OrderRepository repository = mock(OrderRepository.class);
    final ProductService products = mock(ProductService.class);
    final WarehouseService warehouse = mock(WarehouseService.class);
    final AuditService audit = mock(AuditService.class);
    final OrderService service =
            new OrderService(
                    repository,
                    mock(UuidV7Generator.class),
                    mock(CartService.class),
                    products,
                    mock(WalletService.class),
                    mock(UserService.class),
                    audit,
                    mock(NotificationService.class),
                    mock(PricingService.class),
                    warehouse,
                    mock(RegularBuyerService.class));
    final Order order = new Order();

    @BeforeEach
    void setup() {
        order.id = UUID.randomUUID();
        order.createdByUserId = 7L;
        order.status = OrderStatus.PROCESSING;
        order.orderNumberDate = LocalDate.now();
        order.dailyNumber = 1;
        order.total = BigDecimal.TEN;
        order.paidTotal = BigDecimal.ZERO;
        OrderItem old = new OrderItem();
        old.id = 1L;
        old.productId = 1L;
        old.order = order;
        old.quantity = BigDecimal.ONE;
        old.unitPrice = BigDecimal.TEN;
        old.confirmedUnitPrice = BigDecimal.TEN;
        old.lineTotal = BigDecimal.TEN;
        old.confirmedLineTotal = BigDecimal.TEN;
        old.nameRu = "Old";
        order.items.add(old);
        Product p = new Product();
        p.id = 2L;
        p.sku = "NEW";
        p.nameRu = "Новый";
        p.measurementUnit = MeasurementUnit.KG;
        when(products.getEntity(2L)).thenReturn(p);
        when(repository.findForUpdateById(order.id)).thenReturn(Optional.of(order));
        when(repository.save(any())).thenAnswer(i -> i.getArgument(0));
    }

    List<BarcodeOrderItemRequest> rows() {
        return List.of(
                new BarcodeOrderItemRequest(
                        2L, new BigDecimal("1.5"), new BigDecimal("8.25"), MeasurementUnit.KG));
    }

    @Test
    void atomicallyReplacesLastLineAndReservesOnceWithHistoricalPrice() {
        service.replaceAssistantItems(order.id, rows(), null, "Исправлено", false, 7L);
        assertThat(order.items).hasSize(1);
        assertThat(order.items.get(0).productId).isEqualTo(2);
        assertThat(order.items.get(0).unitPrice).isEqualByComparingTo("8.25");
        assertThat(order.total).isEqualByComparingTo("12.375");
        verify(warehouse).detachAutomaticReturnLines(order, 1L);
        verify(warehouse).reserveOrder(order);
        verify(audit).record(eq("ORDER_ASSISTANT_UPDATE"), eq("ORDER"), eq(order.id), anyString());
    }

    @Test
    void ownerAndCompletedStatusBlockEveryChange() {
        assertThatThrownBy(
                        () -> service.replaceAssistantItems(order.id, rows(), null, "X", false, 8L))
                .hasMessageContaining("свой заказ");
        order.status = OrderStatus.COMPLETED;
        assertThatThrownBy(
                        () -> service.replaceAssistantItems(order.id, rows(), null, "X", false, 7L))
                .hasMessageContaining("завершённом");
        verifyNoInteractions(products, warehouse, audit);
        assertThat(order.items.get(0).productId).isEqualTo(1);
    }

    @Test
    void negativeStockChoicePassedToExistingReservation() {
        order.reservationExpiresAt = Instant.now().plusSeconds(3600);
        service.replaceAssistantItems(order.id, rows(), null, null, true, 7L);
        verify(warehouse).reserveOrder(order, true);
        verify(warehouse, never()).reserveOrder(order);
    }
}
