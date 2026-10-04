package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.carts.entity.CartItem;
import kz.company.shop.carts.service.CartService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.notifications.service.NotificationService;
import kz.company.shop.orders.dto.CheckoutRequest;
import kz.company.shop.orders.dto.OrderItemOrderUpdateRequest;
import kz.company.shop.orders.dto.OrderItemQuantityUpdateRequest;
import kz.company.shop.orders.dto.OrderPriceUpdateItemRequest;
import kz.company.shop.orders.dto.OrderPriceUpdateRequest;
import kz.company.shop.orders.entity.FulfillmentType;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentMethod;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.service.UserService;
import kz.company.shop.wallets.entity.Wallet;
import kz.company.shop.wallets.service.WalletService;
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.api.Test;

class OrderServiceTest {
    @Test
    void copyCreatesIndependentPendingOrderWithCopiedItems() {
        OrderRepository repository = mock(OrderRepository.class);
        UuidV7Generator ids = mock(UuidV7Generator.class);
        AuditService audit = mock(AuditService.class);
        OrderService service =
                new OrderService(
                        repository,
                        ids,
                        mock(CartService.class),
                        mock(ProductService.class),
                        mock(WalletService.class),
                        mock(UserService.class),
                        audit,
                        mock(NotificationService.class),
                        mock(PricingService.class),
                        mock(WarehouseService.class));
        UUID sourceId = UUID.fromString("00000000-0000-7000-8000-000000000015");
        UUID copiedId = UUID.fromString("00000000-0000-7000-8000-000000000016");
        Order source = new Order();
        source.id = sourceId;
        source.orderNumberDate = LocalDate.of(2026, 8, 17);
        source.dailyNumber = 15;
        source.status = OrderStatus.COMPLETED;
        source.paymentStatus = PaymentStatus.PAID;
        source.paymentMethod = PaymentMethod.CASH;
        source.fulfillmentType = FulfillmentType.PICKUP;
        source.contactPhone = "+77770000000";
        source.priceTier = kz.company.shop.orders.entity.PriceTier.RETAIL;
        source.total = money("200.00");
        source.paidTotal = money("200.00");
        OrderItem sourceItem = new OrderItem();
        sourceItem.order = source;
        sourceItem.productId = 10L;
        sourceItem.madeToOrder = true;
        sourceItem.sku = "10";
        sourceItem.nameRu = "Товар";
        sourceItem.unitPrice = money("100.00");
        sourceItem.confirmedUnitPrice = money("100.00");
        sourceItem.priceTier = kz.company.shop.orders.entity.PriceTier.RETAIL;
        sourceItem.quantity = BigDecimal.valueOf(2);
        sourceItem.lineTotal = money("200.00");
        sourceItem.confirmedLineTotal = money("200.00");
        source.items.add(sourceItem);
        when(repository.findWithItemsById(sourceId)).thenReturn(Optional.of(source));
        when(ids.next()).thenReturn(copiedId);
        when(repository.nextDailyNumber(any())).thenReturn(16L);
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.copy(sourceId, 7L);

        var saved = org.mockito.ArgumentCaptor.forClass(Order.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().id).isEqualTo(copiedId);
        assertThat(saved.getValue().status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(saved.getValue().paymentStatus).isEqualTo(PaymentStatus.PENDING);
        assertThat(saved.getValue().paymentMethod).isEqualTo(PaymentMethod.ON_RECEIPT);
        assertThat(saved.getValue().paidTotal).isEqualByComparingTo("0");
        assertThat(saved.getValue().reservationExpiresAt).isAfter(Instant.now());
        assertThat(saved.getValue().items)
                .singleElement()
                .satisfies(
                        item -> {
                            assertThat(item).isNotSameAs(sourceItem);
                            assertThat(item.quantity).isEqualByComparingTo("2");
                            assertThat(item.lineTotal).isEqualByComparingTo("200");
                            assertThat(item.madeToOrder).isTrue();
                            assertThat(item.assembled).isFalse();
                            assertThat(item.checked).isFalse();
                        });
        verify(audit).record(eq("ORDER_COPY"), eq("ORDER"), eq(copiedId), any());
    }

    @Test
    void deliveryRequiresAddressBeforeAnyPaymentWork() {
        OrderService service =
                new OrderService(
                        mock(OrderRepository.class),
                        mock(UuidV7Generator.class),
                        mock(CartService.class),
                        mock(ProductService.class),
                        mock(WalletService.class),
                        mock(UserService.class),
                        mock(AuditService.class),
                        mock(NotificationService.class),
                        mock(PricingService.class),
                        mock(WarehouseService.class));

        assertThatThrownBy(
                        () ->
                                service.checkout(
                                        1L,
                                        new CheckoutRequest(
                                                List.of(1L),
                                                FulfillmentType.DELIVERY,
                                                PaymentMethod.BALANCE,
                                                " ",
                                                "+7 777 000 00 00",
                                                null)))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("адрес");
    }

    @Test
    void checkoutCreatesOrderAndDebitsOnlySelectedCartItems() {
        OrderRepository repository = mock(OrderRepository.class);
        CartService carts = mock(CartService.class);
        ProductService products = mock(ProductService.class);
        WalletService wallets = mock(WalletService.class);
        UserService users = mock(UserService.class);
        PricingService pricing = mock(PricingService.class);
        UuidV7Generator ids = mock(UuidV7Generator.class);
        NotificationService notifications = mock(NotificationService.class);
        OrderService service =
                new OrderService(
                        repository,
                        ids,
                        carts,
                        products,
                        wallets,
                        users,
                        mock(AuditService.class),
                        notifications,
                        pricing,
                        mock(WarehouseService.class));
        CartItem selected = cartItem(11L, 101L, 2);
        CartItem notSelected = cartItem(12L, 102L, 3);
        Product product = product(101L, "Выбранный товар");
        product.madeToOrder = true;
        User customer = new User();
        customer.id = 7L;
        customer.name = "Клиент";
        customer.email = "client@example.com";
        Wallet wallet = new Wallet();
        wallet.userId = 7L;
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000015");
        when(carts.entitiesForCheckout(7L, List.of(selected.id))).thenReturn(List.of(selected));
        when(products.getEntity(selected.productId)).thenReturn(product);
        when(pricing.calculateCart(anyList(), anySet(), any(), anyBoolean()))
                .thenReturn(
                        new PricingService.CartPricing(
                                PriceTier.BULK_WHOLESALE,
                                java.util.Map.of(101L, money("50.00")),
                                List.of()));
        when(ids.next()).thenReturn(orderId);
        when(repository.nextDailyNumber(any())).thenReturn(15L);
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(wallets.locked(7L)).thenReturn(wallet);
        when(users.byId(7L)).thenReturn(customer);

        service.checkout(
                7L,
                new CheckoutRequest(
                        List.of(selected.id),
                        FulfillmentType.PICKUP,
                        PaymentMethod.BALANCE,
                        null,
                        "+77770000000",
                        null));

        var saved = org.mockito.ArgumentCaptor.forClass(Order.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().priceTier).isEqualTo(PriceTier.BULK_WHOLESALE);
        assertThat(saved.getValue().items).hasSize(1);
        assertThat(saved.getValue().items.getFirst().productId).isEqualTo(selected.productId);
        assertThat(saved.getValue().items.getFirst().madeToOrder).isTrue();
        assertThat(saved.getValue().items.getFirst().priceTier).isEqualTo(PriceTier.BULK_WHOLESALE);
        assertThat(saved.getValue().total).isEqualByComparingTo("100.00");
        verify(wallets)
                .debit(
                        eq(wallet),
                        argThat(amount -> amount.compareTo(money("100.00")) == 0),
                        eq(orderId),
                        any());
        verify(carts).removeForCheckout(7L, List.of(selected.id));
        verify(carts, never()).removeForCheckout(7L, List.of(notSelected.id));
        verify(notifications).notifyAdminsAboutNewOrder(any(Order.class), eq(customer));

        when(users.isAdministrator(7L)).thenReturn(true);
        service.checkout(
                7L,
                new CheckoutRequest(
                        List.of(selected.id),
                        FulfillmentType.PICKUP,
                        PaymentMethod.BALANCE,
                        null,
                        "+77770000000",
                        null));

        verify(notifications, times(1)).notifyAdminsAboutNewOrder(any(Order.class), eq(customer));
    }

    @Test
    void checkoutWithPaymentOnReceiptDoesNotDebitWallet() {
        OrderRepository repository = mock(OrderRepository.class);
        CartService carts = mock(CartService.class);
        ProductService products = mock(ProductService.class);
        WalletService wallets = mock(WalletService.class);
        UserService users = mock(UserService.class);
        PricingService pricing = mock(PricingService.class);
        UuidV7Generator ids = mock(UuidV7Generator.class);
        OrderService service =
                new OrderService(
                        repository,
                        ids,
                        carts,
                        products,
                        wallets,
                        users,
                        mock(AuditService.class),
                        mock(NotificationService.class),
                        pricing,
                        mock(WarehouseService.class));
        CartItem selected = cartItem(11L, 101L, 1);
        Product product = product(101L, "Выбранный товар");
        User customer = new User();
        customer.id = 7L;
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000015");
        when(carts.entitiesForCheckout(7L, List.of(selected.id))).thenReturn(List.of(selected));
        when(products.getEntity(selected.productId)).thenReturn(product);
        when(pricing.calculateCart(anyList(), anySet(), any(), anyBoolean()))
                .thenReturn(
                        new PricingService.CartPricing(
                                PriceTier.RETAIL,
                                java.util.Map.of(101L, money("50.00")),
                                List.of()));
        when(ids.next()).thenReturn(orderId);
        when(repository.nextDailyNumber(any())).thenReturn(15L);
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(users.byId(7L)).thenReturn(customer);

        service.checkout(
                7L,
                new CheckoutRequest(
                        List.of(selected.id),
                        FulfillmentType.PICKUP,
                        PaymentMethod.ON_RECEIPT,
                        null,
                        "+77770000000",
                        null));

        var saved = org.mockito.ArgumentCaptor.forClass(Order.class);
        verify(repository).save(saved.capture());
        assertThat(saved.getValue().paymentMethod).isEqualTo(PaymentMethod.ON_RECEIPT);
        assertThat(saved.getValue().paymentStatus).isEqualTo(PaymentStatus.PENDING);
        assertThat(saved.getValue().paidTotal).isEqualByComparingTo(BigDecimal.ZERO);
        verify(wallets, never()).debit(any(), any(), any(), any());
        verify(carts).removeForCheckout(7L, List.of(selected.id));
    }

    @Test
    void checkoutRejectsDuplicateCartItemIds() {
        CartService carts = mock(CartService.class);
        OrderService service =
                new OrderService(
                        mock(OrderRepository.class),
                        mock(UuidV7Generator.class),
                        carts,
                        mock(ProductService.class),
                        mock(WalletService.class),
                        mock(UserService.class),
                        mock(AuditService.class),
                        mock(NotificationService.class),
                        mock(PricingService.class),
                        mock(WarehouseService.class));

        assertThatThrownBy(
                        () ->
                                service.checkout(
                                        7L,
                                        new CheckoutRequest(
                                                List.of(11L, 11L),
                                                FulfillmentType.PICKUP,
                                                PaymentMethod.BALANCE,
                                                null,
                                                "+77770000000",
                                                null)))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("несколько раз");

        verifyNoInteractions(carts);
    }

    @Test
    void checkoutRejectsItemsNotBelongingToCustomersCart() {
        CartService carts = mock(CartService.class);
        OrderService service =
                new OrderService(
                        mock(OrderRepository.class),
                        mock(UuidV7Generator.class),
                        carts,
                        mock(ProductService.class),
                        mock(WalletService.class),
                        mock(UserService.class),
                        mock(AuditService.class),
                        mock(NotificationService.class),
                        mock(PricingService.class),
                        mock(WarehouseService.class));
        when(carts.entitiesForCheckout(7L, List.of(11L, 12L)))
                .thenReturn(List.of(cartItem(11L, 101L, 1)));

        assertThatThrownBy(
                        () ->
                                service.checkout(
                                        7L,
                                        new CheckoutRequest(
                                                List.of(11L, 12L),
                                                FulfillmentType.PICKUP,
                                                PaymentMethod.BALANCE,
                                                null,
                                                "+77770000000",
                                                null)))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("больше не находятся");

        verify(carts, never()).removeForCheckout(any(), any());
    }

    @Test
    void statusChangeNotifiesCustomerOnlyWhenValueActuallyChanges() {
        OrderRepository repository = mock(OrderRepository.class);
        UserService users = mock(UserService.class);
        AuditService audit = mock(AuditService.class);
        NotificationService notifications = mock(NotificationService.class);
        OrderService service =
                new OrderService(
                        repository,
                        mock(UuidV7Generator.class),
                        mock(CartService.class),
                        mock(ProductService.class),
                        mock(WalletService.class),
                        users,
                        audit,
                        notifications,
                        mock(PricingService.class),
                        mock(WarehouseService.class));
        Order order = new Order();
        order.id = UUID.fromString("00000000-0000-7000-8000-000000000015");
        order.orderNumberDate = LocalDate.of(2026, 8, 3);
        order.dailyNumber = 15;
        order.userId = 8L;
        order.status = OrderStatus.NEW;
        User user = new User();
        user.id = 8L;
        user.name = "Клиент";
        user.email = "client@example.com";
        when(repository.findWithItemsById(order.id)).thenReturn(Optional.of(order));
        when(repository.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(users.byId(8L)).thenReturn(user);

        service.updateStatus(order.id, OrderStatus.PROCESSING, 1L);

        verify(notifications).notifyCustomerAboutStatus(order);
        verify(audit).record(any(), any(), any(), any(), any());

        service.updateStatus(order.id, OrderStatus.PROCESSING, 1L);

        verify(notifications).notifyCustomerAboutStatus(order);
        verify(notifications, never()).notifyAdminsAboutNewOrder(any(), any());
    }

    @Test
    void adminPriceUpdateMovesOrderToReviewAndNotifiesCustomer() {
        Fixture fixture = new Fixture();

        fixture.service.updatePrices(
                fixture.order.id,
                new OrderPriceUpdateRequest(
                        List.of(
                                new OrderPriceUpdateItemRequest(101L, money("15.00")),
                                new OrderPriceUpdateItemRequest(102L, money("30.00")))),
                1L);

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PRICE_REVIEW);
        assertThat(fixture.order.total).isEqualByComparingTo("90.00");
        assertThat(fixture.first.unitPrice).isEqualByComparingTo("15.00");
        assertThat(fixture.first.lineTotal).isEqualByComparingTo("30.00");
        assertThat(fixture.first.confirmedUnitPrice).isEqualByComparingTo("10.00");
        verify(fixture.notifications).notifyCustomerAboutPriceReview(fixture.order);
    }

    @Test
    void customerConfirmationDebitsOnlyPriceIncreaseDelta() {
        Fixture fixture = new Fixture();
        fixture.moveToPriceReview("130.00");

        fixture.service.confirmPrices(8L, fixture.order.id);

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(fixture.order.paidTotal).isEqualByComparingTo("130.00");
        assertThat(fixture.order.reservationExpiresAt).isAfter(Instant.now());
        assertThat(fixture.first.confirmedUnitPrice).isEqualByComparingTo(fixture.first.unitPrice);
        verify(fixture.wallets)
                .priceDebit(
                        any(),
                        argThat(amount -> amount.compareTo(money("30.00")) == 0),
                        eq(fixture.order.id),
                        any());
        verify(fixture.notifications)
                .notifyAdminsAboutPriceConfirmation(fixture.order, fixture.user);
    }

    @Test
    void customerConfirmationRefundsOnlyPriceDecreaseDelta() {
        Fixture fixture = new Fixture();
        fixture.moveToPriceReview("80.00");

        fixture.service.confirmPrices(8L, fixture.order.id);

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(fixture.order.paidTotal).isEqualByComparingTo("80.00");
        verify(fixture.wallets)
                .priceRefund(
                        any(),
                        argThat(amount -> amount.compareTo(money("20.00")) == 0),
                        eq(fixture.order.id),
                        any(),
                        eq(8L));
    }

    @Test
    void customerConfirmationKeepsReviewStatusWhenBalanceIsInsufficient() {
        Fixture fixture = new Fixture();
        fixture.moveToPriceReview("130.00");
        doThrow(new AppExceptions.BadRequest("Недостаточно средств на балансе"))
                .when(fixture.wallets)
                .priceDebit(any(), any(), eq(fixture.order.id), any());

        assertThatThrownBy(() -> fixture.service.confirmPrices(8L, fixture.order.id))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Недостаточно");

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PRICE_REVIEW);
        assertThat(fixture.order.paidTotal).isEqualByComparingTo("100.00");
        verify(fixture.repository, never()).save(any(Order.class));
    }

