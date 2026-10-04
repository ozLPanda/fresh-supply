package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import java.math.BigDecimal;
import java.util.*;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.orders.repository.*;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.entity.*;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.repository.*;
import org.junit.jupiter.api.Test;

class PurchaseOrderTest {
    final WarehouseRepository warehouses = mock(WarehouseRepository.class);
    final StockDocumentRepository documents = mock(StockDocumentRepository.class);
    final StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
    final StockMovementRepository movements = mock(StockMovementRepository.class);
    final StockCostLayerRepository layers = mock(StockCostLayerRepository.class);
    final ProductRepository products = mock(ProductRepository.class);
    final WarehouseService service = new WarehouseService(warehouses, documents,
            mock(StockDocumentVersionRepository.class), lines, movements, layers,
            mock(StockReservationRepository.class), products, mock(OrderRepository.class),
            mock(OrderItemRepository.class), mock(UserRepository.class));
    final CurrentUser actor = new CurrentUser(7L, "admin@example.test", "Admin", null,
            Set.of(), true, BigDecimal.ZERO);

    StockDocument order() {
        StockDocument order = new StockDocument();
        order.id = UUID.randomUUID();
        order.warehouseId = 1L;
        order.documentType = StockDocumentType.PURCHASE_ORDER;
        when(documents.findByIdAndDeletedAtIsNull(order.id)).thenReturn(Optional.of(order));
        when(documents.findForUpdateById(order.id)).thenReturn(Optional.of(order));
        Product product = new Product();
        product.id = 1L;
        product.sku = "TEST";
        product.nameRu = "Товар";
        when(products.findByIdInAndDeletedAtIsNull(anySet())).thenReturn(List.of(product));
        StockDocumentLine line = new StockDocumentLine();
        line.productId = 1L;
        line.quantity = new BigDecimal("10");
        line.unitCost = new BigDecimal("100");
        when(lines.findByDocumentIdOrderById(order.id)).thenReturn(List.of(line));
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        when(warehouses.findActiveForUpdateById(1L)).thenReturn(Optional.of(warehouse));
        return order;
    }

    @Test void postingExpectedSupplyDoesNotChangeStockOrCosts() {
        StockDocument order = order();
        service.post(order.id, actor, true);
        assertThat(order.status).isEqualTo(StockDocumentStatus.POSTED);
        verify(movements).findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(1L, 1L);
        verifyNoMoreInteractions(movements);
        verifyNoInteractions(layers);
    }

    @Test void creatingPurchaseOrderRequiresCounterparty() {
        assertThatThrownBy(() -> service.createDraft(allocationRequest("1", List.of()), actor, true))
                .hasMessageContaining("укажите контрагента");
    }

    @Test void reorderCopiesOnlyRemainingQuantityAtOriginalCost() {
        StockDocument order = order();
        order.status = StockDocumentStatus.POSTED;
        order.documentNumber = "СКЛ-4";
        WarehouseService tested = spy(service);
        doReturn(new kz.company.shop.warehouse.dto.WarehouseDto.PurchaseOrderProgress(true, List.of(), List.of(
                new kz.company.shop.warehouse.dto.WarehouseDto.PurchaseOrderProgressLine(
                        1L, "TEST", "Товар", new BigDecimal("10"), new BigDecimal("7"), new BigDecimal("3")))))
                .when(tested).purchaseOrderProgress(order.id);
        doReturn(null).when(tested).createDraft(any(), eq(actor), eq(true));

        UUID selectedCounterpartyId = UUID.randomUUID();
        tested.createPurchaseOrderFromRemaining(order.id, selectedCounterpartyId, actor, true);

        var input = org.mockito.ArgumentCaptor.forClass(
                kz.company.shop.warehouse.dto.WarehouseDto.DocumentRequest.class);
        verify(tested).createDraft(input.capture(), eq(actor), eq(true));
        assertThat(input.getValue().type()).isEqualTo(StockDocumentType.PURCHASE_ORDER);
        assertThat(input.getValue().reference()).contains("СКЛ-4");
        assertThat(input.getValue().lines()).hasSize(1);
        assertThat(input.getValue().lines().getFirst().quantity()).isEqualByComparingTo("3");
        assertThat(input.getValue().lines().getFirst().unitCost()).isEqualByComparingTo("100");
        assertThat(input.getValue().counterpartyId()).isEqualTo(selectedCounterpartyId);
        verifyNoInteractions(movements, layers);
    }

