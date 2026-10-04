package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.repository.OrderItemRepository;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.ai.AiPriceSessionRepository;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.*;
import kz.company.shop.warehouse.repository.*;
import org.junit.jupiter.api.Test;

class WarehouseServiceTest {
    @Test
    void priceSettingDraftReceivesNumberBeforePosting() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        WarehouseService service = serviceWithReplay(
                warehouses, documents, mock(StockDocumentVersionRepository.class), lines,
                mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
                mock(StockReservationRepository.class), mock(ProductRepository.class),
                mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        CurrentUser admin = new CurrentUser(7L, "admin@example.test", "Администратор",
                null, Set.of(), true, BigDecimal.ZERO);
        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(documents.nextDocumentNumber()).thenReturn(107L);
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenReturn(List.of());

        WarehouseDto.Document draft = service.createDraft(new WarehouseDto.DocumentRequest(
                StockDocumentType.PRICE_SETTING, StockDocumentPriceType.RETAIL, null, null,
                null, null, null, null, List.of(), null, null, null, null, null, null), admin, true);

        assertThat(draft.status()).isEqualTo(StockDocumentStatus.DRAFT);
        assertThat(draft.documentNumber()).isEqualTo("СКЛ-107");
        var saved = org.mockito.ArgumentCaptor.forClass(StockDocument.class);
        verify(documents).save(saved.capture());
        assertThat(saved.getValue().documentNumber).isEqualTo(draft.documentNumber());
    }

    @Test
    void saleDocumentExposesCurrentMovementsAsImportableLinesWithoutLeakingCosts() {
        UUID saleId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        StockDocument sale = draft(saleId, StockDocumentType.SALE, 1L);
        sale.sourceOrderId = orderId;
        sale.status = StockDocumentStatus.POSTED;

        StockMovement sold = new StockMovement();
        sold.id = UUID.randomUUID();
        sold.documentId = saleId;
        sold.productId = 42L;
        sold.quantity = new BigDecimal("-3.000");
        sold.unitCost = new BigDecimal("65.500000");
        sold.movementType = "SALE";
        sold.createdAt = Instant.parse("2026-09-29T08:00:00Z");

        StockMovement reversed = new StockMovement();
        reversed.id = UUID.randomUUID();
        reversed.documentId = saleId;
        reversed.productId = 99L;
        reversed.quantity = new BigDecimal("-1.000");
        reversed.movementType = "SALE";
        reversed.createdAt = Instant.parse("2026-09-29T08:01:00Z");
        StockMovement reversal = new StockMovement();
        reversal.id = UUID.randomUUID();
        reversal.documentId = saleId;
        reversal.productId = 99L;
        reversal.quantity = BigDecimal.ONE;
        reversal.movementType = "CANCEL_SALE";
        reversal.reversesMovementId = reversed.id;

        Order order = new Order();
        order.id = orderId;
        OrderItem first = new OrderItem();
        first.productId = 42L;
        first.quantity = new BigDecimal("2.000");
        first.confirmedUnitPrice = new BigDecimal("100.00");
        OrderItem second = new OrderItem();
        second.productId = 42L;
        second.quantity = new BigDecimal("1.000");
        second.confirmedUnitPrice = new BigDecimal("130.00");
        order.items = new ArrayList<>(List.of(first, second));

        Product product = new Product();
        product.id = 42L;
        product.sku = "SKU-42";
        product.nameRu = "Товар";
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        OrderRepository orders = mock(OrderRepository.class);
        WarehouseService service = new WarehouseService(
                mock(WarehouseRepository.class), documents, mock(StockDocumentVersionRepository.class),
                lines, mock(PriceSettingGroupRepository.class), mock(WarehouseCounterpartyRepository.class),
                movements, mock(StockCostLayerRepository.class), mock(StockReservationRepository.class),
                products, orders, mock(OrderItemRepository.class), mock(UserRepository.class),
                mock(AiPriceSessionRepository.class));
        when(documents.findById(saleId)).thenReturn(Optional.of(sale));
        when(lines.findByDocumentIdOrderById(saleId)).thenReturn(List.of());
        when(movements.findByDocumentId(saleId)).thenReturn(List.of(sold, reversed, reversal));
        when(orders.findById(orderId)).thenReturn(Optional.of(order));
        when(products.findByIdInAndDeletedAtIsNull(anySet())).thenReturn(List.of(product));

        WarehouseDto.DocumentLine withCosts = service.getDocument(saleId, true).lines().getFirst();
        assertThat(service.getDocument(saleId, true).lines()).hasSize(1);
        assertThat(withCosts.productId()).isEqualTo(42L);
        assertThat(withCosts.quantity()).isEqualByComparingTo("3.000");
        assertThat(withCosts.unitPrice()).isEqualByComparingTo("110.00");
        assertThat(withCosts.unitCost()).isEqualByComparingTo("65.500000");
        assertThat(service.getDocument(saleId, false).lines().getFirst().unitCost()).isNull();

        second.confirmedUnitPrice = null;
        assertThat(service.getDocument(saleId, true).lines().getFirst().unitPrice()).isNull();
    }

    @Test
    void listsNewPriceGroupBeforeAnyDocumentsOrAiSessionsExist() {
        UUID groupId = UUID.randomUUID();
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = groupId;
        group.name = "Новая группа";
        PriceSettingGroupRepository groups = mock(PriceSettingGroupRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        WarehouseService service = new WarehouseService(
                mock(WarehouseRepository.class), documents, mock(StockDocumentVersionRepository.class),
                mock(StockDocumentLineRepository.class), groups, mock(WarehouseCounterpartyRepository.class),
                mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
                mock(StockReservationRepository.class), mock(ProductRepository.class),
                mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class),
                mock(AiPriceSessionRepository.class));
        when(groups.findAllByOrderByUpdatedAtDesc()).thenReturn(List.of(group));

        assertThat(service.listPriceSettingGroups()).extracting(WarehouseDto.PriceSettingGroup::id)
                .containsExactly(groupId);
        verify(groups, never()).deleteAll(anyList());
    }

    @Test
    void keepsEmptyPriceGroupReferencedByAiSession() {
        UUID groupId = UUID.randomUUID();
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = groupId;
        group.name = "Группа ИИ";
        PriceSettingGroupRepository groups = mock(PriceSettingGroupRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        AiPriceSessionRepository aiSessions = mock(AiPriceSessionRepository.class);
        WarehouseService service = new WarehouseService(
                mock(WarehouseRepository.class), documents, mock(StockDocumentVersionRepository.class),
                mock(StockDocumentLineRepository.class), groups, mock(WarehouseCounterpartyRepository.class),
                mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
                mock(StockReservationRepository.class), mock(ProductRepository.class),
                mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class), aiSessions);
        when(groups.findAllByOrderByUpdatedAtDesc()).thenReturn(List.of(group));
        when(aiSessions.existsByGroupId(groupId)).thenReturn(true);

        assertThat(service.listPriceSettingGroups()).extracting(WarehouseDto.PriceSettingGroup::id)
                .containsExactly(groupId);
        verify(groups, never()).deleteAll(anyList());
    }