    @Test
    void customerConfirmationForPaymentOnReceiptDoesNotUseWallet() {
        Fixture fixture = new Fixture();
        fixture.order.paymentMethod = PaymentMethod.ON_RECEIPT;
        fixture.order.paymentStatus = PaymentStatus.PENDING;
        fixture.order.paidTotal = BigDecimal.ZERO;
        fixture.moveToPriceReview("130.00");

        fixture.service.confirmPrices(8L, fixture.order.id);

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(fixture.order.paymentStatus).isEqualTo(PaymentStatus.PENDING);
        assertThat(fixture.order.paidTotal).isEqualByComparingTo(BigDecimal.ZERO);
        verifyNoInteractions(fixture.wallets);
    }

    @Test
    void cancellingPriceReviewOrderRefundsPaidTotal() {
        Fixture fixture = new Fixture();
        fixture.moveToPriceReview("130.00");

        fixture.service.updateStatus(fixture.order.id, OrderStatus.CANCELLED, 1L);

        assertThat(fixture.order.status).isEqualTo(OrderStatus.CANCELLED);
        assertThat(fixture.order.paymentStatus).isEqualTo(PaymentStatus.REFUNDED);
        verify(fixture.wallets)
                .refund(
                        any(),
                        argThat(amount -> amount.compareTo(money("100.00")) == 0),
                        eq(fixture.order.id),
                        any(),
                        eq(1L));
    }