    @Test void reorderRejectsMissingReceiptAndFullyReceivedOrder() {
        StockDocument order = order();
        order.status = StockDocumentStatus.POSTED;
        assertThatThrownBy(() -> service.createPurchaseOrderFromRemaining(order.id, UUID.randomUUID(), actor, true))
                .hasMessageContaining("Сначала оформите приход");
        WarehouseService tested = spy(service);
        doReturn(new kz.company.shop.warehouse.dto.WarehouseDto.PurchaseOrderProgress(true, List.of(), List.of(
                new kz.company.shop.warehouse.dto.WarehouseDto.PurchaseOrderProgressLine(
                        1L, "TEST", "Товар", BigDecimal.TEN, BigDecimal.TEN, BigDecimal.ZERO))))
                .when(tested).purchaseOrderProgress(order.id);
        assertThatThrownBy(() -> tested.createPurchaseOrderFromRemaining(order.id, UUID.randomUUID(), actor, true))
                .hasMessageContaining("Все товары заказа уже получены");
        verify(tested, never()).createDraft(any(), any(), anyBoolean());
    }

    @Test void progressCountsOnlyPostedReceiptsAndSupportsPartialDelivery() {
        StockDocument order = order();
        List<StockDocument> receipts = new ArrayList<>();
        for (StockDocumentStatus status : List.of(StockDocumentStatus.POSTED,
                StockDocumentStatus.POSTED, StockDocumentStatus.DRAFT, StockDocumentStatus.CANCELLED)) {
            StockDocument receipt = new StockDocument();
            receipt.id = UUID.randomUUID();
            receipt.documentType = StockDocumentType.RECEIPT;
            receipt.status = status;
            receipt.purchaseOrderId = order.id;
            receipts.add(receipt);
            StockDocumentLine line = new StockDocumentLine();
            line.productId = 1L;
            line.quantity = new BigDecimal("3");
            when(lines.findByDocumentIdOrderById(receipt.id)).thenReturn(List.of(line));
        }
        when(documents.findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(order.id)).thenReturn(receipts);
        var progress = service.purchaseOrderProgress(order.id);
        assertThat(progress.hasReceipts()).isTrue();
        assertThat(progress.lines().getFirst().received()).isEqualByComparingTo("6");
        assertThat(progress.lines().getFirst().remaining()).isEqualByComparingTo("4");
        receipts.getFirst().status = StockDocumentStatus.CANCELLED;
        assertThat(service.purchaseOrderProgress(order.id).lines().getFirst().remaining()).isEqualByComparingTo("7");
    }

    @Test void progressUnavailableBeforeFirstReceiptAndOrderCannotBeCancelledWithReceipt() {
        StockDocument order = order();
        assertThat(service.purchaseOrderProgress(order.id).hasReceipts()).isFalse();
        order.status = StockDocumentStatus.POSTED;
        StockDocument receipt = new StockDocument();
        receipt.status = StockDocumentStatus.DRAFT;
        when(documents.findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(order.id)).thenReturn(List.of(receipt));
        assertThatThrownBy(() -> service.cancel(order.id, actor, true))
                .hasMessageContaining("Сначала отмените или удалите связанные приходы");
    }

