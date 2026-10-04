package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.carts.service.CartService;
import kz.company.shop.notifications.service.NotificationService;
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
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.api.Test;

class OrderPaymentCompletionTest {
    private static UserService usersWithInvoiceTemplate() {
        UserService users = mock(UserService.class);
        when(users.byId(7L)).thenReturn(new User());
        return users;
    }

    @Test
    void completesGuestOrderUsingConfirmedTotalWithoutWalletOperation() {
        OrderRepository repository = mock(OrderRepository.class);
        WalletService wallets = mock(WalletService.class);
        UserService users = usersWithInvoiceTemplate();
        AuditService audit = mock(AuditService.class);
        NotificationService notifications = mock(NotificationService.class);
        WarehouseService warehouse = mock(WarehouseService.class);
        OrderService service =
                new OrderService(
                        repository,
                        mock(UuidV7Generator.class),
                        mock(CartService.class),
                        mock(ProductService.class),
                        wallets,
                        users,
                        audit,
                        notifications,
                        mock(PricingService.class),
                        warehouse);
        Order order = new Order();
        order.id = UUID.fromString("00000000-0000-7000-8000-000000000015");
        order.orderNumberDate = LocalDate.of(2026, 8, 3);
        order.dailyNumber = 15;
        order.createdByUserId = 7L;
        order.status = OrderStatus.PROCESSING;
        order.paymentStatus = PaymentStatus.PENDING;
        order.total = new BigDecimal("100.00");
        order.paidTotal = BigDecimal.ZERO;
        OrderItem item = new OrderItem();
        item.order = order;
        item.lineTotal = new BigDecimal("100.00");
        item.confirmedLineTotal = new BigDecimal("90.00");
        order.items.add(item);
        when(repository.findForUpdateById(order.id)).thenReturn(Optional.of(order));
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.completePayment(
                order.id,
                7L,
                PaymentMethod.MIXED,
                new BigDecimal("40.00"),
                null,
                null,
                new BigDecimal("10.00"),
                new BigDecimal("20.00"),
                new BigDecimal("20.00"));

        assertThat(order.paymentStatus).isEqualTo(PaymentStatus.PAID);
        assertThat(order.status).isEqualTo(OrderStatus.COMPLETED);
        assertThat(order.paidTotal).isEqualByComparingTo("90.00");
        assertThat(order.paymentMethod).isEqualTo(PaymentMethod.MIXED);
        assertThat(order.cashPaymentAmount).isEqualByComparingTo("40.00");
        assertThat(order.cashlessPaymentAmount).isEqualByComparingTo("50.00");
        assertThat(order.transferPaymentAmount).isEqualByComparingTo("10.00");
        assertThat(order.cardPaymentAmount).isEqualByComparingTo("20.00");
        assertThat(order.qrPaymentAmount).isEqualByComparingTo("20.00");
        assertThat(item.assembled).isTrue();
        assertThat(item.checked).isTrue();
        verify(warehouse).postOrderSale(order, 7L);
        verify(wallets, never()).locked(any());
        verify(notifications, never()).notifyCustomerAboutStatus(any());
        verify(audit).record(eq("PAYMENT_COMPLETE"), eq("ORDER"), eq(order.id), any());
    }

    @Test
    void savesPaymentCommentAndLetsAdminClearItLater() {
        OrderRepository repository = mock(OrderRepository.class);
        OrderService service =
                new OrderService(
                        repository,
                        mock(UuidV7Generator.class),
                        mock(CartService.class),
                        mock(ProductService.class),
                        mock(WalletService.class),
                        usersWithInvoiceTemplate(),
                        mock(AuditService.class),
                        mock(NotificationService.class),
                        mock(PricingService.class),
                        mock(WarehouseService.class));
        Order order = new Order();
        order.id = UUID.fromString("00000000-0000-7000-8000-000000000016");
        order.orderNumberDate = LocalDate.of(2026, 8, 3);
        order.dailyNumber = 16;
        order.status = OrderStatus.PROCESSING;
        order.paymentStatus = PaymentStatus.PENDING;
        order.total = new BigDecimal("100.00");
        order.paidTotal = BigDecimal.ZERO;
        OrderItem item = new OrderItem();
        item.order = order;
        item.lineTotal = new BigDecimal("100.00");
        item.confirmedLineTotal = new BigDecimal("100.00");
        order.items.add(item);
        when(repository.findForUpdateById(order.id)).thenReturn(Optional.of(order));
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.completePayment(
                order.id,
                7L,
                PaymentMethod.CASH,
                null,
                null,
                null,
                null,
                null,
                null,
                "  Выдать со склада  ");

        assertThat(order.comment).isEqualTo("Выдать со склада");

        service.updateComment(order.id, "   ", 7L);

        assertThat(order.comment).isNull();
    }