    @Test
    void statusChangeToProcessingCreatesDefaultReservationAndCancellationReleasesIt() {
        Fixture fixture = new Fixture();

        fixture.service.updateStatus(fixture.order.id, OrderStatus.PROCESSING, 1L);

        verify(fixture.warehouse).reserveOrder(fixture.order);
        assertThat(fixture.order.reservationExpiresAt).isAfter(Instant.now());

        fixture.service.updateStatus(fixture.order.id, OrderStatus.CANCELLED, 1L);

        verify(fixture.warehouse).releaseOrderReservations(fixture.order);
        assertThat(fixture.order.reservationExpiresAt).isNull();
    }

    @Test
    void acceptedStockShortageUsesPartialReservation() {
        Fixture fixture = new Fixture();

        fixture.service.ensureDefaultReservation(fixture.order, true);

        verify(fixture.warehouse).reserveOrder(fixture.order, true);
        assertThat(fixture.order.reservationExpiresAt).isAfter(Instant.now());
    }

    @Test
    void reserveUsesDefaultTwentyFourHourExpiryWithoutChangingOrderStatus() {
        Fixture fixture = new Fixture();
        fixture.order.status = OrderStatus.PROCESSING;
        when(fixture.repository.findForUpdateById(fixture.order.id))
                .thenReturn(Optional.of(fixture.order));
        Instant startedAt = Instant.now();

        fixture.service.reserve(fixture.order.id, null, 1L);

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(fixture.order.reservationExpiresAt)
                .isBetween(startedAt.plusSeconds(24 * 60 * 60), Instant.now().plusSeconds(24 * 60 * 60));
        verify(fixture.warehouse).reserveOrder(fixture.order);
        verify(fixture.repository).save(fixture.order);
    }

