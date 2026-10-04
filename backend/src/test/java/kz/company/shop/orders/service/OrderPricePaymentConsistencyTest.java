package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.carts.service.CartService;
import kz.company.shop.notifications.service.NotificationService;
import kz.company.shop.orders.dto.OrderPriceUpdateItemRequest;
import kz.company.shop.orders.dto.OrderPriceUpdateRequest;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentMethod;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.service.UserService;
import kz.company.shop.wallets.service.WalletService;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

class OrderPricePaymentConsistencyTest {
    @ParameterizedTest
    @CsvSource({"false,false", "false,true", "true,false", "true,true"})
    void staffRepricingChargesCurrentTotal(boolean fromDocument, boolean linkedCustomer) {
        Fixture fixture = new Fixture();
        fixture.order.createdByUserId = 7L;
        fixture.order.userId = linkedCustomer ? 8L : null;

        fixture.reprice(fromDocument);

        assertThat(fixture.order.total).isEqualByComparingTo("51492.00");
        assertThat(fixture.order.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(fixture.first.confirmedUnitPrice).isEqualByComparingTo("19900.00");
        assertThat(fixture.first.confirmedLineTotal).isEqualByComparingTo("39800.00");
        assertThat(fixture.second.confirmedUnitPrice).isEqualByComparingTo("11692.00");
        assertThat(fixture.second.confirmedLineTotal).isEqualByComparingTo("11692.00");
        verify(fixture.notifications, never()).notifyCustomerAboutPriceReview(any());

        fixture.service.completePayment(fixture.order.id, 7L, PaymentMethod.CASH);

        assertThat(fixture.order.paymentStatus).isEqualTo(PaymentStatus.PAID);
        assertThat(fixture.order.status).isEqualTo(OrderStatus.COMPLETED);
        assertThat(fixture.order.cashPaymentAmount).isEqualByComparingTo("51492.00");
        assertThat(fixture.order.paidTotal).isEqualByComparingTo("51492.00");
        verify(fixture.warehouse).postOrderSale(fixture.order, 7L);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void customerRepricingPreservesConfirmedPricesUntilReview(boolean fromDocument) {
        Fixture fixture = new Fixture();
        fixture.order.userId = 8L;

        fixture.reprice(fromDocument);

        assertThat(fixture.order.total).isEqualByComparingTo("51492.00");
        assertThat(fixture.first.unitPrice).isEqualByComparingTo("19900.00");
        assertThat(fixture.first.lineTotal).isEqualByComparingTo("39800.00");
        assertThat(fixture.second.unitPrice).isEqualByComparingTo("11692.00");
        assertThat(fixture.second.lineTotal).isEqualByComparingTo("11692.00");
        assertThat(fixture.first.confirmedUnitPrice).isEqualByComparingTo("20000.00");
        assertThat(fixture.first.confirmedLineTotal).isEqualByComparingTo("40000.00");
        assertThat(fixture.second.confirmedUnitPrice).isEqualByComparingTo("11726.00");
        assertThat(fixture.second.confirmedLineTotal).isEqualByComparingTo("11726.00");
        assertThat(fixture.order.status).isEqualTo(OrderStatus.PRICE_REVIEW);
        assertThat(fixture.order.paymentStatus).isEqualTo(PaymentStatus.PENDING);
        assertThat(fixture.order.paidTotal).isEqualByComparingTo(BigDecimal.ZERO);
        verify(fixture.notifications).notifyCustomerAboutPriceReview(fixture.order);
        verify(fixture.warehouse).releaseOrderReservations(fixture.order);
    }

    private static class Fixture {
        final OrderRepository repository = mock(OrderRepository.class);
        final NotificationService notifications = mock(NotificationService.class);
        final WarehouseService warehouse = mock(WarehouseService.class);
        final UserService users = mock(UserService.class);
        final OrderService service =
                new OrderService(
                        repository,
                        mock(UuidV7Generator.class),
                        mock(CartService.class),
                        mock(ProductService.class),
                        mock(WalletService.class),
                        users,
                        mock(AuditService.class),
                        notifications,
                        mock(PricingService.class),
                        warehouse);
        final Order order = new Order();
        final OrderItem first;
        final OrderItem second;

        Fixture() {
            order.id = UUID.fromString("00000000-0000-7000-8000-000000000021");
            order.orderNumberDate = LocalDate.of(2026, 9, 12);
            order.dailyNumber = 21;
            order.status = OrderStatus.PROCESSING;
            order.paymentStatus = PaymentStatus.PENDING;
            order.total = new BigDecimal("51726.00");
            order.paidTotal = BigDecimal.ZERO;
            first = item(101L, "20000.00", "2");
            second = item(102L, "11726.00", "1");
            when(repository.findWithItemsById(order.id)).thenReturn(Optional.of(order));
            when(repository.findForUpdateById(order.id)).thenReturn(Optional.of(order));
            when(repository.save(any(Order.class)))
                    .thenAnswer(invocation -> invocation.getArgument(0));
            when(users.byId(any())).thenReturn(new User());
        }

        private OrderItem item(Long id, String price, String quantity) {
            OrderItem item = new OrderItem();
            item.id = id;
            item.productId = id;
            item.order = order;
            item.quantity = new BigDecimal(quantity);
            item.unitPrice = new BigDecimal(price);
            item.lineTotal = item.unitPrice.multiply(item.quantity);
            item.confirmedUnitPrice = item.unitPrice;
            item.confirmedLineTotal = item.lineTotal;
            order.items.add(item);
            return item;
        }

        void reprice(boolean fromDocument) {
            if (fromDocument) {
                UUID documentId = UUID.fromString("00000000-0000-7000-8000-000000000022");
                when(warehouse.pricesFromPriceSettingDocument(documentId, Set.of(101L, 102L)))
                        .thenReturn(
                                Map.of(
                                        101L, new BigDecimal("19900.00"),
                                        102L, new BigDecimal("11692.00")));
                when(warehouse.priceSettingDocumentReference(documentId))
                        .thenReturn(
                                new WarehouseDto.PriceSettingDocumentReference(
                                        documentId, "PRICE-22", StockDocumentPriceType.RETAIL, null));
                service.updatePricesFromPriceSettingDocument(order.id, documentId, 7L);
            } else {
                service.updatePrices(
                        order.id,
                        new OrderPriceUpdateRequest(
                                List.of(
                                        new OrderPriceUpdateItemRequest(
                                                101L, new BigDecimal("19900.00")),
                                        new OrderPriceUpdateItemRequest(
                                                102L, new BigDecimal("11692.00")))),
                        7L);
            }
        }
    }
}
