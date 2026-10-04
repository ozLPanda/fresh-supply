package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.repository.OrderItemRepository;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.ai.AiPriceSessionRepository;
import kz.company.shop.warehouse.entity.PriceSettingGroup;
import kz.company.shop.warehouse.entity.StockDocument;
import kz.company.shop.warehouse.entity.StockDocumentStatus;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.repository.*;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class WarehousePriceSettingGroupBulkTest {
    private final PriceSettingGroupRepository groups = mock(PriceSettingGroupRepository.class);
    private final StockDocumentRepository documents = mock(StockDocumentRepository.class);
    private final WarehouseService service = spy(new WarehouseService(
            mock(WarehouseRepository.class), documents, mock(StockDocumentVersionRepository.class),
            mock(StockDocumentLineRepository.class), groups, mock(WarehouseCounterpartyRepository.class),
            mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
            mock(StockReservationRepository.class), mock(ProductRepository.class),
            mock(OrderRepository.class), mock(OrderItemRepository.class), mock(UserRepository.class),
            mock(AiPriceSessionRepository.class)));
    private final CurrentUser actor = new CurrentUser(7L, "admin@example.test", "Администратор",
            null, Set.of(), true, BigDecimal.ZERO);

    @Test
    void postsOnlyDraftAndCancelledDocumentsInBusinessOrder() {
        UUID groupId = UUID.randomUUID();
        StockDocument later = document(groupId, StockDocumentStatus.CANCELLED, 2);
        StockDocument posted = document(groupId, StockDocumentStatus.POSTED, 3);
        StockDocument earlier = document(groupId, StockDocumentStatus.DRAFT, 1);
        arrange(groupId, List.of(later, posted, earlier));
        doReturn(null).when(service).post(any(UUID.class), same(actor), eq(false));

        assertThat(service.postPriceSettingGroup(groupId, actor)).isEqualTo(2);

        InOrder order = inOrder(service);
        order.verify(service).post(earlier.id, actor, false);
        order.verify(service).post(later.id, actor, false);
        verify(service, never()).post(posted.id, actor, false);
    }

    @Test
    void cancelsOnlyPostedDocumentsFromNewestToOldest() {
        UUID groupId = UUID.randomUUID();
        StockDocument older = document(groupId, StockDocumentStatus.POSTED, 1);
        StockDocument draft = document(groupId, StockDocumentStatus.DRAFT, 2);
        StockDocument newer = document(groupId, StockDocumentStatus.POSTED, 3);
        arrange(groupId, List.of(older, draft, newer));
        doReturn(null).when(service).cancel(any(UUID.class), same(actor), eq(false));

        assertThat(service.cancelPriceSettingGroup(groupId, actor)).isEqualTo(2);

        InOrder order = inOrder(service);
        order.verify(service).cancel(newer.id, actor, false);
        order.verify(service).cancel(older.id, actor, false);
        verify(service, never()).cancel(draft.id, actor, false);
    }

    @Test
    void deletesEveryActiveDocumentFromNewestToOldest() {
        UUID groupId = UUID.randomUUID();
        StockDocument older = document(groupId, StockDocumentStatus.DRAFT, 1);
        StockDocument newer = document(groupId, StockDocumentStatus.POSTED, 2);
        arrange(groupId, List.of(older, newer));
        doNothing().when(service).softDelete(any(UUID.class), same(actor));

        assertThat(service.softDeletePriceSettingGroupDocuments(groupId, actor)).isEqualTo(2);

        InOrder order = inOrder(service);
        order.verify(service).softDelete(newer.id, actor);
        order.verify(service).softDelete(older.id, actor);
    }

    @Test
    void rejectsCorruptGroupMembershipBeforeChangingAnything() {
        UUID groupId = UUID.randomUUID();
        StockDocument price = document(groupId, StockDocumentStatus.DRAFT, 1);
        StockDocument receipt = document(groupId, StockDocumentStatus.DRAFT, 2);
        receipt.documentType = StockDocumentType.RECEIPT;
        arrange(groupId, List.of(price, receipt));

        assertThatThrownBy(() -> service.postPriceSettingGroup(groupId, actor))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("другого типа");
        verify(service, never()).post(any(UUID.class), any(), anyBoolean());
    }

    @Test
    void existingEmptyGroupIsNoOpButUnknownGroupIsNotFound() {
        UUID groupId = UUID.randomUUID();
        arrange(groupId, List.of());
        assertThat(service.postPriceSettingGroup(groupId, actor)).isZero();
        assertThat(service.cancelPriceSettingGroup(groupId, actor)).isZero();
        assertThat(service.softDeletePriceSettingGroupDocuments(groupId, actor)).isZero();

        assertThatThrownBy(() -> service.postPriceSettingGroup(UUID.randomUUID(), actor))
                .isInstanceOf(AppExceptions.NotFound.class);
    }

    private void arrange(UUID groupId, List<StockDocument> active) {
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = groupId;
        when(groups.findById(groupId)).thenReturn(Optional.of(group));
        when(documents.findActiveForUpdateByPriceSettingGroupId(groupId)).thenReturn(active);
    }

    private static StockDocument document(UUID groupId, StockDocumentStatus status, int day) {
        StockDocument document = new StockDocument();
        document.id = UUID.randomUUID();
        document.priceSettingGroupId = groupId;
        document.documentType = StockDocumentType.PRICE_SETTING;
        document.status = status;
        document.effectiveDate = LocalDate.of(2026, 9, day);
        return document;
    }
}
