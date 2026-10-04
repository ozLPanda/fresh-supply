package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.dto.OrderItemQuantityUpdateRequest;
import kz.company.shop.orders.dto.OrderManualItemCreateRequest;
import kz.company.shop.orders.dto.OrderCatalogItemCreateRequest;
import kz.company.shop.orders.entity.*;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.entity.StockDocument;
import kz.company.shop.warehouse.entity.StockMovement;
import kz.company.shop.warehouse.entity.StockReservation;
import kz.company.shop.warehouse.entity.StockReservationStatus;
import kz.company.shop.warehouse.repository.StockReservationRepository;
import kz.company.shop.warehouse.repository.StockMovementRepository;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.WarehouseRepository;
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/** Real order, reservation and FIFO ledger; every fixture is rolled back. */
@SpringBootTest
@Transactional
class OrderShortageReopeningIntegrationTest {
    @Autowired private OrderService orders;
    @Autowired private OrderRepository repository;
    @Autowired private ProductRepository products;
    @Autowired private WarehouseService warehouse;
    @Autowired private WarehouseRepository warehouses;
    @Autowired private StockMovementRepository movements;
    @Autowired private EntityManager entityManager;
    @Autowired private UserRepository users;
    @Autowired private StockDocumentLineRepository documentLines;
    @Autowired private StockReservationRepository reservations;