    @Test void savedDraftReservesRemainderAndQuantityReductionAndDeletionReleaseIt() {
        StockDocument source = order();
        source.status = StockDocumentStatus.POSTED;
        StockDocument target = order();
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        when(warehouses.findById(1L)).thenReturn(Optional.of(warehouse));
        StockDocument receipt = new StockDocument();
        receipt.id = UUID.randomUUID();
        receipt.status = StockDocumentStatus.POSTED;
        receipt.documentType = StockDocumentType.RECEIPT;
        StockDocumentLine received = new StockDocumentLine();
        received.productId = 1L;
        received.quantity = new BigDecimal("3");
        when(documents.findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(source.id)).thenReturn(List.of(receipt));
        when(lines.findByDocumentIdOrderById(receipt.id)).thenReturn(List.of(received));
        when(documents.allocatedQuantities(eq(source.id), any())).thenAnswer(invocation -> {
            if (target.deletedAt != null || target.status == StockDocumentStatus.CANCELLED
                    || target.id.equals(invocation.getArgument(1))) return List.of();
            return target.purchaseAllocations.stream().map(item -> new Object[]{ item.productId, item.quantity }).toList();
        });
        WarehouseDto.PurchaseAllocation allocation = new WarehouseDto.PurchaseAllocation(source.id, 1L, new BigDecimal("7"));
        service.updateDraft(target.id, allocationRequest("7", List.of(allocation)), actor, true);
        assertThat(service.purchaseOrderProgress(source.id).lines().getFirst().available()).isZero();
        assertThat(service.purchaseOrderProgress(source.id).lines().getFirst().transferred()).isEqualByComparingTo("7");

        service.updateDraft(target.id, allocationRequest("4", List.of(allocation)), actor, true);
        assertThat(target.purchaseAllocations.getFirst().quantity).isEqualByComparingTo("4");
        assertThat(service.purchaseOrderProgress(source.id).lines().getFirst().available()).isEqualByComparingTo("3");

        service.softDelete(target.id, actor);
        assertThat(service.purchaseOrderProgress(source.id).lines().getFirst().available()).isEqualByComparingTo("7");
        verifyNoInteractions(movements, layers);
    }

    @Test void cannotReserveAlreadyAllocatedQuantity() {
        StockDocument source = order();
        source.status = StockDocumentStatus.POSTED;
        StockDocument target = order();
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        when(warehouses.findById(1L)).thenReturn(Optional.of(warehouse));
        StockDocument receipt = new StockDocument();
        receipt.id = UUID.randomUUID();
        receipt.status = StockDocumentStatus.DRAFT;
        when(documents.findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(source.id)).thenReturn(List.of(receipt));
        when(documents.allocatedQuantities(eq(source.id), any())).thenReturn(
                Collections.singletonList(new Object[]{1L, new BigDecimal("8")}));
        assertThatThrownBy(() -> service.updateDraft(target.id, allocationRequest("3", List.of(
                new WarehouseDto.PurchaseAllocation(source.id, 1L, new BigDecimal("3")))), actor, true))
                .hasMessageContaining("Остаток исходного заказа изменился");
        assertThat(target.purchaseAllocations).isEmpty();
    }

    @Test void mergedProductAllocationsAreCappedAcrossAllSources() {
        StockDocument first = order();
        first.status = StockDocumentStatus.POSTED;
        StockDocument second = order();
        second.status = StockDocumentStatus.POSTED;
        StockDocument target = order();
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        when(warehouses.findById(1L)).thenReturn(Optional.of(warehouse));
        for (var source : List.of(first, second)) {
            StockDocument receipt = new StockDocument();
            receipt.status = StockDocumentStatus.DRAFT;
            when(documents.findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(source.id)).thenReturn(List.of(receipt));
        }
        service.updateDraft(target.id, allocationRequest("12", List.of(
                new WarehouseDto.PurchaseAllocation(first.id, 1L, new BigDecimal("10")),
                new WarehouseDto.PurchaseAllocation(second.id, 1L, new BigDecimal("10")))), actor, true);
        assertThat(target.purchaseAllocations).hasSize(2);
        assertThat(target.purchaseAllocations.get(0).quantity).isEqualByComparingTo("10");
        assertThat(target.purchaseAllocations.get(1).quantity).isEqualByComparingTo("2");
    }

    private WarehouseDto.DocumentRequest allocationRequest(String quantity, List<WarehouseDto.PurchaseAllocation> allocations) {
        return new WarehouseDto.DocumentRequest(StockDocumentType.PURCHASE_ORDER, null, 1L, null,
                null, null, null, null, List.of(new WarehouseDto.DocumentLineRequest(1L,
                        new BigDecimal(quantity), new BigDecimal("100"), null, null, null, null)),
                null, null, null, null, null, null, allocations);
    }
}