    @Test
    void reserveRejectsOrderOutsideProcessingStatus() {
        Fixture fixture = new Fixture();
        when(fixture.repository.findForUpdateById(fixture.order.id))
                .thenReturn(Optional.of(fixture.order));

        assertThatThrownBy(
                        () ->
                                fixture.service.reserve(
                                        fixture.order.id, Instant.now().plusSeconds(3600), 1L))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("только для заказа в работе");

        verify(fixture.warehouse, never()).reserveOrder(any(Order.class));
    }

    @Test
    void expiredReservationIsReleasedWithoutChangingOrderStatus() {
        Fixture fixture = new Fixture();
        fixture.order.status = OrderStatus.PROCESSING;
        fixture.order.reservationExpiresAt = Instant.now().minusSeconds(1);
        when(fixture.repository.findExpiredReservationIds(any())).thenReturn(List.of(fixture.order.id));
        when(fixture.repository.findForUpdateById(fixture.order.id))
                .thenReturn(Optional.of(fixture.order));

        fixture.service.releaseExpiredReservations();

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(fixture.order.reservationExpiresAt).isNull();
        verify(fixture.warehouse).releaseOrderReservations(fixture.order);
        verify(fixture.repository).save(fixture.order);
        verify(fixture.audit)
                .record(
                        eq("RESERVATION_EXPIRED"),
                        eq("ORDER"),
                        eq(fixture.order.id),
                        contains("Автоматически снял резерв"));
    }

