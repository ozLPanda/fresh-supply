package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.repository.OrderItemRepository;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.ai.AiPriceSession;
import kz.company.shop.warehouse.ai.AiPriceSessionRepository;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.*;
import kz.company.shop.warehouse.repository.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

class WarehousePriceSettingGroupLifecycleTest {
    private final PriceSettingGroupRepository groups = mock(PriceSettingGroupRepository.class);
    private final StockDocumentRepository documents = mock(StockDocumentRepository.class);
    private final StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
    private final WarehouseRepository warehouses = mock(WarehouseRepository.class);
    private final AiPriceSessionRepository sessions = mock(AiPriceSessionRepository.class);
    private final Map<UUID, PriceSettingGroup> storedGroups = new LinkedHashMap<>();
    private final Map<UUID, StockDocument> storedDocuments = new LinkedHashMap<>();
    private final WarehouseService service = new WarehouseService(
            warehouses, documents, versions, mock(StockDocumentLineRepository.class), groups,
            mock(WarehouseCounterpartyRepository.class), mock(StockMovementRepository.class),
            mock(StockCostLayerRepository.class), mock(StockReservationRepository.class),
            mock(ProductRepository.class), mock(OrderRepository.class), mock(OrderItemRepository.class),
            mock(UserRepository.class), sessions);
    private final CurrentUser actor = new CurrentUser(7L, "admin@example.test", "Администратор",
            null, Set.of(), true, BigDecimal.ZERO);