    @Test
    void updatesPaymentAllocationForCompletedOrderWithoutRepeatingSale() {
        OrderRepository repository = mock(OrderRepository.class);
        WarehouseService warehouse = mock(WarehouseService.class);
        AuditService audit = mock(AuditService.class);
        OrderService service =
                new OrderService(
                        repository,
                        mock(UuidV7Generator.class),
                        mock(CartService.class),
                        mock(ProductService.class),
                        mock(WalletService.class),
                        usersWithInvoiceTemplate(),
                        audit,
                        mock(NotificationService.class),
                        mock(PricingService.class),
                        warehouse);
        Order order = new Order();
        order.id = UUID.fromString("00000000-0000-7000-8000-000000000018");
        order.orderNumberDate = LocalDate.of(2026, 8, 3);
        order.dailyNumber = 18;
        order.status = OrderStatus.COMPLETED;
        order.paymentStatus = PaymentStatus.PAID;
        order.paymentMethod = PaymentMethod.CASH;
        order.total = new BigDecimal("100.00");
        order.paidTotal = new BigDecimal("100.00");
        OrderItem item = new OrderItem();
        item.order = order;
        item.lineTotal = new BigDecimal("100.00");
        item.confirmedLineTotal = new BigDecimal("100.00");
        order.items.add(item);
        when(repository.findForUpdateById(order.id)).thenReturn(Optional.of(order));
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.updateCompletedPayment(
                order.id,
                7L,
                PaymentMethod.MIXED,
                new BigDecimal("40.00"),
                null,
                null,
                new BigDecimal("60.00"),
                BigDecimal.ZERO,
                BigDecimal.ZERO);

        assertThat(order.status).isEqualTo(OrderStatus.COMPLETED);
        assertThat(order.paymentStatus).isEqualTo(PaymentStatus.PAID);
        assertThat(order.paymentMethod).isEqualTo(PaymentMethod.MIXED);
        assertThat(order.cashPaymentAmount).isEqualByComparingTo("40.00");
        assertThat(order.transferPaymentAmount).isEqualByComparingTo("60.00");
        verify(warehouse, never()).postOrderSale(any(), any());
        verify(audit).record(eq("PAYMENT_METHOD_UPDATE"), eq("ORDER"), eq(order.id), any());
    }

    @Test
    void completesPaymentThroughKaspiStoreAsSeparateCashlessMethod() {
        OrderRepository repository = mock(OrderRepository.class);
        OrderService service =
                new OrderService(
                        repository,
                        mock(UuidV7Generator.class),
                        mock(CartService.class),
                        mock(ProductService.class),
                        mock(WalletService.class),
                        usersWithInvoiceTemplate(),
                        mock(AuditService.class),
                        mock(NotificationService.class),
                        mock(PricingService.class),
                        mock(WarehouseService.class));
        Order order = new Order();
        order.id = UUID.fromString("00000000-0000-7000-8000-000000000019");
        order.orderNumberDate = LocalDate.of(2026, 8, 3);
        order.dailyNumber = 19;
        order.status = OrderStatus.PROCESSING;
        order.paymentStatus = PaymentStatus.PENDING;
        order.total = new BigDecimal("100.00");
        order.paidTotal = BigDecimal.ZERO;
        OrderItem item = new OrderItem();
        item.order = order;
        item.lineTotal = new BigDecimal("100.00");
        item.confirmedLineTotal = new BigDecimal("100.00");
        order.items.add(item);
        when(repository.findForUpdateById(order.id)).thenReturn(Optional.of(order));
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.completePayment(order.id, 7L, PaymentMethod.KASPI_STORE);

        assertThat(order.paymentMethod).isEqualTo(PaymentMethod.KASPI_STORE);
        assertThat(order.cashPaymentAmount).isEqualByComparingTo("0.00");
        assertThat(order.cashlessPaymentAmount).isEqualByComparingTo("100.00");
        assertThat(order.cashlessPaymentType).isNull();
    }

    @Test
    void releasesWithShortageOnlyThroughDedicatedWarehouseMethod() {
        OrderRepository repository = mock(OrderRepository.class);
        WarehouseService warehouse = mock(WarehouseService.class);
        AuditService audit = mock(AuditService.class);
        OrderService service =
                new OrderService(
                        repository,
                        mock(UuidV7Generator.class),
                        mock(CartService.class),
                        mock(ProductService.class),
                        mock(WalletService.class),
                        usersWithInvoiceTemplate(),
                        audit,
                        mock(NotificationService.class),
                        mock(PricingService.class),
                        warehouse);
        Order order = new Order();
        order.id = UUID.fromString("00000000-0000-7000-8000-000000000017");
        order.orderNumberDate = LocalDate.of(2026, 8, 3);
        order.dailyNumber = 17;
        order.status = OrderStatus.PROCESSING;
        order.paymentStatus = PaymentStatus.PENDING;
        order.total = new BigDecimal("100.00");
        order.paidTotal = BigDecimal.ZERO;
        OrderItem item = new OrderItem();
        item.order = order;
        item.lineTotal = new BigDecimal("100.00");
        item.confirmedLineTotal = new BigDecimal("100.00");
        order.items.add(item);
        when(repository.findForUpdateById(order.id)).thenReturn(Optional.of(order));
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.completePayment(
                order.id,
                7L,
                PaymentMethod.CASH,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                true,
                "Отпущено по согласованию");

        verify(warehouse)
                .postOrderSaleWithShortage(order, 7L, "Отпущено по согласованию");
        verify(warehouse, never()).postOrderSale(order, 7L);
        verify(audit).record(eq("STOCK_SHORTAGE_RELEASE"), eq("ORDER"), eq(order.id), any());
    }
}