    @Test
    void cancellingCompletedOrderReturnsTheRecordedSaleToWarehouse() {
        Fixture fixture = new Fixture();
        fixture.order.status = OrderStatus.COMPLETED;

        fixture.service.updateStatus(fixture.order.id, OrderStatus.CANCELLED, 17L);

        verify(fixture.warehouse).returnOrderSale(fixture.order, 17L);
        verify(fixture.warehouse).releaseOrderReservations(fixture.order);
        assertThat(fixture.order.status).isEqualTo(OrderStatus.CANCELLED);
    }

    @Test
    void reopeningCompletedOrderReversesSaleCreatesReservationAndRequiresNewPayment() {
        Fixture fixture = new Fixture();
        fixture.order.status = OrderStatus.COMPLETED;
        fixture.order.paymentStatus = PaymentStatus.PAID;
        fixture.order.paymentMethod = PaymentMethod.CASH;
        fixture.order.paidTotal = money("100.00");
        fixture.order.cashPaymentAmount = money("100.00");

        fixture.service.updateStatus(fixture.order.id, OrderStatus.PROCESSING, 17L);

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(fixture.order.paymentStatus).isEqualTo(PaymentStatus.PENDING);
        assertThat(fixture.order.paymentMethod).isEqualTo(PaymentMethod.ON_RECEIPT);
        assertThat(fixture.order.paidTotal).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(fixture.order.cashPaymentAmount).isNull();
        verify(fixture.warehouse).returnOrderSale(fixture.order, 17L);
        verify(fixture.warehouse).reserveOrder(fixture.order, true);
        assertThat(fixture.order.reservationExpiresAt).isAfter(Instant.now());
    }