    @Test
    void deletingLastPriceSettingDocumentSoftDeletesUnboundGroup() {
        UUID groupId = UUID.randomUUID();
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.PRICE_SETTING, 1L);
        document.priceSettingGroupId = groupId;
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        PriceSettingGroupRepository groups = mock(PriceSettingGroupRepository.class);
        AiPriceSessionRepository aiSessions = mock(AiPriceSessionRepository.class);
        WarehouseService service = new WarehouseService(
                mock(WarehouseRepository.class), documents, mock(StockDocumentVersionRepository.class),
                mock(StockDocumentLineRepository.class), groups, mock(WarehouseCounterpartyRepository.class),
                mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
                mock(StockReservationRepository.class), mock(ProductRepository.class),
                mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class), aiSessions);
        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = groupId;
        when(groups.findActiveForUpdate(groupId)).thenReturn(Optional.of(group));
        CurrentUser actor = new CurrentUser(7L, "admin@example.test", "Администратор",
                null, Set.of(), true, BigDecimal.ZERO);

        service.softDelete(document.id, actor);

        assertThat(document.deletedAt).isNotNull();
        assertThat(group.deletedAt).isNotNull();
        assertThat(group.deletedByUserId).isEqualTo(actor.id());
        verify(groups, never()).deleteById(groupId);
    }

    @Test
    void receiptKeepsUnitCostCalculatedFromAnEnteredLineAmount() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service = serviceWithReplay(
                warehouses, documents, mock(StockDocumentVersionRepository.class), lines,
                mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
                mock(StockReservationRepository.class), products, mock(OrderRepository.class),
                mock(OrderItemRepository.class), mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        List<StockDocumentLine> savedLines = new ArrayList<>();
        CurrentUser admin = new CurrentUser(7L, "admin@example.test", "Администратор",
                null, Set.of(), true, BigDecimal.ZERO);

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(101L))).thenReturn(List.of(product));
        when(lines.save(any(StockDocumentLine.class))).thenAnswer(invocation -> {
            StockDocumentLine saved = invocation.getArgument(0);
            savedLines.add(saved);
            return saved;
        });
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenReturn(savedLines);

        WarehouseDto.Document result = service.createDraft(new WarehouseDto.DocumentRequest(
                StockDocumentType.RECEIPT, null, null, null, null, null, null, null,
                List.of(new WarehouseDto.DocumentLineRequest(
                        product.id, quantity("3.000"), money("33.333333"), null, null, null, null)),
                null, null, null, null, null, null), admin, true);

        assertThat(result.lines()).singleElement().satisfies(line -> {
            assertThat(line.unitCost()).isEqualByComparingTo("33.333333");
            assertThat(line.quantity().multiply(line.unitCost()).setScale(2,
                    java.math.RoundingMode.HALF_UP)).isEqualByComparingTo("100.00");
        });
    }

    @Test
    void receiptDraftKeepsAZeroQuantityLine() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service = serviceWithReplay(
                warehouses, mock(StockDocumentRepository.class), mock(StockDocumentVersionRepository.class),
                lines, mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
                mock(StockReservationRepository.class), products, mock(OrderRepository.class),
                mock(OrderItemRepository.class), mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        List<StockDocumentLine> savedLines = new ArrayList<>();
        CurrentUser admin = new CurrentUser(7L, "admin@example.test", "Администратор",
                null, Set.of(), true, BigDecimal.ZERO);

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(lines.save(any(StockDocumentLine.class))).thenAnswer(invocation -> {
            StockDocumentLine saved = invocation.getArgument(0);
            savedLines.add(saved);
            return saved;
        });
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenReturn(savedLines);

        WarehouseDto.Document result = service.createDraft(new WarehouseDto.DocumentRequest(
                StockDocumentType.RECEIPT, null, null, null, null, null, null, null,
                List.of(new WarehouseDto.DocumentLineRequest(
                        product.id, BigDecimal.ZERO, money("100.00"), null, null, null, null)),
                null, null, null, null, null, null), admin, true);

        assertThat(result.lines()).singleElement()
                .satisfies(line -> assertThat(line.quantity()).isEqualByComparingTo("0.000"));
    }

    @Test
    void cancelledReceiptCanBePostedAgainWithoutChangingItsNumber() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service = serviceWithReplay(
                warehouses, documents, mock(StockDocumentVersionRepository.class), lines, movements,
                layers, mock(StockReservationRepository.class), products, mock(OrderRepository.class),
                mock(OrderItemRepository.class), mock(UserRepository.class));
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.RECEIPT, 1L);
        document.status = StockDocumentStatus.CANCELLED;
        document.documentNumber = "СКЛ-83";
        document.cancelledAt = Instant.parse("2026-09-24T12:00:00Z");
        StockDocumentLine documentLine = line(document.id, 101L, "7.000", "100.00");
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        CurrentUser admin = new CurrentUser(7L, "admin@example.test", "Администратор",
                null, Set.of(), true, BigDecimal.ZERO);

        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        when(warehouses.findActiveForUpdateById(1L)).thenReturn(Optional.of(warehouse));
        when(lines.findByDocumentIdOrderById(document.id)).thenReturn(List.of(documentLine));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(101L))).thenReturn(List.of(product));

        service.post(document.id, admin, true);

        assertThat(document.status).isEqualTo(StockDocumentStatus.POSTED);
        assertThat(document.documentNumber).isEqualTo("СКЛ-83");
        verify(documents, never()).nextDocumentNumber();
        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().quantity).isEqualByComparingTo("7.000");
    }

    @Test
    void cancellingRepostedReceiptReversesOnlyTheLatestPosting() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        WarehouseService service = serviceWithReplay(
                warehouses, documents, mock(StockDocumentVersionRepository.class), lines, movements,
                layers, mock(StockReservationRepository.class), mock(ProductRepository.class),
                mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class));
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.RECEIPT, 1L);
        document.status = StockDocumentStatus.POSTED;
        document.documentNumber = "СКЛ-83";
        document.cancelledAt = Instant.parse("2026-09-24T12:00:00Z");
        StockMovement oldPosting = movement(document.id, 101L, "5.000");
        oldPosting.createdAt = document.cancelledAt.minusSeconds(60);
        StockMovement oldReversal = movement(document.id, 101L, "-5.000");
        oldReversal.createdAt = document.cancelledAt.minusSeconds(1);
        oldReversal.movementType = "CANCEL_RECEIPT";
        oldReversal.reversesMovementId = oldPosting.id;
        StockMovement currentPosting = movement(document.id, 101L, "7.000");
        currentPosting.createdAt = document.cancelledAt.plusSeconds(60);
        StockCostLayer oldLayer = new StockCostLayer();
        oldLayer.id = UUID.randomUUID();
        oldLayer.sourceMovementId = oldPosting.id;
        oldLayer.originalQuantity = quantity("5.000");
        oldLayer.remainingQuantity = BigDecimal.ZERO;
        oldLayer.createdAt = document.cancelledAt.minusSeconds(60);
        StockCostLayer currentLayer = new StockCostLayer();
        currentLayer.id = UUID.randomUUID();
        currentLayer.sourceMovementId = currentPosting.id;
        currentLayer.originalQuantity = quantity("7.000");
        currentLayer.remainingQuantity = quantity("7.000");
        currentLayer.createdAt = document.cancelledAt.plusSeconds(60);
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        CurrentUser admin = new CurrentUser(7L, "admin@example.test", "Администратор",
                null, Set.of(), true, BigDecimal.ZERO);

        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        when(warehouses.findActiveForUpdateById(1L)).thenReturn(Optional.of(warehouse));
        when(movements.findByDocumentId(document.id))
                .thenReturn(List.of(oldPosting, oldReversal, currentPosting));
        when(layers.findBySourceDocumentId(document.id)).thenReturn(List.of(oldLayer, currentLayer));
        when(layers.findByWarehouseIdAndProductId(1L, 101L)).thenReturn(List.of(oldLayer, currentLayer));
        when(movements.balanceByProductId(1L, 101L)).thenReturn(quantity("7.000"));
        when(lines.findByDocumentIdOrderById(document.id)).thenReturn(List.of());

        service.cancel(document.id, admin, false);

        assertThat(document.status).isEqualTo(StockDocumentStatus.CANCELLED);
        assertThat(oldLayer.remainingQuantity).isZero();
        assertThat(currentLayer.remainingQuantity).isZero();
        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().quantity).isEqualByComparingTo("-7.000");
        assertThat(movementCaptor.getValue().reversesMovementId).isEqualTo(currentPosting.id);
    }

    @Test
    void softDeleteOrderDocumentsKeepsAuditTrailAndExcludesEveryLinkedDocument() {
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        mock(WarehouseRepository.class),
                        documents,
                        versions,
                        lines,
                        mock(StockMovementRepository.class),
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        mock(ProductRepository.class),
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        Order order = new Order();
        order.id = UUID.randomUUID();
        StockDocument sale = new StockDocument();
        sale.id = UUID.randomUUID();
        StockDocument customerReturn = new StockDocument();
        customerReturn.id = UUID.randomUUID();
        when(documents.findActiveForUpdateBySourceOrderId(order.id))
                .thenReturn(List.of(sale, customerReturn));
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenReturn(List.of());
        when(versions.findTopByDocumentIdOrderByVersionNumberDesc(any(UUID.class)))
                .thenReturn(Optional.empty());

        service.softDeleteOrderDocuments(order, 17L);

        assertThat(sale.deletedAt).isNotNull();
        assertThat(customerReturn.deletedAt).isEqualTo(sale.deletedAt);
        assertThat(sale.deletedByUserId).isEqualTo(17L);
        assertThat(customerReturn.deletedByUserId).isEqualTo(17L);
        verify(documents).save(sale);
        verify(documents).save(customerReturn);
        verify(versions, times(2)).save(any(StockDocumentVersion.class));
    }

    @Test
    void acceptedOrderShortageReservesOnlyAvailableStockWithoutNegativeMovement() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockReservationRepository reservations = mock(StockReservationRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        mock(StockDocumentRepository.class),
                        mock(StockDocumentVersionRepository.class),
                        mock(StockDocumentLineRepository.class),
                        movements,
                        mock(StockCostLayerRepository.class),
                        reservations,
                        mock(ProductRepository.class),
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Order order = new Order();
        order.id = UUID.randomUUID();
        OrderItem item = new OrderItem();
        item.productId = 101L;
        item.quantity = quantity("5.000");
        order.items.add(item);

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(movements.existsActiveByWarehouseIdAndProductId(warehouse.id, item.productId))
                .thenReturn(true);
        when(movements.balanceByProductId(warehouse.id, item.productId))
                .thenReturn(quantity("2.000"));

        service.reserveOrder(order, true);

        var reservationCaptor = org.mockito.ArgumentCaptor.forClass(StockReservation.class);
        verify(reservations).save(reservationCaptor.capture());
        assertThat(reservationCaptor.getValue().quantity).isEqualByComparingTo("2.000");
        verify(movements, never()).save(any(StockMovement.class));
    }

    @Test
    void cancellingCompletedOrderCreatesPostedCustomerReturnFromSaleMovement() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        versions,
                        lines,
                        movements,
                        layers,
                        mock(StockReservationRepository.class),
                        mock(ProductRepository.class),
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));

        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        StockDocument sale = new StockDocument();
        sale.id = UUID.randomUUID();
        sale.documentType = StockDocumentType.SALE;
        sale.status = StockDocumentStatus.POSTED;
        sale.warehouseId = warehouse.id;
        StockMovement saleMovement = movement(sale.id, 101L, "-3.000");
        saleMovement.unitCost = money("70.00");
        Order order = new Order();
        order.id = UUID.randomUUID();
        order.orderNumberDate = java.time.LocalDate.of(2026, 9, 3);
        order.dailyNumber = 12;
        OrderItem item = new OrderItem();
        item.id = 501L;
        item.order = order;
        item.productId = 101L;
        item.quantity = quantity("3.000");
        item.unitPrice = money("120.00");
        item.confirmedUnitPrice = money("110.00");
        order.items.add(item);

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(documents.findBySourceOrderIdAndDocumentType(order.id, StockDocumentType.SALE))
                .thenReturn(Optional.of(sale));
        when(movements.findByDocumentId(sale.id)).thenReturn(List.of(saleMovement));
        when(movements.existsPostedOpeningBalanceByWarehouseIdAndProductId(warehouse.id, 101L))
                .thenReturn(true);
        when(lines.postedQuantityBySourceOrderItemIds(
                        eq(order.id), anySet(), eq(StockDocumentType.CUSTOMER_RETURN), eq(StockDocumentStatus.POSTED)))
                .thenReturn(List.of());
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(lines.save(any(StockDocumentLine.class))).thenAnswer(invocation -> {
            StockDocumentLine saved = invocation.getArgument(0);
            saved.id = 1L;
            return saved;
        });
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenAnswer(invocation ->
                savedEntities(lines, StockDocumentLine.class).stream()
                        .filter(saved -> saved.documentId.equals(invocation.getArgument(0))).toList());
        when(versions.findTopByDocumentIdOrderByVersionNumberDesc(any(UUID.class)))
                .thenReturn(Optional.empty());

        assertThat(service.returnOrderSale(order, 17L)).isTrue();

        var documentCaptor = org.mockito.ArgumentCaptor.forClass(StockDocument.class);
        verify(documents).save(documentCaptor.capture());
        assertThat(documentCaptor.getValue().documentType).isEqualTo(StockDocumentType.CUSTOMER_RETURN);
        assertThat(documentCaptor.getValue().status).isEqualTo(StockDocumentStatus.POSTED);
        assertThat(documentCaptor.getValue().sourceOrderId).isEqualTo(order.id);
        assertThat(documentCaptor.getValue().postedByUserId).isEqualTo(17L);
        var lineCaptor = org.mockito.ArgumentCaptor.forClass(StockDocumentLine.class);
        verify(lines).save(lineCaptor.capture());
        assertThat(lineCaptor.getValue().sourceOrderItemId).isEqualTo(item.id);
        assertThat(lineCaptor.getValue().quantity).isEqualByComparingTo("3.000");
        assertThat(lineCaptor.getValue().unitCost).isEqualByComparingTo("70.00");
        assertThat(lineCaptor.getValue().unitPrice).isEqualByComparingTo("110.00");
        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().quantity).isEqualByComparingTo("3.000");
        verify(layers).save(any(StockCostLayer.class));
    }

    @Test
    void completingReopenedOrderReversesItsAutomaticCustomerReturn() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        StockReservationRepository reservations = mock(StockReservationRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        versions,
                        lines,
                        movements,
                        layers,
                        reservations,
                        mock(ProductRepository.class),
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));

        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Order order = new Order();
        order.id = UUID.randomUUID();
        OrderItem item = new OrderItem();
        item.productId = 101L;
        item.quantity = quantity("3.000");
        order.items.add(item);
        StockDocument sale = new StockDocument();
        sale.id = UUID.randomUUID();
        StockDocument automaticReturn = new StockDocument();
        automaticReturn.id = UUID.randomUUID();
        automaticReturn.warehouseId = warehouse.id;
        automaticReturn.documentType = StockDocumentType.CUSTOMER_RETURN;
        automaticReturn.status = StockDocumentStatus.POSTED;
        automaticReturn.comment = "Автоматическое поступление при отмене заказа";
        StockMovement returnedMovement = movement(automaticReturn.id, 101L, "3.000");
        returnedMovement.movementType = StockDocumentType.CUSTOMER_RETURN.name();
        returnedMovement.unitCost = money("70.00");

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(documents.findBySourceOrderIdAndDocumentType(order.id, StockDocumentType.SALE))
                .thenReturn(Optional.of(sale));
        when(documents.findPostedCustomerReturnsBySourceOrderId(order.id))
                .thenReturn(List.of(automaticReturn));
        when(movements.findByDocumentId(automaticReturn.id)).thenReturn(List.of(returnedMovement));
        when(documents.findForUpdateById(automaticReturn.id)).thenReturn(Optional.of(automaticReturn));
        when(movements.balanceByProductId(warehouse.id, returnedMovement.productId))
                .thenReturn(quantity("3.000"));
        when(movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                        warehouse.id, returnedMovement.productId))
                .thenReturn(List.of());
        when(layers.findBySourceDocumentId(automaticReturn.id)).thenReturn(List.of());
        when(lines.findByDocumentIdOrderById(automaticReturn.id)).thenReturn(List.of());
        when(versions.findTopByDocumentIdOrderByVersionNumberDesc(automaticReturn.id))
                .thenReturn(Optional.empty());

        service.postOrderSale(order, 17L);

        assertThat(automaticReturn.status).isEqualTo(StockDocumentStatus.CANCELLED);
        assertThat(automaticReturn.cancelledByUserId).isEqualTo(17L);
        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().quantity).isEqualByComparingTo("-3.000");
        assertThat(movementCaptor.getValue().movementType).isEqualTo("CANCEL_CUSTOMER_RETURN");
    }

    @Test
    void reopenedShortageSaleUsesEditedQuantityAndOnlyCurrentSaleIsReturnedAgain() {
        ReopenedSaleFixture fixture = new ReopenedSaleFixture("2.000", "5.000", null);
        fixture.item.quantity = quantity("7.000");

        assertThatThrownBy(() -> fixture.service.postOrderSale(fixture.order, 17L))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Недостаточно товара на складе");
        assertThat(fixture.automaticReturn.status).isEqualTo(StockDocumentStatus.POSTED);
        assertThat(fixture.activeSaleQuantity(101L)).isEqualByComparingTo("5.000");

        fixture.service.postOrderSaleWithShortage(fixture.order, 17L, "Повторный отпуск");

        assertThat(fixture.balance(101L)).isEqualByComparingTo("-5.000");
        assertThat(fixture.activeSaleQuantity(101L)).isEqualByComparingTo("7.000");
        assertThat(fixture.item.stockShortageQuantity).isEqualByComparingTo("5.000");
        assertThat(fixture.item.stockShortageComment).isEqualTo("Повторный отпуск");
        assertThat(fixture.automaticReturn.status).isEqualTo(StockDocumentStatus.CANCELLED);
        int postingCount = fixture.movementStore.size();
        fixture.service.postOrderSale(fixture.order, 17L);
        assertThat(fixture.movementStore).hasSize(postingCount);

        assertThat(fixture.service.returnOrderSale(fixture.order, 17L)).isTrue();
        assertThat(fixture.balance(101L)).isEqualByComparingTo("2.000");
        assertThat(fixture.service.returnOrderSale(fixture.order, 17L)).isFalse();
        assertThat(fixture.balance(101L)).isEqualByComparingTo("2.000");
    }

    @Test
    void reopenedSaleReplacesRemovedProductWithTheCurrentOrderProduct() {
        ReopenedSaleFixture fixture = new ReopenedSaleFixture("10.000", "5.000", null);
        StockDocument opening = draft(UUID.randomUUID(), StockDocumentType.OPENING_BALANCE, 1L);
        opening.status = StockDocumentStatus.POSTED;
        fixture.documentStore.put(opening.id, opening);
        fixture.addMovement(opening, 202L, "4.000", "OPENING_BALANCE", 0);
        fixture.item.productId = 202L;
        fixture.item.quantity = quantity("2.000");

        fixture.service.postOrderSale(fixture.order, 17L);

        assertThat(fixture.activeSaleQuantity(101L)).isEqualByComparingTo("0.000");
        assertThat(fixture.activeSaleQuantity(202L)).isEqualByComparingTo("2.000");
        assertThat(fixture.balance(101L)).isEqualByComparingTo("10.000");
        assertThat(fixture.balance(202L)).isEqualByComparingTo("2.000");
        assertThat(fixture.item.stockShortageQuantity).isEqualByComparingTo("0.000");
    }

    @Test
    void repostingKeepsManualReturnAndItsHistoricalSourceSaleBeforeNewRelease() {
        ReopenedSaleFixture fixture = new ReopenedSaleFixture("10.000", "5.000", "1.000");
        fixture.item.quantity = quantity("7.000");
        StockMovement manualReturnMovement = fixture.movementStore.stream()
                .filter(movement -> movement.documentId.equals(fixture.manualReturn.id))
                .findFirst().orElseThrow();
        Instant originalSaleMoment = fixture.movementStore.stream()
                .filter(movement -> movement.documentId.equals(fixture.sale.id))
                .findFirst().orElseThrow().occurredAt;

        fixture.service.postOrderSale(fixture.order, 17L);

        assertThat(fixture.manualReturn.status).isEqualTo(StockDocumentStatus.POSTED);
        assertThat(fixture.manualReturn.cancelledAt).isNull();
        assertThat(fixture.balance(101L)).isEqualByComparingTo("4.000");
        assertThat(fixture.activeSaleQuantity(101L)).isEqualByComparingTo("7.000");
        assertThat(fixture.activeMovements().stream()
                .filter(movement -> movement.documentId.equals(fixture.sale.id)))
                .hasSize(2).anySatisfy(movement -> {
                    assertThat(movement.quantity).isEqualByComparingTo("-1.000");
                    assertThat(movement.occurredAt).isEqualTo(originalSaleMoment);
                    assertThat(movement.occurredAt).isBefore(manualReturnMovement.occurredAt);
                });
        assertThat(fixture.movementStore.stream()
                .filter(movement -> manualReturnMovement.id.equals(movement.reversesMovementId)))
                .isEmpty();
    }

    @Test
    void editedOrderCanBeCompletedAfterItsOriginalSaleWasFullyReturnedManually() {
        ReopenedSaleFixture fixture = new ReopenedSaleFixture("10.000", "5.000", "5.000");
        fixture.documentStore.remove(fixture.automaticReturn.id);
        fixture.movementStore.removeIf(movement ->
                movement.documentId.equals(fixture.automaticReturn.id));
        fixture.lineStore.removeIf(line -> line.documentId.equals(fixture.automaticReturn.id));
        fixture.item.quantity = quantity("7.000");

        fixture.service.postOrderSale(fixture.order, 17L, true);

        assertThat(fixture.manualReturn.status).isEqualTo(StockDocumentStatus.POSTED);
        assertThat(fixture.balance(101L)).isEqualByComparingTo("8.000");
        assertThat(fixture.activeSaleQuantity(101L)).isEqualByComparingTo("7.000");
    }

    @Test
    void deletingReopenedOrderItemDetachesItsAutomaticReturnHistory() {
        ReopenedSaleFixture fixture = new ReopenedSaleFixture("10.000", "5.000", null);
        when(fixture.lines.findBySourceOrderItemId(fixture.item.id)).thenReturn(fixture.lineStore);
        when(fixture.documents.findById(fixture.automaticReturn.id))
                .thenReturn(Optional.of(fixture.automaticReturn));

        fixture.service.detachAutomaticReturnLines(fixture.order, fixture.item.id);

        assertThat(fixture.lineStore).singleElement().satisfies(line -> {
            assertThat(line.sourceOrderItemId).isNull();
            assertThat(line.quantity).isEqualByComparingTo("5.000");
        });
        assertThat(fixture.balance(101L)).isEqualByComparingTo("10.000");
        verify(fixture.lines).flush();
    }

    @Test
    void deletingItemWithManualReturnRejectsBeforeDetachingAnyAutomaticLines() {
        ReopenedSaleFixture fixture = new ReopenedSaleFixture("10.000", "5.000", "1.000");
        List<StockDocumentLine> automaticFirst = new ArrayList<>(fixture.lineStore);
        Collections.reverse(automaticFirst);
        when(fixture.lines.findBySourceOrderItemId(fixture.item.id)).thenReturn(automaticFirst);
        when(fixture.documents.findById(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(fixture.documentStore.get(invocation.getArgument(0))));

        assertThatThrownBy(() -> fixture.service.detachAutomaticReturnLines(fixture.order, fixture.item.id))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("ручным возвратом");

        assertThat(fixture.lineStore).allSatisfy(line ->
                assertThat(line.sourceOrderItemId).isEqualTo(fixture.item.id));
        verify(fixture.lines, never()).flush();
    }

    @Test
    void cancellingOrderWithoutOpeningBalanceKeepsReturnButDoesNotIncreaseStock() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        mock(StockDocumentVersionRepository.class),
                        lines,
                        movements,
                        layers,
                        mock(StockReservationRepository.class),
                        mock(ProductRepository.class),
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        StockDocument sale = new StockDocument();
        sale.id = UUID.randomUUID();
        sale.documentType = StockDocumentType.SALE;
        sale.status = StockDocumentStatus.POSTED;
        StockMovement saleMovement = movement(sale.id, 101L, "-2.000");
        Order order = new Order();
        order.id = UUID.randomUUID();
        order.orderNumberDate = java.time.LocalDate.of(2026, 9, 7);
        order.dailyNumber = 13;
        OrderItem item = new OrderItem();
        item.id = 502L;
        item.order = order;
        item.productId = 101L;
        item.quantity = quantity("2.000");
        item.unitPrice = money("100.00");
        order.items.add(item);

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(documents.findBySourceOrderIdAndDocumentType(order.id, StockDocumentType.SALE))
                .thenReturn(Optional.of(sale));
        when(movements.findByDocumentId(sale.id)).thenReturn(List.of(saleMovement));
        when(lines.postedQuantityBySourceOrderItemIds(
                        eq(order.id),
                        anySet(),
                        eq(StockDocumentType.CUSTOMER_RETURN),
                        eq(StockDocumentStatus.POSTED)))
                .thenReturn(List.of());
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenReturn(List.of());

        assertThat(service.returnOrderSale(order, 17L)).isTrue();

        verify(lines).save(any(StockDocumentLine.class));
        verify(movements, never()).save(any(StockMovement.class));
        verify(layers, never()).save(any(StockCostLayer.class));
    }

    @Test
    void customerReturnDraftUsesOnlySourceOrderLinePriceAndCost() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        OrderRepository orders = mock(OrderRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        versions,
                        lines,
                        movements,
                        layers,
                        mock(StockReservationRepository.class),
                        products,
                        orders,
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));

        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000101");
        Order order = new Order();
        order.id = orderId;
        order.orderNumberDate = java.time.LocalDate.of(2026, 9, 3);
        order.dailyNumber = 101;
        order.status = OrderStatus.COMPLETED;
        OrderItem orderItem = new OrderItem();
        orderItem.id = 501L;
        orderItem.order = order;
        orderItem.productId = product.id;
        orderItem.sku = product.sku;
        orderItem.nameRu = product.nameRu;
        orderItem.quantity = quantity("3.000");
        orderItem.unitPrice = money("120.00");
        orderItem.confirmedUnitPrice = money("110.00");
        orderItem.incomingPrice = money("70.00");
        OrderItem untouchedOrderItem = new OrderItem();
        untouchedOrderItem.id = 502L;
        untouchedOrderItem.order = order;
        untouchedOrderItem.productId = 102L;
        untouchedOrderItem.sku = "P-102";
        untouchedOrderItem.nameRu = "Клапан";
        untouchedOrderItem.quantity = quantity("1.000");
        untouchedOrderItem.unitPrice = money("50.00");
        untouchedOrderItem.confirmedUnitPrice = money("50.00");
        order.items = List.of(orderItem, untouchedOrderItem);
        CurrentUser admin =
                new CurrentUser(
                        7L,
                        "admin@example.test",
                        "Администратор",
                        null,
                        Set.of(),
                        true,
                        BigDecimal.ZERO);

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(orders.findWithItemsById(orderId)).thenReturn(Optional.of(order));
        when(products.findByIdInAndDeletedAtIsNull(anySet())).thenReturn(List.of(product));
        when(lines.postedQuantityBySourceOrderItemIds(
                        eq(orderId), anySet(), eq(StockDocumentType.CUSTOMER_RETURN), eq(StockDocumentStatus.POSTED)))
                .thenReturn(List.of());
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenReturn(List.of());
        when(versions.findTopByDocumentIdOrderByVersionNumberDesc(any(UUID.class)))
                .thenReturn(Optional.empty());

        service.createDraft(
                new WarehouseDto.DocumentRequest(
                        StockDocumentType.CUSTOMER_RETURN,
                        null,
                        null,
                        orderId,
                        "Подменённое основание",
                        null,
                        null,
                        null,
                        List.of(
                                new WarehouseDto.DocumentLineRequest(
                                        product.id,
                                        quantity("2.000"),
                                        money("1.00"),
                                        orderItem.id,
                                        null,
                                        money("1.00"),
                                        null))),
                admin,
                true);

        var lineCaptor = org.mockito.ArgumentCaptor.forClass(StockDocumentLine.class);
        verify(lines).save(lineCaptor.capture());
        StockDocumentLine saved = lineCaptor.getValue();
        assertThat(saved.productId).isEqualTo(product.id);
        assertThat(saved.sourceOrderItemId).isEqualTo(orderItem.id);
        assertThat(saved.unitPrice).isEqualByComparingTo("110.00");
        assertThat(saved.unitCost).isEqualByComparingTo("70.00");

        var documentCaptor = org.mockito.ArgumentCaptor.forClass(StockDocument.class);
        verify(documents).save(documentCaptor.capture());
        StockDocument returnDocument = documentCaptor.getValue();
        when(documents.findForUpdateById(returnDocument.id)).thenReturn(Optional.of(returnDocument));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(lines.findByDocumentIdOrderById(returnDocument.id)).thenReturn(List.of(saved));
        when(documents.nextDocumentNumber()).thenReturn(1L);

        service.post(returnDocument.id, admin, true);

        assertThat(returnDocument.status).isEqualTo(StockDocumentStatus.POSTED);
        verify(movements, never()).save(any(StockMovement.class));
        verify(layers, never()).save(any(StockCostLayer.class));
    }

    @Test
    void shortageReleasesListOnlyRecordedShortageLines() {
        OrderItemRepository orderItems = mock(OrderItemRepository.class);
        UserRepository users = mock(UserRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        mock(WarehouseRepository.class),
                        mock(StockDocumentRepository.class),
                        mock(StockDocumentVersionRepository.class),
                        mock(StockDocumentLineRepository.class),
                        mock(StockMovementRepository.class),
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        mock(ProductRepository.class),
                        mock(OrderRepository.class),
                        orderItems,
                        users);
        Order order = new Order();
        order.id = UUID.fromString("00000000-0000-7000-8000-000000000099");
        order.orderNumberDate = java.time.LocalDate.of(2026, 9, 3);
        order.dailyNumber = 99;
        order.status = OrderStatus.COMPLETED;
        OrderItem item = new OrderItem();
        item.id = 45L;
        item.order = order;
        item.productId = 101L;
        item.sku = "P-101";
        item.nameRu = "Насос";
        item.stockShortageQuantity = quantity("2.000");
        item.stockShortageReleasedByUserId = 7L;
        item.stockShortageReleasedAt = Instant.parse("2026-09-03T05:00:00Z");
        item.stockShortageComment = "Отпущено по согласованию";
        User employee = new User();
        employee.id = 7L;
        employee.name = "Администратор";
        when(orderItems.findStockShortageReleases()).thenReturn(List.of(item));
        when(users.findAllById(Set.of(7L))).thenReturn(List.of(employee));

        assertThat(service.stockShortageReleases())
                .singleElement()
                .satisfies(
                        release -> {
                            assertThat(release.productName()).isEqualTo("Насос");
                            assertThat(release.shortageQuantity()).isEqualByComparingTo("2.000");
                            assertThat(release.orderId()).isEqualTo(order.id);
                            assertThat(release.releasedByUserName()).isEqualTo("Администратор");
                        });
    }

    @Test
    void productMovementsShowActiveDocumentsInReverseChronologyWithRunningBalance() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        mock(StockDocumentRepository.class),
                        mock(StockDocumentVersionRepository.class),
                        mock(StockDocumentLineRepository.class),
                        movements,
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        StockDocument receipt = draft(UUID.randomUUID(), StockDocumentType.RECEIPT, warehouse.id);
        receipt.documentNumber = "С-1";
        StockDocument sale = draft(UUID.randomUUID(), StockDocumentType.SALE, warehouse.id);
        sale.documentNumber = "С-2";
        StockMovement inbound = movement(receipt.id, product.id, "5.000");
        StockMovement outbound = movement(sale.id, product.id, "-2.000");

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id)))
                .thenReturn(List.of(product));
        when(movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                        warehouse.id, product.id))
                .thenReturn(
                        List.of(new Object[] {inbound, receipt}, new Object[] {outbound, sale}));

        assertThat(service.movementsForProduct(product.id).movements())
                .extracting(movement -> movement.documentNumber())
                .containsExactly("С-2", "С-1");
        assertThat(service.movementsForProduct(product.id).movements().get(0).balanceAfter())
                .isEqualByComparingTo("3.000");
        assertThat(service.movementsForProduct(product.id).movements().get(1).balanceAfter())
                .isEqualByComparingTo("5.000");
    }

    @Test
    void softDeleteDraftKeepsAuditRecordButMarksItExcluded() {
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        mock(WarehouseRepository.class),
                        documents,
                        mock(StockDocumentVersionRepository.class),
                        mock(StockDocumentLineRepository.class),
                        mock(StockMovementRepository.class),
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        mock(ProductRepository.class),
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.RECEIPT, 1L);
        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));

        CurrentUser admin =
                new CurrentUser(
                        7L,
                        "admin@example.test",
                        "Администратор",
                        null,
                        Set.of(),
                        true,
                        BigDecimal.ZERO);

        service.softDelete(document.id, admin);

        assertThat(document.deletedAt).isNotNull();
        assertThat(document.deletedByUserId).isEqualTo(admin.id());
        verify(documents).save(document);
    }

    @Test
    void cleanIncomingFallsBackToIncomingPriceFromProductCardWhenNoPostedReceiptExists() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        mock(StockDocumentRepository.class),
                        mock(StockDocumentVersionRepository.class),
                        lines,
                        mock(StockMovementRepository.class),
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.nameRu = "Насос";
        product.incomingPrice = money("12500.00");

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(lines.findLatestPostedReceiptLines(eq(product.id), any())).thenReturn(List.of());

        WarehouseDto.PriceSettingPreviewLine result =
                service.previewPriceSetting(cleanIncomingPreviewRequest(product.id)).getFirst();

        assertThat(result.sourcePrice()).isEqualByComparingTo("12500.00");
        assertThat(result.unitPrice()).isEqualByComparingTo("12500");
        assertThat(result.sourceDescription()).contains("Приходная из карточки товара");
    }

    @Test
    void cleanIncomingPrefersLastPostedReceiptOverIncomingPriceFromProductCard() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        mock(StockDocumentVersionRepository.class),
                        lines,
                        mock(StockMovementRepository.class),
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.nameRu = "Насос";
        product.incomingPrice = money("12500.00");
        StockDocument receipt = draft(UUID.randomUUID(), StockDocumentType.RECEIPT, warehouse.id);
        receipt.status = StockDocumentStatus.POSTED;
        receipt.documentNumber = "СКЛ-1";
        receipt.effectiveDate = java.time.LocalDate.of(2026, 9, 1);
        receipt.effectiveTime = java.time.LocalTime.NOON;
        StockDocumentLine receiptLine = line(receipt.id, product.id, "1.000", "11800.00");

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(lines.findPostedReceiptHistory(product.id))
                .thenReturn(List.<Object[]>of(new Object[] {receiptLine, receipt}));
        when(documents.findByIdAndDeletedAtIsNull(receipt.id)).thenReturn(Optional.of(receipt));

        WarehouseDto.PriceSettingPreviewLine result =
                service.previewPriceSetting(cleanIncomingPreviewRequest(product.id)).getFirst();

        assertThat(result.sourcePrice()).isEqualByComparingTo("11800.00");
        assertThat(result.unitPrice()).isEqualByComparingTo("11800");
        assertThat(result.sourceDescription()).contains("приход СКЛ-1");
    }

    @Test
    void priceSettingRoundsIncomingPriceWithoutStockMovement() {
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        mock(WarehouseRepository.class),
                        documents,
                        versions,
                        lines,
                        movements,
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        UUID sourceId = UUID.randomUUID();
        StockDocument source = draft(sourceId, StockDocumentType.RECEIPT, 1L);
        source.status = StockDocumentStatus.DRAFT;
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.PRICE_SETTING, 1L);
        document.priceType = StockDocumentPriceType.INCOMING;
        StockDocumentLine settingLine = line(document.id, 101L, "2.000", "700.00");
        settingLine.sourceDocumentId = sourceId;
        settingLine.unitPrice = money("1.50");
        StockDocumentLine sourceLine = line(sourceId, 101L, "2.000", "700.001");
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        product.price = money("100.00");
        CurrentUser admin =
                new CurrentUser(
                        7L,
                        "admin@example.test",
                        "Администратор",
                        null,
                        Set.of(),
                        true,
                        BigDecimal.ZERO);

        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        when(documents.findByIdAndDeletedAtIsNull(sourceId)).thenReturn(Optional.of(source));
        when(lines.findByDocumentIdOrderById(document.id)).thenReturn(List.of(settingLine));
        when(lines.findByDocumentIdOrderById(sourceId)).thenReturn(List.of(sourceLine));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(versions.findTopByDocumentIdOrderByVersionNumberDesc(document.id))
                .thenReturn(Optional.empty());

        service.post(document.id, admin, true);

        assertThat(product.price).isEqualByComparingTo("100.00");
        assertThat(product.incomingPrice).isEqualByComparingTo("2.00");
        assertThat(document.status).isEqualTo(StockDocumentStatus.POSTED);
        verify(movements, never()).save(any(StockMovement.class));

        StockDocument staleDocument = draft(UUID.randomUUID(), StockDocumentType.PRICE_SETTING, 1L);
        staleDocument.priceType = StockDocumentPriceType.INCOMING;
        StockDocumentLine staleLine = line(staleDocument.id, product.id, "2.000", "700.00");
        staleLine.sourceDocumentId = sourceId;
        staleLine.unitPrice = money("3.00");
        sourceLine.unitCost = money("800.00");
        when(documents.findForUpdateById(staleDocument.id)).thenReturn(Optional.of(staleDocument));
        when(lines.findByDocumentIdOrderById(staleDocument.id)).thenReturn(List.of(staleLine));

        assertThatThrownBy(() -> service.post(staleDocument.id, admin, true))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Исходный документ изменился");

        StockDocument incomingSource = draft(UUID.randomUUID(), StockDocumentType.PRICE_SETTING, 1L);
        incomingSource.priceType = StockDocumentPriceType.INCOMING;
        StockDocumentLine incomingSourceLine = line(incomingSource.id, product.id, "2.000", "700.00");
        StockDocument retailDocument = draft(UUID.randomUUID(), StockDocumentType.PRICE_SETTING, 1L);
        retailDocument.priceType = StockDocumentPriceType.RETAIL;
        StockDocumentLine retailLine = line(retailDocument.id, product.id, "2.000", "700.00");
        retailLine.sourceDocumentId = incomingSource.id;
        retailLine.unitPrice = money("125.00");
        when(documents.findForUpdateById(retailDocument.id)).thenReturn(Optional.of(retailDocument));
        when(documents.findByIdAndDeletedAtIsNull(incomingSource.id))
                .thenReturn(Optional.of(incomingSource));
        when(lines.findByDocumentIdOrderById(incomingSource.id))
                .thenReturn(List.of(incomingSourceLine));
        when(lines.findByDocumentIdOrderById(retailDocument.id)).thenReturn(List.of(retailLine));

        service.post(retailDocument.id, admin, true);

        assertThat(product.price).isEqualByComparingTo("125.00");
        assertThat(retailDocument.status).isEqualTo(StockDocumentStatus.POSTED);
    }

    @Test
    void aiUpdatesIncomingDraftPriceWithoutChangingItsCleanCost() {
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service = new WarehouseService(
                mock(WarehouseRepository.class), documents,
                mock(StockDocumentVersionRepository.class), lines,
                mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
                mock(StockReservationRepository.class), products, mock(OrderRepository.class),
                mock(OrderItemRepository.class), mock(UserRepository.class));
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.PRICE_SETTING, 1L);
        document.priceType = StockDocumentPriceType.INCOMING;
        StockDocumentLine line = line(document.id, 101L, "2.000", "761.93");
        line.sourceDocumentId = UUID.randomUUID();
        line.unitPrice = money("762.00");
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        when(lines.findByDocumentIdOrderById(document.id)).thenReturn(List.of(line));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        CurrentUser admin = new CurrentUser(
                7L, "admin@example.test", "Администратор", null, Set.of(), true, BigDecimal.ZERO);

        WarehouseDto.Document result = service.applyAiIncomingPrices(
                document.id, Map.of(product.id, money("900.00")), admin);

        assertThat(result.lines()).singleElement().satisfies(updated -> {
            assertThat(updated.unitCost()).isEqualByComparingTo("761.93");
            assertThat(updated.unitPrice()).isEqualByComparingTo("900.00");
            assertThat(updated.sourceDocumentId()).isEqualTo(line.sourceDocumentId);
        });
        assertThat(document.status).isEqualTo(StockDocumentStatus.DRAFT);
    }

    @Test
    void priceSettingAllowsProductPickedWithoutReceiptDocument() {
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        mock(WarehouseRepository.class),
                        documents,
                        versions,
                        lines,
                        mock(StockMovementRepository.class),
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.PRICE_SETTING, 1L);
        document.priceType = StockDocumentPriceType.RETAIL;
        StockDocumentLine settingLine = line(document.id, 101L, "1.000", null);
        settingLine.unitPrice = money("125.00");
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        CurrentUser admin =
                new CurrentUser(
                        7L,
                        "admin@example.test",
                        "Администратор",
                        null,
                        Set.of(),
                        true,
                        BigDecimal.ZERO);

        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        when(lines.findByDocumentIdOrderById(document.id)).thenReturn(List.of(settingLine));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(versions.findTopByDocumentIdOrderByVersionNumberDesc(document.id))
                .thenReturn(Optional.empty());

        service.post(document.id, admin, true);

        assertThat(product.price).isEqualByComparingTo("125.00");
        assertThat(document.status).isEqualTo(StockDocumentStatus.POSTED);
        verify(documents, never()).findByIdAndDeletedAtIsNull(any());
    }

    @Test
    void cancellingPriceSettingRestoresThePreviousCardPrice() {
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        mock(WarehouseRepository.class),
                        documents,
                        versions,
                        lines,
                        mock(StockMovementRepository.class),
                        mock(StockCostLayerRepository.class),
                        mock(StockReservationRepository.class),
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.PRICE_SETTING, 1L);
        document.status = StockDocumentStatus.DRAFT;
        document.priceType = StockDocumentPriceType.INCOMING;
        StockDocumentLine settingLine = line(document.id, 101L, "1.000", null);
        settingLine.unitPrice = money("24100.00");
        settingLine.previousUnitPrice = money("23500.00");
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        product.incomingPrice = settingLine.previousUnitPrice;
        CurrentUser admin =
                new CurrentUser(
                        7L,
                        "admin@example.test",
                        "Администратор",
                        null,
                        Set.of(),
                        true,
                        BigDecimal.ZERO);

        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        when(lines.findByDocumentIdOrderById(document.id)).thenReturn(List.of(settingLine));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(versions.findTopByDocumentIdOrderByVersionNumberDesc(document.id))
                .thenReturn(Optional.empty());

        service.post(document.id, admin, true);
        assertThat(product.incomingPrice).isEqualByComparingTo("24100.00");
        when(lines.findPostedPriceHistory(product.id, document.priceType))
                .thenReturn(List.<Object[]>of(new Object[] {settingLine, document}));
        service.cancel(document.id, admin, true);

        assertThat(product.incomingPrice).isEqualByComparingTo("23500.00");
        assertThat(document.status).isEqualTo(StockDocumentStatus.CANCELLED);
    }

    @Test
    void openingBalanceUsesItsSelectedDateAndTimeForMovementAndCostLayer() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        mock(StockDocumentVersionRepository.class),
                        lines,
                        movements,
                        layers,
                        mock(StockReservationRepository.class),
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.OPENING_BALANCE, warehouse.id);
        document.effectiveDate = java.time.LocalDate.of(2026, 1, 15);
        document.effectiveTime = java.time.LocalTime.of(14, 30);
        StockDocumentLine documentLine = line(document.id, product.id, "3.000", null);
        CurrentUser admin =
                new CurrentUser(
                        7L,
                        "admin@example.test",
                        "Администратор",
                        null,
                        Set.of(),
                        true,
                        BigDecimal.ZERO);

        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(lines.findByDocumentIdOrderById(document.id)).thenReturn(List.of(documentLine));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenReturn(List.of(documentLine));

        service.post(document.id, admin, true);

        Instant expected =
                java.time.LocalDateTime.of(document.effectiveDate, document.effectiveTime)
                        .atZone(java.time.ZoneId.of("Asia/Almaty"))
                        .toInstant();
        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().occurredAt).isEqualTo(expected);
        var layerCaptor = org.mockito.ArgumentCaptor.forClass(StockCostLayer.class);
        verify(layers).save(layerCaptor.capture());
        assertThat(layerCaptor.getValue().receivedAt).isEqualTo(expected);
    }

    @Test
    void zeroOpeningBalanceIsPostedAsARecordedOutOfStockBaseline() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        mock(StockDocumentVersionRepository.class),
                        lines,
                        movements,
                        layers,
                        mock(StockReservationRepository.class),
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        StockDocument document = draft(UUID.randomUUID(), StockDocumentType.OPENING_BALANCE, warehouse.id);
        StockDocumentLine documentLine = line(document.id, product.id, "0.000", null);
        CurrentUser admin =
                new CurrentUser(
                        7L,
                        "admin@example.test",
                        "Администратор",
                        null,
                        Set.of(),
                        true,
                        BigDecimal.ZERO);

        when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(lines.findByDocumentIdOrderById(document.id)).thenReturn(List.of(documentLine));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(documents.nextDocumentNumber()).thenReturn(1L);

        service.post(document.id, admin, true);

        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().quantity).isEqualByComparingTo("0.000");
        verify(layers, never()).save(any());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(ints = {0, 5})
    void zeroInventoryCanBeCreatedAndPostedAsAbsoluteCount(int previousQuantity) {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service = serviceWithReplay(
                warehouses, documents, mock(StockDocumentVersionRepository.class), lines,
                movements, layers, mock(StockReservationRepository.class), products,
                mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        CurrentUser admin = new CurrentUser(
                7L, "admin@example.test", "Администратор", null, Set.of(), true, BigDecimal.ZERO);
        List<StockDocumentLine> savedLines = new ArrayList<>();
        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(lines.save(any(StockDocumentLine.class))).thenAnswer(invocation -> {
            StockDocumentLine saved = invocation.getArgument(0);
            savedLines.add(saved);
            return saved;
        });
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenReturn(savedLines);
        when(documents.save(any(StockDocument.class))).thenAnswer(invocation -> {
            StockDocument saved = invocation.getArgument(0);
            when(documents.findForUpdateById(saved.id)).thenReturn(Optional.of(saved));
            return saved;
        });
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(movements.balanceByProductId(warehouse.id, product.id))
                .thenReturn(BigDecimal.valueOf(previousQuantity));
        StockMovement previousMovement = new StockMovement();
        previousMovement.id = UUID.randomUUID();
        previousMovement.documentId = UUID.randomUUID();
        previousMovement.productId = product.id;
        previousMovement.movementType = "RECEIPT";
        previousMovement.originalUnitCost = money("10.00");
        previousMovement.quantity = BigDecimal.valueOf(previousQuantity);
        previousMovement.occurredAt = Instant.now().minusSeconds(60);
        StockDocument previousDocument =
                draft(previousMovement.documentId, StockDocumentType.RECEIPT, warehouse.id);
        previousDocument.status = StockDocumentStatus.POSTED;
        when(movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                        warehouse.id, product.id))
                .thenReturn(previousQuantity == 0
                        ? List.of()
                        : List.<Object[]>of(new Object[] {previousMovement, previousDocument}));
        StockCostLayer layer = new StockCostLayer();
        layer.id = UUID.randomUUID();
        layer.sourceMovementId = previousMovement.id;
        layer.originalQuantity = BigDecimal.valueOf(previousQuantity);
        layer.remainingQuantity = BigDecimal.valueOf(previousQuantity);
        layer.unitCost = money("10.00");
        when(layers.findByWarehouseIdAndProductId(warehouse.id, product.id))
                .thenReturn(previousQuantity == 0 ? List.of() : List.of(layer));

        WarehouseDto.Document draft = service.createDraft(new WarehouseDto.DocumentRequest(
                StockDocumentType.INVENTORY, null, null, null, "Пересчет", null, null, null,
                List.of(new WarehouseDto.DocumentLineRequest(
                        product.id, BigDecimal.ZERO, null, null, null, null, null))), admin, true);
        assertThat(draft.lines()).singleElement().satisfies(
                line -> assertThat(line.quantity()).isEqualByComparingTo("0"));
        WarehouseDto.Document posted = service.post(draft.id(), admin, true);

        assertThat(posted.status()).isEqualTo(StockDocumentStatus.POSTED);
        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().productId).isEqualTo(product.id);
        assertThat(movementCaptor.getValue().inventoryQuantity).isEqualByComparingTo("0");
        assertThat(movementCaptor.getValue().quantity)
                .isEqualByComparingTo(BigDecimal.valueOf(-previousQuantity));
        assertThat(layer.remainingQuantity).isEqualByComparingTo("0");
        verify(layers, times(previousQuantity == 0 ? 0 : 1)).save(any());
    }

    @Test
    void backdatedInventoryCountsStockAtItsDocumentMomentAndKeepsLaterSales() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service = serviceWithReplay(
                warehouses, documents, mock(StockDocumentVersionRepository.class), lines,
                movements, layers, mock(StockReservationRepository.class), products,
                mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        product.incomingPrice = money("10.00");
        StockDocument inventory = draft(UUID.randomUUID(), StockDocumentType.INVENTORY, warehouse.id);
        inventory.effectiveDate = java.time.LocalDate.of(2026, 9, 20);
        inventory.effectiveTime = java.time.LocalTime.of(12, 0);
        StockDocumentLine inventoryLine = line(inventory.id, product.id, "7.000", null);
        Instant at = java.time.LocalDateTime.of(inventory.effectiveDate, inventory.effectiveTime)
                .atZone(java.time.ZoneId.of("Asia/Almaty")).toInstant();
        StockDocument receipt = draft(UUID.randomUUID(), StockDocumentType.RECEIPT, warehouse.id);
        receipt.status = StockDocumentStatus.POSTED;
        StockMovement earlier = new StockMovement();
        earlier.id = UUID.randomUUID();
        earlier.documentId = receipt.id;
        earlier.productId = product.id;
        earlier.movementType = "RECEIPT";
        earlier.originalUnitCost = money("10.00");
        earlier.quantity = quantity("5.000");
        earlier.occurredAt = at.minusSeconds(3600);
        StockDocument sale = draft(UUID.randomUUID(), StockDocumentType.SALE, warehouse.id);
        sale.status = StockDocumentStatus.POSTED;
        StockMovement later = new StockMovement();
        later.id = UUID.randomUUID();
        later.documentId = sale.id;
        later.productId = product.id;
        later.movementType = "SALE";
        later.quantity = quantity("-3.000");
        later.occurredAt = at.plusSeconds(3600);
        StockCostLayer earlierLayer = new StockCostLayer();
        earlierLayer.id = UUID.randomUUID();
        earlierLayer.sourceMovementId = earlier.id;
        earlierLayer.sourceDocumentId = receipt.id;
        earlierLayer.productId = product.id;
        earlierLayer.originalQuantity = quantity("5.000");
        earlierLayer.remainingQuantity = quantity("2.000");
        earlierLayer.receivedAt = earlier.occurredAt;
        List<StockCostLayer> allLayers = new ArrayList<>(List.of(earlierLayer));
        List<Object[]> movementHistory = new ArrayList<>();
        movementHistory.add(new Object[] {earlier, receipt});
        movementHistory.add(new Object[] {later, sale});

        when(documents.findForUpdateById(inventory.id)).thenReturn(Optional.of(inventory));
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(lines.findByDocumentIdOrderById(inventory.id)).thenReturn(List.of(inventoryLine));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                        warehouse.id, product.id))
                .thenAnswer(invocation -> movementHistory);
        when(movements.save(any(StockMovement.class))).thenAnswer(invocation -> {
            StockMovement saved = invocation.getArgument(0);
            movementHistory.add(new Object[] {saved, inventory});
            return saved;
        });
        when(layers.findByWarehouseIdAndProductIdOrderByCreatedAtAsc(warehouse.id, product.id))
                .thenAnswer(invocation -> allLayers);
        when(layers.save(any(StockCostLayer.class))).thenAnswer(invocation -> {
            StockCostLayer saved = invocation.getArgument(0);
            allLayers.add(saved);
            return saved;
        });

        CurrentUser admin = new CurrentUser(
                7L, "admin@example.test", "Администратор", null, Set.of(), true, BigDecimal.ZERO);
        service.post(inventory.id, admin, false);

        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().quantity).isEqualByComparingTo("2.000");
        assertThat(movementCaptor.getValue().occurredAt).isEqualTo(at);
        var layerCaptor = org.mockito.ArgumentCaptor.forClass(StockCostLayer.class);
        verify(layers, times(2)).save(layerCaptor.capture());
        assertThat(layerCaptor.getValue().receivedAt).isEqualTo(at);
        assertThat(earlierLayer.remainingQuantity).isEqualByComparingTo("2.000");
        assertThat(layerCaptor.getValue().remainingQuantity).isEqualByComparingTo("2.000");
        assertThat(movementCaptor.getValue().inventoryQuantity).isEqualByComparingTo("7.000");
        assertThat(earlier.quantity.add(movementCaptor.getValue().quantity).add(later.quantity))
                .isEqualByComparingTo("4.000");
        assertThat(later.unitCost).isEqualByComparingTo("10.00");
    }

    @Test
    void backdatedReceiptReplaysLaterSaleAgainstEarlierFifoLayers() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service = serviceWithReplay(
                warehouses, documents, mock(StockDocumentVersionRepository.class), lines,
                movements, layers, mock(StockReservationRepository.class), products,
                mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        StockDocument receipt = draft(UUID.randomUUID(), StockDocumentType.RECEIPT, warehouse.id);
        receipt.effectiveDate = java.time.LocalDate.of(2026, 9, 20);
        receipt.effectiveTime = java.time.LocalTime.of(12, 0);
        StockDocumentLine receiptLine = line(receipt.id, product.id, "5.000", "20.00");
        Instant at = java.time.LocalDateTime.of(receipt.effectiveDate, receipt.effectiveTime)
                .atZone(java.time.ZoneId.of("Asia/Almaty")).toInstant();
        StockDocument earlierReceipt = draft(UUID.randomUUID(), StockDocumentType.RECEIPT, warehouse.id);
        earlierReceipt.status = StockDocumentStatus.POSTED;
        StockMovement earlier = new StockMovement();
        earlier.id = UUID.randomUUID();
        earlier.documentId = earlierReceipt.id;
        earlier.productId = product.id;
        earlier.movementType = "RECEIPT";
        earlier.originalUnitCost = money("10.00");
        earlier.quantity = quantity("5.000");
        earlier.occurredAt = at.minusSeconds(3600);
        StockDocument sale = draft(UUID.randomUUID(), StockDocumentType.SALE, warehouse.id);
        sale.status = StockDocumentStatus.POSTED;
        StockMovement later = new StockMovement();
        later.id = UUID.randomUUID();
        later.documentId = sale.id;
        later.productId = product.id;
        later.movementType = "SALE";
        later.quantity = quantity("-7.000");
        later.occurredAt = at.plusSeconds(3600);
        StockCostLayer earlierLayer = new StockCostLayer();
        earlierLayer.id = UUID.randomUUID();
        earlierLayer.sourceMovementId = earlier.id;
        earlierLayer.sourceDocumentId = earlierReceipt.id;
        earlierLayer.productId = product.id;
        earlierLayer.originalQuantity = quantity("5.000");
        earlierLayer.remainingQuantity = quantity("0.000");
        earlierLayer.receivedAt = earlier.occurredAt;
        List<StockCostLayer> allLayers = new ArrayList<>(List.of(earlierLayer));
        List<Object[]> history = new ArrayList<>();
        history.add(new Object[] {earlier, earlierReceipt});
        history.add(new Object[] {later, sale});

        when(documents.findForUpdateById(receipt.id)).thenReturn(Optional.of(receipt));
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(lines.findByDocumentIdOrderById(receipt.id)).thenReturn(List.of(receiptLine));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));
        when(movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                        warehouse.id, product.id))
                .thenAnswer(invocation -> history);
        when(movements.save(any(StockMovement.class))).thenAnswer(invocation -> {
            StockMovement saved = invocation.getArgument(0);
            history.add(new Object[] {saved, receipt});
            return saved;
        });
        when(layers.findByWarehouseIdAndProductIdOrderByCreatedAtAsc(warehouse.id, product.id))
                .thenAnswer(invocation -> allLayers);
        when(layers.save(any(StockCostLayer.class))).thenAnswer(invocation -> {
            StockCostLayer saved = invocation.getArgument(0);
            allLayers.add(saved);
            return saved;
        });

        CurrentUser admin = new CurrentUser(
                7L, "admin@example.test", "Администратор", null, Set.of(), true, BigDecimal.ZERO);
        service.post(receipt.id, admin, false);

        var movementCaptor = org.mockito.ArgumentCaptor.forClass(StockMovement.class);
        verify(movements).save(movementCaptor.capture());
        assertThat(movementCaptor.getValue().occurredAt).isEqualTo(at);
        var layerCaptor = org.mockito.ArgumentCaptor.forClass(StockCostLayer.class);
        verify(layers, times(2)).save(layerCaptor.capture());
        assertThat(layerCaptor.getValue().receivedAt).isEqualTo(at);
        assertThat(earlierLayer.remainingQuantity).isEqualByComparingTo("0.000");
        assertThat(layerCaptor.getValue().remainingQuantity).isEqualByComparingTo("3.000");
        assertThat(layerCaptor.getValue().unitCost).isEqualByComparingTo("20.00");
        assertThat(later.unitCost).isEqualByComparingTo("12.86");
    }

    @Test
    void postedReceiptCreatesBalanceRedactsCostsAndCannotReduceBelowActiveReservation() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        StockReservationRepository reservations = mock(StockReservationRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        versions,
                        lines,
                        movements,
                        layers,
                        reservations,
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));

        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        warehouse.code = "MAIN";
        warehouse.nameRu = "Основной склад";
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        product.incomingPrice = money("10.00");
        UUID receiptId = UUID.randomUUID();
        UUID inventoryId = UUID.randomUUID();
        StockDocument receipt = draft(receiptId, StockDocumentType.RECEIPT, warehouse.id);
        StockDocument inventory = draft(inventoryId, StockDocumentType.INVENTORY, warehouse.id);
        StockDocumentLine receiptLine = line(receiptId, product.id, "5.000", "10.00");
        StockDocumentLine inventoryLine = line(inventoryId, product.id, "2.000", null);
        Map<UUID, StockDocument> documentMap = Map.of(receiptId, receipt, inventoryId, inventory);
        Map<UUID, List<StockDocumentLine>> lineMap =
                Map.of(receiptId, List.of(receiptLine), inventoryId, List.of(inventoryLine));
        Map<Long, BigDecimal> onHand = new HashMap<>();
        Map<UUID, List<StockMovement>> documentMovements = new HashMap<>();

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(documents.findForUpdateById(any(UUID.class)))
                .thenAnswer(
                        invocation ->
                                Optional.ofNullable(documentMap.get(invocation.getArgument(0))));
        when(documents.nextDocumentNumber()).thenReturn(1L);
        when(lines.findByDocumentIdOrderById(any(UUID.class)))
                .thenAnswer(
                        invocation -> lineMap.getOrDefault(invocation.getArgument(0), List.of()));
        when(products.findByIdInAndDeletedAtIsNull(anySet())).thenReturn(List.of(product));
        when(movements.balanceByProductId(warehouse.id, product.id))
                .thenAnswer(invocation -> onHand.getOrDefault(product.id, BigDecimal.ZERO));
        when(movements.balanceByWarehouseId(warehouse.id))
                .thenAnswer(
                        invocation ->
                                onHand.entrySet().stream()
                                        .map(
                                                entry ->
                                                        new Object[] {
                                                            entry.getKey(), entry.getValue()
                                                        })
                                        .toList());
        when(movements.existsActiveByWarehouseIdAndProductId(warehouse.id, product.id))
                .thenAnswer(invocation -> onHand.containsKey(product.id));
        doAnswer(
                        invocation -> {
                            StockMovement movement = invocation.getArgument(0);
                            onHand.merge(movement.productId, movement.quantity, BigDecimal::add);
                            documentMovements
                                    .computeIfAbsent(movement.documentId, key -> new ArrayList<>())
                                    .add(movement);
                            return movement;
                        })
                .when(movements)
                .save(any(StockMovement.class));
        when(movements.findByDocumentId(receiptId))
                .thenAnswer(invocation -> documentMovements.getOrDefault(receiptId, List.of()));
        when(movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                        warehouse.id, product.id))
                .thenAnswer(
                        invocation ->
                                documentMovements.values().stream()
                                        .flatMap(Collection::stream)
                                        .map(movement -> new Object[] {movement, documentMap.get(movement.documentId)})
                                        .toList());
        StockReservation activeReservation = new StockReservation();
        activeReservation.productId = product.id;
        activeReservation.quantity = quantity("3.000");
        activeReservation.createdAt = Instant.now().plusSeconds(60);
        when(reservations.findByWarehouseIdAndProductIdAndStatusOrderByCreatedAtDesc(
                        warehouse.id, product.id, StockReservationStatus.ACTIVE))
                .thenReturn(List.of(activeReservation));
        when(reservations.activeQuantityByWarehouseId(warehouse.id))
                .thenReturn(List.<Object[]>of(new Object[] {product.id, quantity("3.000")}));
        when(reservations.activeQuantityByProductId(warehouse.id, product.id))
                .thenReturn(quantity("3.000"));

        CurrentUser admin =
                new CurrentUser(
                        1L,
                        "admin@example.test",
                        "Администратор",
                        null,
                        Set.of(),
                        true,
                        BigDecimal.ZERO);
        service.post(receiptId, admin, true);

        assertThat(onHand.get(product.id)).isEqualByComparingTo("5.000");
        assertThat(service.balances(false))
                .singleElement()
                .satisfies(
                        balance -> {
                            assertThat(balance.onHand()).isEqualByComparingTo("5");
                            assertThat(balance.reserved()).isEqualByComparingTo("3");
                            assertThat(balance.available()).isEqualByComparingTo("2");
                            assertThat(balance.inventoryCost()).isNull();
                        });

        verify(layers).save(any(StockCostLayer.class));

        assertThatThrownBy(() -> service.post(inventoryId, admin, true))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Недостаточно незарезервированного остатка");
        // This fixture calls the service directly, without Spring's transactional proxy.
        // Restore persisted state after the rejected operation before testing cancellation.
        inventory.status = StockDocumentStatus.DRAFT;
        documentMovements.remove(inventoryId);
        onHand.put(product.id, quantity("5.000"));
        savedEntities(layers, StockCostLayer.class).forEach(layer ->
                layer.remainingQuantity = quantity("5.000"));

        assertThatThrownBy(() -> service.cancel(receiptId, admin, true))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Отмена затрагивает зарезервированный товар");
    }

    @Test
    void reservationCreatedBeforeReceiptDoesNotHoldTheLaterReceipt() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockReservationRepository reservations = mock(StockReservationRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        mock(StockDocumentRepository.class),
                        mock(StockDocumentVersionRepository.class),
                        mock(StockDocumentLineRepository.class),
                        movements,
                        mock(StockCostLayerRepository.class),
                        reservations,
                        products,
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));

        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        warehouse.code = "MAIN";
        Product product = new Product();
        product.id = 101L;
        product.sku = "P-101";
        product.nameRu = "Насос";
        StockMovement receipt = new StockMovement();
        receipt.productId = product.id;
        receipt.quantity = quantity("1.000");
        receipt.movementType = "RECEIPT";
        receipt.occurredAt = Instant.parse("2026-09-11T06:42:00Z");
        receipt.createdAt = receipt.occurredAt;
        StockReservation oldReservation = new StockReservation();
        oldReservation.productId = product.id;
        oldReservation.quantity = quantity("1.000");
        oldReservation.createdAt = Instant.parse("2026-09-10T04:48:00Z");

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(movements.balanceByWarehouseId(warehouse.id))
                .thenReturn(List.<Object[]>of(new Object[] {product.id, quantity("1.000")}));
        when(movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                        warehouse.id, product.id))
                .thenReturn(List.<Object[]>of(new Object[] {receipt, mock(StockDocument.class)}));
        when(reservations.activeQuantityByWarehouseId(warehouse.id))
                .thenReturn(List.<Object[]>of(new Object[] {product.id, quantity("1.000")}));
        when(reservations.findByWarehouseIdAndProductIdAndStatusOrderByCreatedAtDesc(
                        warehouse.id, product.id, StockReservationStatus.ACTIVE))
                .thenReturn(List.of(oldReservation));
        when(products.findByIdInAndDeletedAtIsNull(Set.of(product.id))).thenReturn(List.of(product));

        assertThat(service.balances(false))
                .singleElement()
                .satisfies(
                        balance -> {
                            assertThat(balance.reserved()).isEqualByComparingTo("0");
                            assertThat(balance.available()).isEqualByComparingTo("1");
                        });
    }

    @Test
    void normalSaleRejectsShortageEvenWhenEmployeeIsKnown() {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockMovementRepository movements = mock(StockMovementRepository.class);
        StockReservationRepository reservations = mock(StockReservationRepository.class);
        WarehouseService service =
                serviceWithReplay(
                        warehouses,
                        documents,
                        mock(StockDocumentVersionRepository.class),
                        mock(StockDocumentLineRepository.class),
                        movements,
                        mock(StockCostLayerRepository.class),
                        reservations,
                        mock(ProductRepository.class),
                        mock(OrderRepository.class),
                        mock(OrderItemRepository.class),
                        mock(UserRepository.class));

        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        Order order = new Order();
        order.id = UUID.randomUUID();
        order.orderNumberDate = java.time.LocalDate.of(2026, 9, 3);
        order.dailyNumber = 1;
        OrderItem item = new OrderItem();
        item.productId = 101L;
        item.quantity = quantity("2.000");
        order.items.add(item);

        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
        when(documents.findBySourceOrderIdAndDocumentType(order.id, StockDocumentType.SALE))
                .thenReturn(Optional.empty());
        when(movements.existsActiveByWarehouseIdAndProductId(warehouse.id, item.productId))
                .thenReturn(true);
        when(movements.balanceByProductId(warehouse.id, item.productId))
                .thenReturn(BigDecimal.ZERO);
        when(reservations.activeQuantityByProductId(warehouse.id, item.productId))
                .thenReturn(BigDecimal.ZERO);
        when(reservations.findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE))
                .thenReturn(List.of());

        assertThatThrownBy(() -> service.postOrderSale(order, 17L))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("Недостаточно товара на складе");
    }

    /** Stateful repositories exercise real FIFO replay across complete/reopen cycles. */
    private static class ReopenedSaleFixture {
        final WarehouseRepository warehouses = mock(WarehouseRepository.class);
        final StockDocumentRepository documents = mock(StockDocumentRepository.class);
        final StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        final StockMovementRepository movements = mock(StockMovementRepository.class);
        final StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
        final StockReservationRepository reservations = mock(StockReservationRepository.class);
        final OrderRepository orders = mock(OrderRepository.class);
        final Map<UUID, StockDocument> documentStore = new LinkedHashMap<>();
        final List<StockMovement> movementStore = new ArrayList<>();
        final List<StockDocumentLine> lineStore = new ArrayList<>();
        final Order order = new Order();
        final OrderItem item = new OrderItem();
        final StockDocument sale;
        final StockDocument automaticReturn;
        final StockDocument manualReturn;
        final WarehouseService service;

        ReopenedSaleFixture(String openingQuantity, String soldQuantity, String manualQuantity) {
            Warehouse warehouse = new Warehouse();
            warehouse.id = 1L;
            order.id = UUID.randomUUID();
            order.orderNumberDate = java.time.LocalDate.of(2026, 9, 3);
            order.dailyNumber = 1;
            item.id = 501L;
            item.order = order;
            item.productId = 101L;
            item.quantity = quantity(soldQuantity);
            item.unitPrice = money("120.00");
            order.items.add(item);
            service = serviceWithReplay(warehouses, documents,
                    mock(StockDocumentVersionRepository.class), lines, movements, layers,
                    reservations, mock(ProductRepository.class), orders,
                    mock(OrderItemRepository.class), mock(UserRepository.class));
            StockDocument opening = postedDocument(StockDocumentType.OPENING_BALANCE, null);
            sale = postedDocument(StockDocumentType.SALE, null);
            sale.sourceOrderId = order.id;
            manualReturn = manualQuantity == null ? null
                    : postedDocument(StockDocumentType.CUSTOMER_RETURN, "Возврат покупателя");
            automaticReturn = postedDocument(StockDocumentType.CUSTOMER_RETURN,
                    "Автоматическое поступление при отмене заказа");
            addMovement(opening, 101L, openingQuantity, "OPENING_BALANCE", 0);
            StockMovement oldSale = addMovement(sale, 101L, "-" + soldQuantity, "SALE", 1);
            oldSale.allowStockShortage = true;
            if (manualReturn != null) addReturn(manualReturn, quantity(manualQuantity), 2);
            addReturn(automaticReturn, quantity(soldQuantity)
                    .subtract(manualQuantity == null ? BigDecimal.ZERO : quantity(manualQuantity)), 3);

            when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
            when(warehouses.findActiveForUpdateById(1L)).thenReturn(Optional.of(warehouse));
            when(documents.findBySourceOrderIdAndDocumentType(order.id, StockDocumentType.SALE))
                    .thenReturn(Optional.of(sale));
            when(documents.findPostedCustomerReturnsBySourceOrderId(order.id)).thenAnswer(invocation ->
                    documentStore.values().stream()
                            .filter(document -> document.documentType == StockDocumentType.CUSTOMER_RETURN
                                    && document.status == StockDocumentStatus.POSTED).toList());
            when(documents.findForUpdateById(any(UUID.class))).thenAnswer(invocation ->
                    Optional.ofNullable(documentStore.get(invocation.getArgument(0))));
            when(documents.save(any(StockDocument.class))).thenAnswer(invocation -> {
                StockDocument document = invocation.getArgument(0);
                documentStore.put(document.id, document);
                return document;
            });
            when(movements.findByDocumentId(any(UUID.class))).thenAnswer(invocation ->
                    movementStore.stream().filter(movement ->
                            movement.documentId.equals(invocation.getArgument(0))).toList());
            when(movements.save(any(StockMovement.class))).thenAnswer(invocation -> {
                StockMovement movement = invocation.getArgument(0);
                movementStore.add(movement);
                return movement;
            });
            when(movements.existsActiveByWarehouseIdAndProductId(eq(1L), anyLong()))
                    .thenAnswer(invocation -> activeMovements().stream().anyMatch(movement ->
                            movement.productId.equals(invocation.getArgument(1))));
            when(movements.existsPostedOpeningBalanceByWarehouseIdAndProductId(eq(1L), anyLong()))
                    .thenReturn(true);
            when(movements.balanceByProductId(eq(1L), anyLong()))
                    .thenAnswer(invocation -> balance(invocation.getArgument(1)));
            // Do not invoke the generic replay Answer while replacing it: its nested mock
            // calls can capture the stubbing and omit the fixture's original ledger history.
            doAnswer(invocation -> movementStore.stream()
                    .filter(movement -> movement.productId.equals(invocation.getArgument(1)))
                    .map(movement -> new Object[] {movement, documentStore.get(movement.documentId)})
                    .toList()).when(movements).findLedgerHistory(eq(1L), anyLong());
            when(lines.save(any(StockDocumentLine.class))).thenAnswer(invocation -> {
                StockDocumentLine line = invocation.getArgument(0);
                line.id = (long) lineStore.size() + 1;
                lineStore.add(line);
                return line;
            });
            when(lines.findByDocumentIdOrderById(any(UUID.class))).thenAnswer(invocation ->
                    lineStore.stream().filter(line -> line.documentId.equals(invocation.getArgument(0)))
                            .toList());
            when(lines.postedQuantityBySourceOrderItemIds(eq(order.id), anySet(),
                    eq(StockDocumentType.CUSTOMER_RETURN), eq(StockDocumentStatus.POSTED)))
                    .thenAnswer(invocation -> {
                        BigDecimal returned = lineStore.stream().filter(line ->
                                documentStore.get(line.documentId).status == StockDocumentStatus.POSTED)
                                .map(line -> line.quantity).reduce(BigDecimal.ZERO, BigDecimal::add);
                        return returned.signum() == 0 ? List.of()
                                : List.<Object[]>of(new Object[] {item.id, returned});
                    });
            when(orders.findById(order.id)).thenReturn(Optional.of(order));
        }

        StockDocument postedDocument(StockDocumentType type, String comment) {
            StockDocument document = draft(UUID.randomUUID(), type, 1L);
            document.status = StockDocumentStatus.POSTED;
            document.comment = comment;
            documentStore.put(document.id, document);
            return document;
        }

        StockMovement addMovement(StockDocument document, Long productId, String amount,
                String type, int day) {
            StockMovement movement = movement(document.id, productId, amount);
            movement.warehouseId = 1L;
            movement.movementType = type;
            movement.unitCost = money("70.00");
            movement.originalUnitCost = movement.unitCost;
            movement.originalQuantity = movement.quantity;
            movement.occurredAt = Instant.parse("2026-09-01T08:00:00Z").plusSeconds(day * 86400L);
            movement.createdAt = movement.occurredAt;
            movementStore.add(movement);
            return movement;
        }

        void addReturn(StockDocument document, BigDecimal amount, int day) {
            document.sourceOrderId = order.id;
            StockDocumentLine line = line(document.id, item.productId, amount.toPlainString(), "70.00");
            line.id = (long) lineStore.size() + 1;
            line.sourceOrderItemId = item.id;
            lineStore.add(line);
            StockMovement movement = addMovement(document, item.productId, amount.toPlainString(),
                    "CUSTOMER_RETURN", day);
            movement.sourceLineId = line.id;
        }

        List<StockMovement> activeMovements() {
            Set<UUID> reversed = movementStore.stream().map(movement -> movement.reversesMovementId)
                    .filter(Objects::nonNull).collect(java.util.stream.Collectors.toSet());
            return movementStore.stream().filter(movement ->
                    documentStore.get(movement.documentId).status == StockDocumentStatus.POSTED
                            && movement.reversesMovementId == null && !reversed.contains(movement.id))
                    .toList();
        }

        BigDecimal balance(Long productId) {
            return activeMovements().stream().filter(movement -> productId.equals(movement.productId))
                    .map(movement -> movement.quantity).reduce(BigDecimal.ZERO, BigDecimal::add);
        }

        BigDecimal activeSaleQuantity(Long productId) {
            return activeMovements().stream().filter(movement -> movement.documentId.equals(sale.id)
                            && productId.equals(movement.productId))
                    .map(movement -> movement.quantity.negate()).reduce(BigDecimal.ZERO, BigDecimal::add);
        }
    }

    private static StockDocument draft(UUID id, StockDocumentType type, Long warehouseId) {
        StockDocument document = new StockDocument();
        document.id = id;
        document.documentType = type;
        document.status = StockDocumentStatus.DRAFT;
        document.warehouseId = warehouseId;
        return document;
    }

    private static WarehouseDto.DocumentRequest cleanIncomingPreviewRequest(Long productId) {
        return new WarehouseDto.DocumentRequest(
                StockDocumentType.PRICE_SETTING,
                StockDocumentPriceType.RETAIL,
                null,
                null,
                null,
                null,
                null,
                null,
                List.of(
                        new WarehouseDto.DocumentLineRequest(
                                productId,
                                quantity("1.000"),
                                null,
                                null,
                                null,
                                null,
                                null,
                                false,
                                null)),
                null,
                PriceSettingSourceType.CLEAN_INCOMING,
                null,
                null,
                PriceSettingOperation.COPY,
                null);
    }

    /** Wire the real derived-ledger and price services, with repository writes visible to replay. */
    private static WarehouseService serviceWithReplay(
            WarehouseRepository warehouses, StockDocumentRepository documents,
            StockDocumentVersionRepository versions, StockDocumentLineRepository lines,
            StockMovementRepository movements, StockCostLayerRepository layers,
            StockReservationRepository reservations, ProductRepository products,
            OrderRepository orders, OrderItemRepository orderItems, UserRepository users) {
        WarehouseService service = new WarehouseService(warehouses, documents, versions, lines,
                movements, layers, reservations, products, orders, orderItems, users);
        when(movements.save(any(StockMovement.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(layers.save(any(StockCostLayer.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(lines.save(any(StockDocumentLine.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(movements.findLedgerHistory(anyLong(), anyLong())).thenAnswer(invocation -> {
            Long warehouseId = invocation.getArgument(0);
            Long productId = invocation.getArgument(1);
            Map<UUID, Object[]> history = new LinkedHashMap<>();
            for (Object[] row : movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                    warehouseId, productId)) {
                history.put(((StockMovement) row[0]).id, row);
            }
            for (StockMovement movement : savedEntities(movements, StockMovement.class)) {
                if (!Objects.equals(movement.productId, productId)
                        || !Objects.equals(movement.warehouseId, warehouseId)) continue;
                StockDocument document = documents.findForUpdateById(movement.documentId)
                        .orElseGet(() -> savedEntities(documents, StockDocument.class).stream()
                                .filter(candidate -> candidate.id.equals(movement.documentId))
                                .findFirst().orElseThrow());
                history.put(movement.id, new Object[] {movement, document});
            }
            return new ArrayList<>(history.values());
        });
        when(layers.findByWarehouseIdAndProductId(anyLong(), anyLong())).thenAnswer(invocation -> {
            Long warehouseId = invocation.getArgument(0);
            Long productId = invocation.getArgument(1);
            List<StockCostLayer> result = new ArrayList<>(
                    layers.findByWarehouseIdAndProductIdOrderByCreatedAtAsc(warehouseId, productId));
            for (StockCostLayer layer : savedEntities(layers, StockCostLayer.class)) {
                if (Objects.equals(layer.warehouseId, warehouseId)
                        && Objects.equals(layer.productId, productId) && !result.contains(layer)) result.add(layer);
            }
            return result;
        });
        org.springframework.test.util.ReflectionTestUtils.setField(service, "ledgerReplay",
                new WarehouseLedgerReplayService(movements, layers, lines, orders,
                        mock(StockLedgerRevisionRepository.class)));
        WarehousePriceBaselineRepository baselines = mock(WarehousePriceBaselineRepository.class);
        Map<String, WarehousePriceBaseline> baselineStore = new HashMap<>();
        when(baselines.findByProductIdAndPriceType(anyLong(), any())).thenAnswer(invocation ->
                Optional.ofNullable(baselineStore.get(invocation.getArgument(0) + ":" + invocation.getArgument(1))));
        when(baselines.save(any(WarehousePriceBaseline.class))).thenAnswer(invocation -> {
            WarehousePriceBaseline baseline = invocation.getArgument(0);
            baselineStore.put(baseline.productId + ":" + baseline.priceType, baseline);
            return baseline;
        });
        org.springframework.test.util.ReflectionTestUtils.setField(service, "priceChronology",
                new WarehousePriceChronologyService(lines, baselines, mock(jakarta.persistence.EntityManager.class)));
        return service;
    }

    private static <T> List<T> savedEntities(Object repository, Class<T> type) {
        return mockingDetails(repository).getInvocations().stream()
                .filter(invocation -> invocation.getMethod().getName().equals("save"))
                .map(invocation -> type.cast(invocation.getArgument(0))).distinct().toList();
    }

    private static StockDocumentLine line(
            UUID documentId, Long productId, String quantity, String unitCost) {
        StockDocumentLine line = new StockDocumentLine();
        line.documentId = documentId;
        line.productId = productId;
        line.quantity = quantity(quantity);
        line.unitCost = unitCost == null ? null : money(unitCost);
        return line;
    }

    private static StockMovement movement(UUID documentId, Long productId, String quantity) {
        StockMovement movement = new StockMovement();
        movement.id = UUID.randomUUID();
        movement.documentId = documentId;
        movement.productId = productId;
        movement.quantity = quantity(quantity);
        movement.movementType = movement.quantity.signum() < 0 ? "SALE" : "RECEIPT";
        movement.occurredAt = Instant.now();
        return movement;
    }

    private static BigDecimal money(String value) {
        return new BigDecimal(value);
    }

    private static BigDecimal quantity(String value) {
        return new BigDecimal(value);
    }
}