    @BeforeEach
    void arrangeRepositories() {
        when(groups.findById(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(storedGroups.get(invocation.getArgument(0))));
        when(groups.findActiveForUpdate(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(storedGroups.get(invocation.getArgument(0)))
                        .filter(group -> group.deletedAt == null));
        when(documents.findById(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(storedDocuments.get(invocation.getArgument(0))));
        when(documents.findByIdAndDeletedAtIsNull(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(storedDocuments.get(invocation.getArgument(0)))
                        .filter(document -> document.deletedAt == null));
        when(documents.findForUpdateById(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(storedDocuments.get(invocation.getArgument(0)))
                        .filter(document -> document.deletedAt == null));
        when(documents.existsByPriceSettingGroupIdAndDeletedAtIsNull(any(UUID.class)))
                .thenAnswer(invocation -> storedDocuments.values().stream().anyMatch(document ->
                        document.deletedAt == null
                                && invocation.getArgument(0).equals(document.priceSettingGroupId)));
        when(documents.existsByAiPriceSettingGroupIdAndDeletedAtIsNull(any(UUID.class)))
                .thenAnswer(invocation -> storedDocuments.values().stream().anyMatch(document ->
                        document.deletedAt == null
                                && invocation.getArgument(0).equals(document.aiPriceSettingGroupId)));
    }

    @Test
    void deletingLastUnboundDocumentSoftDeletesGroupAndPreservesAuditRecords() {
        PriceSettingGroup group = group();
        StockDocument price = priceDocument(group);

        service.softDelete(price.id, actor);

        assertThat(price.deletedAt).isNotNull();
        assertThat(price.deletedByUserId).isEqualTo(actor.id());
        assertThat(group.deletedAt).isNotNull();
        assertThat(group.deletedByUserId).isEqualTo(actor.id());
        assertThat(price.priceSettingGroupId).isEqualTo(group.id);
        verify(groups).save(group);
        verify(versions).save(argThat(version -> "DELETE".equals(version.action)
                && price.id.equals(version.documentId) && actor.id().equals(version.changedByUserId)));
        verify(groups, never()).delete(any());
        verify(documents, never()).delete(any());
        InOrder order = inOrder(documents, groups);
        order.verify(documents).save(price);
        order.verify(documents).flush();
        order.verify(groups).findActiveForUpdate(group.id);
    }

    @Test
    void deletingDocumentKeepsGroupWhileAnotherDocumentRemains() {
        PriceSettingGroup group = group();
        StockDocument first = priceDocument(group);
        StockDocument second = priceDocument(group);

        service.softDelete(first.id, actor);

        assertThat(group.deletedAt).isNull();
        assertThat(second.deletedAt).isNull();
        verify(groups, never()).save(any());
    }

    @Test
    void deletingLastDocumentKeepsEmptyGroupSelectedByActiveReceipt() {
        PriceSettingGroup group = group();
        StockDocument price = priceDocument(group);
        receipt(group);

        service.softDelete(price.id, actor);

        assertThat(group.deletedAt).isNull();
        verify(groups, never()).save(any());
    }

    @Test
    void historicalAiSessionDoesNotProtectUnboundEmptyGroup() {
        PriceSettingGroup group = group();
        StockDocument price = priceDocument(group);
        when(sessions.existsByGroupId(group.id)).thenReturn(true);

        service.softDelete(price.id, actor);

        assertThat(group.deletedAt).isNotNull();
        verify(sessions, never()).existsByGroupId(any());
    }

    @Test
    void deletedReceiptBindingDoesNotProtectEmptyGroup() {
        PriceSettingGroup group = group();
        StockDocument price = priceDocument(group);
        receipt(group).deletedAt = Instant.now();

        service.softDelete(price.id, actor);

        assertThat(group.deletedAt).isNotNull();
    }

    @Test
    void deletingReceiptReleasesAndSoftDeletesItsSelectedEmptyGroup() {
        PriceSettingGroup group = group();
        StockDocument source = receipt(group);

        service.softDelete(source.id, actor);

        assertThat(source.deletedAt).isNotNull();
        assertThat(group.deletedAt).isNotNull();
        assertThat(source.aiPriceSettingGroupId).isEqualTo(group.id);
    }

    @Test
    void switchingSelectionDeletesFormerEmptyGroupAndKeepsNewSelection() {
        PriceSettingGroup oldGroup = group();
        PriceSettingGroup newGroup = group();
        StockDocument source = receipt(oldGroup);

        WarehouseDto.AiPriceGroupSelection selection = service.selectAiPriceGroup(source.id, newGroup.id, actor);

        assertThat(selection.groupId()).isEqualTo(newGroup.id);
        assertThat(source.aiPriceSettingGroupId).isEqualTo(newGroup.id);
        assertThat(oldGroup.deletedAt).isNotNull();
        assertThat(newGroup.deletedAt).isNull();
        verify(documents).saveAndFlush(source);
    }

    @Test
    void clearingSelectionDeletesFormerEmptyGroup() {
        PriceSettingGroup group = group();
        StockDocument source = receipt(group);

        WarehouseDto.AiPriceGroupSelection selection = service.selectAiPriceGroup(source.id, null, actor);

        assertThat(source.aiPriceSettingGroupId).isNull();
        assertThat(selection.groupId()).isNull();
        assertThat(selection.sessionId()).isNull();
        assertThat(group.deletedAt).isNotNull();
    }

    @Test
    void clearingOneReceiptSelectionKeepsGroupSelectedByAnotherReceipt() {
        PriceSettingGroup group = group();
        StockDocument first = receipt(group);
        StockDocument second = receipt(group);

        service.selectAiPriceGroup(first.id, null, actor);

        assertThat(group.deletedAt).isNull();
        assertThat(second.aiPriceSettingGroupId).isEqualTo(group.id);
    }

    @Test
    void clearingSelectionKeepsGroupContainingDocuments() {
        PriceSettingGroup group = group();
        StockDocument source = receipt(group);
        priceDocument(group);

        service.selectAiPriceGroup(source.id, null, actor);

        assertThat(group.deletedAt).isNull();
    }

    @Test
    void unselectedReceiptReturnsNoGroupOrSession() {
        StockDocument source = receipt(null);

        WarehouseDto.AiPriceGroupSelection selection = service.getAiPriceGroupSelection(source.id);

        assertThat(selection.groupId()).isNull();
        assertThat(selection.sessionId()).isNull();
        verifyNoInteractions(sessions);
    }

    @Test
    void incomingPriceDocumentUsesItsMembershipGroupAndCannotDetachIt() {
        PriceSettingGroup group = group();
        StockDocument source = priceDocument(group);
        source.priceType = StockDocumentPriceType.INCOMING;

        assertThat(service.getAiPriceGroupSelection(source.id).groupId()).isEqualTo(group.id);
        assertThat(service.selectAiPriceGroup(source.id, group.id, actor).groupId()).isEqualTo(group.id);
        assertThatThrownBy(() -> service.selectAiPriceGroup(source.id, null, actor))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThat(source.priceSettingGroupId).isEqualTo(group.id);
        assertThat(group.deletedAt).isNull();
    }

    @Test
    void deletingAllGroupDocumentsSoftDeletesUnboundGroup() {
        PriceSettingGroup group = group();
        StockDocument first = priceDocument(group);
        StockDocument second = priceDocument(group);
        when(documents.findActiveForUpdateByPriceSettingGroupId(group.id)).thenReturn(List.of(first, second));

        assertThat(service.softDeletePriceSettingGroupDocuments(group.id, actor)).isEqualTo(2);

        assertThat(first.deletedAt).isNotNull();
        assertThat(second.deletedAt).isNotNull();
        assertThat(group.deletedAt).isNotNull();
    }

    @Test
    void deletedGroupIsHiddenAndCannotBeSelectedOrUpdated() {
        PriceSettingGroup deleted = group();
        deleted.deletedAt = Instant.now();
        PriceSettingGroup active = group();
        StockDocument source = receipt(null);
        when(groups.findAllByOrderByUpdatedAtDesc()).thenReturn(List.of(deleted, active));

        assertThat(service.listPriceSettingGroups()).extracting(WarehouseDto.PriceSettingGroup::id)
                .containsExactly(active.id);
        assertThatThrownBy(() -> service.selectAiPriceGroup(source.id, deleted.id, actor))
                .isInstanceOf(AppExceptions.NotFound.class);
        assertThat(source.aiPriceSettingGroupId).isNull();
        assertThatThrownBy(() -> service.updatePriceSettingGroup(deleted.id,
                new WarehouseDto.PriceSettingGroupRequest("Новое название", null, null)))
                .isInstanceOf(AppExceptions.NotFound.class);
        verify(documents, never()).saveAndFlush(any());
    }

    @Test
    void cannotCreateDocumentInDeletedGroup() {
        PriceSettingGroup deleted = group();
        deleted.deletedAt = Instant.now();
        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));

        assertThatThrownBy(() -> service.createDraft(new WarehouseDto.DocumentRequest(
                StockDocumentType.PRICE_SETTING, StockDocumentPriceType.RETAIL, null, null,
                null, null, null, null, List.of(), deleted.id, null, null, null, null, null), actor, true))
                .isInstanceOf(AppExceptions.NotFound.class);
        verify(documents, never()).save(any());
    }

    @Test
    void stalePendingSessionIsNotRestoredButConfirmedSessionRemainsVisible() {
        PriceSettingGroup group = group();
        group.commonRules = "Новые правила";
        StockDocument source = receipt(group);
        AiPriceSession session = new AiPriceSession();
        session.id = UUID.randomUUID();
        session.status = "PREVIEW";
        session.groupRulesSnapshot = "Старые правила";
        session.sourceDocumentDate = source.effectiveDate;
        when(sessions.findFirstByReceiptIdAndGroupIdOrderByCreatedAtDesc(source.id, group.id))
                .thenReturn(Optional.of(session));

        assertThat(service.getAiPriceGroupSelection(source.id).sessionId()).isNull();

        session.status = "CONFIRMED";
        assertThat(service.getAiPriceGroupSelection(source.id).sessionId()).isEqualTo(session.id);
    }

    @Test
    void pendingSessionIsRestoredOnlyWhileSourceDateMatches() {
        PriceSettingGroup group = group();
        StockDocument source = receipt(group);
        AiPriceSession session = new AiPriceSession();
        session.id = UUID.randomUUID();
        session.status = "PREVIEW";
        session.groupRulesSnapshot = group.commonRules;
        session.sourceDocumentDate = source.effectiveDate;
        when(sessions.findFirstByReceiptIdAndGroupIdOrderByCreatedAtDesc(source.id, group.id))
                .thenReturn(Optional.of(session));

        assertThat(service.getAiPriceGroupSelection(source.id).sessionId()).isEqualTo(session.id);
        source.effectiveDate = source.effectiveDate.plusDays(1);
        assertThat(service.getAiPriceGroupSelection(source.id).sessionId()).isNull();
    }

    private PriceSettingGroup group() {
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = UUID.randomUUID();
        group.name = "Группа установки цен";
        storedGroups.put(group.id, group);
        return group;
    }

    private StockDocument priceDocument(PriceSettingGroup group) {
        StockDocument document = document(StockDocumentType.PRICE_SETTING);
        document.priceSettingGroupId = group.id;
        document.priceType = StockDocumentPriceType.RETAIL;
        return document;
    }

    private StockDocument receipt(PriceSettingGroup group) {
        StockDocument document = document(StockDocumentType.RECEIPT);
        document.aiPriceSettingGroupId = group == null ? null : group.id;
        return document;
    }

    private StockDocument document(StockDocumentType type) {
        StockDocument document = new StockDocument();
        document.id = UUID.randomUUID();
        document.documentType = type;
        document.status = StockDocumentStatus.DRAFT;
        document.effectiveDate = LocalDate.of(2026, 10, 2);
        storedDocuments.put(document.id, document);
        return document;
    }
}