    @Test
    void reopeningOrderReleasedWithShortageReservesOnlyAvailableStock() {
        Fixture fixture = new Fixture();
        fixture.order.status = OrderStatus.COMPLETED;
        fixture.order.paymentStatus = PaymentStatus.PAID;
        fixture.order.paymentMethod = PaymentMethod.CASH;
        fixture.first.stockShortageQuantity = BigDecimal.ONE;

        fixture.service.updateStatus(fixture.order.id, OrderStatus.PROCESSING, 17L);

        verify(fixture.warehouse).returnOrderSale(fixture.order, 17L);
        verify(fixture.warehouse).reserveOrder(fixture.order, true);
        assertThat(fixture.order.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(fixture.order.reservationExpiresAt).isAfter(Instant.now());
    }

    @Test
    void reopeningCompletedBalanceOrderRefundsWalletBeforeRequestingNewPayment() {
        Fixture fixture = new Fixture();
        fixture.order.status = OrderStatus.COMPLETED;
        fixture.order.paymentStatus = PaymentStatus.PAID;
        fixture.order.paymentMethod = PaymentMethod.BALANCE;
        fixture.order.paidTotal = money("100.00");

        fixture.service.updateStatus(fixture.order.id, OrderStatus.NEW, 17L);

        verify(fixture.wallets)
                .refund(
                        any(),
                        argThat(amount -> amount.compareTo(money("100.00")) == 0),
                        eq(fixture.order.id),
                        any(),
                        eq(17L));
        assertThat(fixture.order.paymentStatus).isEqualTo(PaymentStatus.PENDING);
        assertThat(fixture.order.paidTotal).isEqualByComparingTo(BigDecimal.ZERO);
        verify(fixture.warehouse).returnOrderSale(fixture.order, 17L);
        verify(fixture.warehouse, never()).reserveOrder(fixture.order);
    }

    @Test
    void editingReopenedOrderWithoutShortageMarkersReservesOnlyAvailableStock() {
        Fixture fixture = new Fixture();
        fixture.order.status = OrderStatus.PROCESSING;
        fixture.order.paymentStatus = PaymentStatus.PENDING;
        fixture.order.reservationExpiresAt = Instant.now().plusSeconds(3600);
        when(fixture.warehouse.hasRecordedOrderSale(fixture.order)).thenReturn(true);

        fixture.service.updateItemQuantity(fixture.order.id, fixture.first.id,
                new OrderItemQuantityUpdateRequest(new BigDecimal("3")), 17L);

        assertThat(fixture.first.quantity).isEqualByComparingTo("3");
        verify(fixture.warehouse).reserveOrder(fixture.order, true);
        verify(fixture.warehouse, never()).reserveOrder(fixture.order);
    }

    @Test
    void statusEndpointCannotMovePriceReviewOrderBackToWork() {
        Fixture fixture = new Fixture();
        fixture.moveToPriceReview("130.00");

        assertThatThrownBy(
                        () ->
                                fixture.service.updateStatus(
                                        fixture.order.id, OrderStatus.PROCESSING, 1L))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("подтвердить");

        assertThat(fixture.order.status).isEqualTo(OrderStatus.PRICE_REVIEW);
        verify(fixture.repository, never()).save(any(Order.class));
    }

    @Test
    void softDeleteKeepsOrderInStorageAndRecordsAuditEvent() {
        Fixture fixture = new Fixture();
        when(fixture.repository.findForUpdateById(fixture.order.id))
                .thenReturn(Optional.of(fixture.order));

        fixture.service.softDelete(fixture.order.id, 1L);

        assertThat(fixture.order.deletedAt).isNotNull();
        verify(fixture.warehouse).releaseOrderReservations(fixture.order);
        verify(fixture.warehouse).softDeleteOrderDocuments(fixture.order, 1L);
        verify(fixture.repository).save(fixture.order);
        verify(fixture.audit)
                .record(
                        eq("SOFT_DELETE"),
                        eq("ORDER"),
                        eq(fixture.order.id),
                        contains("Удалил заказ"));
    }

    @Test
    void deletingLineOnlyReducesItsReservation() {
        Fixture fixture = new Fixture();
        fixture.order.reservationExpiresAt = Instant.now().plusSeconds(3600);

        fixture.service.deleteItem(fixture.order.id, fixture.first.id, 1L);

        assertThat(fixture.order.items).containsExactly(fixture.second);
        assertThat(fixture.order.total).isEqualByComparingTo("80");
        verify(fixture.warehouse).reduceOrderReservations(fixture.order, fixture.first.productId);
        verify(fixture.warehouse, never()).reserveOrder(any());
        verify(fixture.warehouse, never()).reserveOrder(any(), anyBoolean());
    }

    @Test
    void decreasingOrKeepingQuantityOnlyReducesItsReservation() {
        Fixture fixture = new Fixture();
        fixture.order.reservationExpiresAt = Instant.now().plusSeconds(3600);

        fixture.service.updateItemQuantity(fixture.order.id, fixture.first.id,
                new OrderItemQuantityUpdateRequest(BigDecimal.ONE), 1L);
        fixture.service.updateItemQuantity(fixture.order.id, fixture.first.id,
                new OrderItemQuantityUpdateRequest(new BigDecimal("1.000")), 1L);

        verify(fixture.warehouse, times(2))
                .reduceOrderReservations(fixture.order, fixture.first.productId);
        verify(fixture.warehouse, never()).reserveOrder(any());
        verify(fixture.warehouse, never()).reserveOrder(any(), anyBoolean());
    }

    @Test
    void deletingLineWithExpiredReservationReleasesAllHeldStock() {
        Fixture fixture = new Fixture();
        fixture.order.reservationExpiresAt = Instant.now().minusSeconds(1);

        fixture.service.deleteItem(fixture.order.id, fixture.first.id, 1L);

        assertThat(fixture.order.reservationExpiresAt).isNull();
        verify(fixture.warehouse).releaseOrderReservations(fixture.order);
        verify(fixture.warehouse, never()).reduceOrderReservations(any(), any());
        verify(fixture.warehouse, never()).reserveOrder(any());
    }

    @Test
    void deletingLineWithoutReservationDoesNotCreateOne() {
        Fixture fixture = new Fixture();

        fixture.service.deleteItem(fixture.order.id, fixture.first.id, 1L);

        verify(fixture.warehouse).detachAutomaticReturnLines(fixture.order, fixture.first.id);
        verify(fixture.warehouse, never()).reduceOrderReservations(any(), any());
        verify(fixture.warehouse, never()).reserveOrder(any());
        verify(fixture.warehouse, never()).reserveOrder(any(), anyBoolean());
        verify(fixture.warehouse, never()).releaseOrderReservations(any());
    }

    @Test
    void deletingLastLineRemainsForbidden() {
        Fixture fixture = new Fixture();
        fixture.order.items.remove(fixture.second);

        assertThatThrownBy(() -> fixture.service.deleteItem(fixture.order.id, fixture.first.id, 1L))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Нельзя удалить последнюю позицию");
        verifyNoInteractions(fixture.warehouse);
    }

    @Test
    void updateItemQuantityAcceptsQuantityBelowOneAndRecalculatesTotal() {
        Fixture fixture = new Fixture();

        fixture.service.updateItemQuantity(
                fixture.order.id,
                fixture.first.id,
                new OrderItemQuantityUpdateRequest(new BigDecimal("0.100")),
                1L);

        assertThat(fixture.first.quantity).isEqualByComparingTo("0.1");
        assertThat(fixture.first.lineTotal).isEqualByComparingTo("1.00");
        assertThat(fixture.order.total).isEqualByComparingTo("81.00");
    }

    @Test
    void updateItemOrderPersistsRequestedOrderForInvoiceAndOrderScreen() {
        Fixture fixture = new Fixture();

        var updated =
                fixture.service.updateItemOrder(
                        fixture.order.id,
                        new OrderItemOrderUpdateRequest(List.of(fixture.second.id, fixture.first.id)),
                        1L);

        assertThat(updated.items()).extracting(item -> item.id()).containsExactly(102L, 101L);
        assertThat(fixture.second.sortOrder).isZero();
        assertThat(fixture.first.sortOrder).isEqualTo(1);
        verify(fixture.audit)
                .record(
                        eq("ORDER_ITEM_ORDER_UPDATE"),
                        eq("ORDER"),
                        eq(fixture.order.id),
                        contains("Изменил порядок"));
    }

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    private static CartItem cartItem(Long id, Long productId, int quantity) {
        CartItem item = new CartItem();
        item.id = id;
        item.userId = 7L;
        item.productId = productId;
        item.quantity = quantity;
        return item;
    }

    private static Product product(Long id, String name) {
        Product product = new Product();
        product.id = id;
        product.sku = "SKU-" + id;
        product.nameRu = name;
        product.active = true;
        return product;
    }

    private static final class Fixture {
        private final OrderRepository repository = mock(OrderRepository.class);
        private final UserService users = mock(UserService.class);
        private final AuditService audit = mock(AuditService.class);
        private final NotificationService notifications = mock(NotificationService.class);
        private final WalletService wallets = mock(WalletService.class);
        private final WarehouseService warehouse = mock(WarehouseService.class);
        private final OrderService service =
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
        private final Order order = new Order();
        private final OrderItem first = item(101L, "10.00", 2);
        private final OrderItem second = item(102L, "40.00", 2);
        private final User user = new User();

        private Fixture() {
            order.id = UUID.fromString("00000000-0000-7000-8000-000000000015");
            order.orderNumberDate = LocalDate.of(2026, 8, 3);
            order.dailyNumber = 15;
            order.userId = 8L;
            order.status = OrderStatus.NEW;
            order.paymentStatus = PaymentStatus.PAID;
            order.total = money("100.00");
            order.paidTotal = money("100.00");
            first.order = order;
            second.order = order;
            first.sortOrder = 0;
            second.sortOrder = 1;
            order.items.add(first);
            order.items.add(second);
            user.id = 8L;
            user.name = "Клиент";
            user.email = "client@example.com";
            Wallet wallet = new Wallet();
            wallet.id = 77L;
            wallet.userId = 8L;
            wallet.balance = money("500.00");
            when(repository.findWithItemsById(order.id)).thenReturn(Optional.of(order));
            when(repository.save(any(Order.class)))
                    .thenAnswer(invocation -> invocation.getArgument(0));
            when(users.byId(8L)).thenReturn(user);
            when(wallets.locked(8L)).thenReturn(wallet);
        }

        private void moveToPriceReview(String total) {
            order.status = OrderStatus.PRICE_REVIEW;
            order.total = money(total);
            first.unitPrice =
                    money("130.00").compareTo(order.total) == 0 ? money("15.00") : money("10.00");
            first.lineTotal = first.unitPrice.multiply(first.quantity);
            second.unitPrice =
                    money("130.00").compareTo(order.total) == 0 ? money("50.00") : money("30.00");
            second.lineTotal = second.unitPrice.multiply(second.quantity);
        }

        private static OrderItem item(Long id, String unitPrice, int quantity) {
            OrderItem item = new OrderItem();
            item.id = id;
            item.productId = id + 1000;
            item.sku = "SKU-" + id;
            item.nameRu = "Товар " + id;
            item.unitPrice = money(unitPrice);
            item.confirmedUnitPrice = item.unitPrice;
            item.quantity = BigDecimal.valueOf(quantity);
            item.lineTotal = item.unitPrice.multiply(item.quantity);
            item.confirmedLineTotal = item.lineTotal;
            return item;
        }
    }
}