    @Test
    void deletingCatalogLinePreservesOtherProductsPartialReservation() {
        Order order = fixture();
        Product removable = stockedProduct(order.createdByUserId);
        orders.addCatalogItem(order.id,
                new OrderCatalogItemCreateRequest(removable.id, BigDecimal.ONE), null);
        orders.ensureDefaultReservation(order, true);
        repository.saveAndFlush(order);
        reload();
        order = repository.findWithItemsById(order.id).orElseThrow();
        StockReservation partial = activeReservation(order, order.items.getFirst().productId);
        UUID reservationId = partial.id;
        var createdAt = partial.createdAt;
        Long removableItemId = order.items.stream()
                .filter(item -> removable.id.equals(item.productId)).findFirst().orElseThrow().id;

        orders.deleteItem(order.id, removableItemId, null);
        reload();

        Order saved = repository.findWithItemsById(order.id).orElseThrow();
        assertThat(saved.items).hasSize(1);
        assertThat(saved.total).isEqualByComparingTo("500");
        StockReservation kept = activeReservation(saved, saved.items.getFirst().productId);
        assertThat(kept.id).isEqualTo(reservationId);
        assertThat(kept.createdAt).isEqualTo(createdAt);
        assertThat(kept.quantity).isEqualByComparingTo("2");
        assertThat(reservations.findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE))
                .hasSize(1);
        assertBalance(saved, "2");
    }

    @Test
    void decreasingQuantityWithExistingShortageOnlyShrinksHeldStock() {
        Order order = fixture();
        orders.ensureDefaultReservation(order, true);
        repository.saveAndFlush(order);
        reload();
        order = repository.findWithItemsById(order.id).orElseThrow();
        StockReservation partial = activeReservation(order, order.items.getFirst().productId);
        UUID reservationId = partial.id;
        var createdAt = partial.createdAt;
        Long itemId = order.items.getFirst().id;

        orders.updateItemQuantity(order.id, itemId,
                new OrderItemQuantityUpdateRequest(new BigDecimal("4")), null);
        reload();
        assertThat(reservations.findById(reservationId).orElseThrow().quantity)
                .isEqualByComparingTo("2");

        orders.updateItemQuantity(order.id, itemId,
                new OrderItemQuantityUpdateRequest(BigDecimal.ONE), null);
        reload();
        StockReservation kept = reservations.findById(reservationId).orElseThrow();
        assertThat(kept.quantity).isEqualByComparingTo("1");
        assertThat(kept.createdAt).isEqualTo(createdAt);
        assertThat(kept.status).isEqualTo(StockReservationStatus.ACTIVE);
        assertThat(repository.findWithItemsById(order.id).orElseThrow().total)
                .isEqualByComparingTo("100");
        assertBalance(order, "2");
    }

    @Test
    void deletingLastCatalogLineReleasesReservationWhenManualLineRemains() {
        Order order = fixture();
        orders.addManualItem(order.id,
                new OrderManualItemCreateRequest("Ручная позиция", new BigDecimal("10"),
                        BigDecimal.ONE), null);
        orders.ensureDefaultReservation(order, true);
        repository.saveAndFlush(order);
        UUID reservationId = activeReservation(order, order.items.getFirst().productId).id;

        orders.deleteItem(order.id, order.items.getFirst().id, null);
        reload();

        assertThat(reservations.findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE))
                .isEmpty();
        StockReservation released = reservations.findById(reservationId).orElseThrow();
        assertThat(released.status).isEqualTo(StockReservationStatus.RELEASED);
        assertThat(released.releasedAt).isNotNull();
        assertThat(released.quantity).isEqualByComparingTo("2");
    }

    @Test
    void increasingQuantityStillRejectsUnacceptedShortage() {
        Order order = fixture();
        orders.ensureDefaultReservation(order, true);
        repository.saveAndFlush(order);

        assertThatThrownBy(() -> orders.updateItemQuantity(order.id, order.items.getFirst().id,
                new OrderItemQuantityUpdateRequest(new BigDecimal("6")), null))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Недостаточно товара");
    }

    @Test
    void addingCatalogProductStillRejectsUnacceptedShortage() {
        Order order = fixture();
        orders.ensureDefaultReservation(order, true);
        repository.saveAndFlush(order);
        Product added = stockedProduct(order.createdByUserId);

        assertThatThrownBy(() -> orders.addCatalogItem(order.id,
                new OrderCatalogItemCreateRequest(added.id, BigDecimal.ONE), null))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Недостаточно товара");
    }

    @Test
    void partiallyReservedOrderStillRequiresShortageApprovalAtCompletion() {
        Order order = fixture();
        orders.ensureDefaultReservation(order, true);
        repository.saveAndFlush(order);

        assertThatThrownBy(() -> complete(order, false))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Недостаточно товара");
    }

    private StockReservation activeReservation(Order order, Long productId) {
        return reservations.findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE)
                .stream().filter(reservation -> productId.equals(reservation.productId))
                .findFirst().orElseThrow();
    }

    @Test
    void shortageOrderCanBeReopenedEditedAndCompletedRepeatedly() {
        Order order = fixture();
        complete(order, true);
        assertBalance(order, "-3");

        orders.updateStatus(order.id, OrderStatus.PROCESSING, null);
        reload();
        order = repository.findWithItemsById(order.id).orElseThrow();
        assertThat(order.paymentStatus).isEqualTo(PaymentStatus.PENDING);
        assertThat(order.reservationExpiresAt).isNotNull();
        assertBalance(order, "2");

        orders.updateItemQuantity(order.id, order.items.getFirst().id,
                new OrderItemQuantityUpdateRequest(new BigDecimal("7")), null);
        complete(order, true);
        reload();
        order = repository.findWithItemsById(order.id).orElseThrow();
        assertThat(order.items.getFirst().stockShortageQuantity).isEqualByComparingTo("5");
        assertBalance(order, "-5");

        orders.updateStatus(order.id, OrderStatus.PROCESSING, null);
        assertBalance(order, "2");
        orders.updateItemQuantity(order.id, order.items.getFirst().id,
                new OrderItemQuantityUpdateRequest(BigDecimal.ONE), null);
        complete(order, false);
        reload();
        order = repository.findWithItemsById(order.id).orElseThrow();
        assertThat(order.status).isEqualTo(OrderStatus.COMPLETED);
        assertThat(order.items.getFirst().stockShortageQuantity).isEqualByComparingTo("0");
        assertBalance(order, "1");
    }

    @Test
    void reopeningWithoutLineMarkersAllowsEditingButDoesNotAuthorizeNormalShortageSale() {
        Order order = fixture();
        complete(order, true);
        // Legacy/reconciled sales can have a ledger shortage without a current line marker.
        order.items.getFirst().stockShortageQuantity = BigDecimal.ZERO;
        repository.saveAndFlush(order);

        orders.updateStatus(order.id, OrderStatus.PROCESSING, null);
        orders.updateItemQuantity(order.id, order.items.getFirst().id,
                new OrderItemQuantityUpdateRequest(new BigDecimal("8")), null);
        assertBalance(order, "2");
        assertThatThrownBy(() -> complete(order, false))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Недостаточно товара");
    }

    @Test
    void reopeningAllowsDeletingPreviouslyReleasedLineWithoutBreakingReturnHistory() {
        Order order = fixture();
        Long productId = order.items.getFirst().productId;
        Long itemId = order.items.getFirst().id;
        orders.addManualItem(order.id,
                new OrderManualItemCreateRequest("Дополнительная ручная позиция",
                        new BigDecimal("10"), BigDecimal.ONE), order.createdByUserId);
        complete(order, true);
        orders.updateStatus(order.id, OrderStatus.PROCESSING, order.createdByUserId);

        orders.deleteItem(order.id, itemId, order.createdByUserId);
        reload();
        order = repository.findWithItemsById(order.id).orElseThrow();
        assertThat(order.items).hasSize(1);
        assertThat(order.items.getFirst().productId).isNull();
        assertThat(documentLines.findBySourceOrderItemId(itemId)).isEmpty();

        complete(order, false);
        entityManager.flush();
        Long warehouseId = warehouses.findByCodeAndActiveTrue("MAIN").orElseThrow().id;
        assertThat(movements.balanceByProductId(warehouseId, productId)).isEqualByComparingTo("2");
    }

    @Test
    void fullyManuallyReturnedOrderPostsEditedRemainderAcrossRepeatedReopening() {
        Order order = fixture();
        complete(order, true);
        User user = users.findById(order.createdByUserId).orElseThrow();
        CurrentUser actor = new CurrentUser(user.id, user.email, user.name, null,
                Set.of(), true, BigDecimal.ZERO);
        Long warehouseId = warehouses.findByCodeAndActiveTrue("MAIN").orElseThrow().id;
        // A return must follow the sale even when both are created within the same minute.
        var returnMoment = movements.findLedgerHistory(warehouseId,
                        order.items.getFirst().productId).stream()
                .filter(row -> ((StockDocument) row[1]).documentType == StockDocumentType.SALE)
                .map(row -> ((StockMovement) row[0]).occurredAt)
                .max(java.util.Comparator.naturalOrder()).orElseThrow()
                .plusMillis(1).atZone(ZoneId.of("Asia/Almaty"));
        var customerReturn = warehouse.createDraft(new WarehouseDto.DocumentRequest(
                StockDocumentType.CUSTOMER_RETURN, null, warehouseId, order.id, null,
                "Ручной возврат интеграционного теста", returnMoment.toLocalDate(),
                returnMoment.toLocalTime(),
                List.of(new WarehouseDto.DocumentLineRequest(order.items.getFirst().productId,
                        new BigDecimal("5"), null, order.items.getFirst().id, null, null, null)),
                null, null, null, null, null, null), actor, true);
        warehouse.post(customerReturn.id(), actor, true);
        assertBalance(order, "2");

        orders.updateStatus(order.id, OrderStatus.PROCESSING, actor.id());
        orders.updateItemQuantity(order.id, order.items.getFirst().id,
                new OrderItemQuantityUpdateRequest(new BigDecimal("8")), actor.id());
        complete(order, true);
        assertBalance(order, "-1");

        orders.updateStatus(order.id, OrderStatus.PROCESSING, actor.id());
        assertBalance(order, "2");
        orders.updateItemQuantity(order.id, order.items.getFirst().id,
                new OrderItemQuantityUpdateRequest(new BigDecimal("9")), actor.id());
        complete(order, true);
        assertBalance(order, "-2");
        reload();
        assertThat(warehouse.getDocument(customerReturn.id(), true).status())
                .isEqualTo(kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED);
    }

    private Order fixture() {
        User user = new User();
        user.name = "Order reopening integration test";
        user.email = UUID.randomUUID() + "@example.test";
        user.passwordHash = "not-a-login-password";
        users.saveAndFlush(user);
        Product product = stockedProduct(user.id);

        Order order = new Order();
        order.id = UUID.randomUUID();
        order.createdByUserId = user.id;
        order.orderNumberDate = LocalDate.of(2098, 10, 2);
        order.dailyNumber = Math.abs((long) order.id.hashCode()) + 1;
        order.status = OrderStatus.PROCESSING;
        order.paymentStatus = PaymentStatus.PENDING;
        order.paymentMethod = PaymentMethod.ON_RECEIPT;
        order.fulfillmentType = FulfillmentType.PICKUP;
        order.contactPhone = "+77000000000";
        order.total = new BigDecimal("500");
        order.paidTotal = BigDecimal.ZERO;
        OrderItem item = new OrderItem();
        item.order = order;
        item.productId = product.id;
        item.sku = product.sku;
        item.nameRu = product.nameRu;
        item.quantity = new BigDecimal("5");
        item.unitPrice = product.price;
        item.confirmedUnitPrice = product.price;
        item.lineTotal = order.total;
        item.confirmedLineTotal = order.total;
        order.items.add(item);
        return repository.saveAndFlush(order);
    }

    private Product stockedProduct(Long actorUserId) {
        Product product = new Product();
        product.sku = "REOPEN-IT-" + UUID.randomUUID();
        product.nameRu = "Товар теста повторного завершения";
        product.nameKk = product.nameRu;
        product.price = new BigDecimal("100");
        products.saveAndFlush(product);
        User user = users.findById(actorUserId).orElseThrow();
        CurrentUser actor = new CurrentUser(user.id, user.email, user.name, null,
                Set.of(), true, BigDecimal.ZERO);
        Long warehouseId = warehouses.findByCodeAndActiveTrue("MAIN").orElseThrow().id;
        var opening = warehouse.createDraft(new WarehouseDto.DocumentRequest(
                StockDocumentType.OPENING_BALANCE, null, warehouseId, null, null, null,
                null, null, List.of(new WarehouseDto.DocumentLineRequest(product.id,
                        new BigDecimal("2"), new BigDecimal("10"), null, null, null, null)),
                null, null, null, null, null, null), actor, true);
        warehouse.post(opening.id(), actor, true);
        return product;
    }

    private void complete(Order order, boolean shortage) {
        orders.completePayment(order.id, order.createdByUserId, PaymentMethod.CASH, null, null, null,
                null, null, null, null, shortage, "Повторное подтверждение расхождения");
    }

    private void assertBalance(Order order, String expected) {
        entityManager.flush();
        Long warehouseId = warehouses.findByCodeAndActiveTrue("MAIN").orElseThrow().id;
        assertThat(movements.balanceByProductId(warehouseId, order.items.getFirst().productId))
                .isEqualByComparingTo(expected);
    }

    private void reload() {
        entityManager.flush();
        entityManager.clear();
    }
}
