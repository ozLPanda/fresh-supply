package kz.company.shop.warehouse.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.repository.OrderItemRepository;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.ai.AiPriceSessionRepository;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.dto.WarehouseDto.DocumentLineRequest;
import kz.company.shop.warehouse.dto.WarehouseDto.DocumentRequest;
import kz.company.shop.warehouse.entity.*;
import kz.company.shop.warehouse.repository.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The warehouse ledger is intentionally internal. It only backs administrative endpoints and is
 * never joined into catalogue DTOs. Posting facts and cancellation links are immutable;
 * inventory adjustments and FIFO costs are recalculated with a separate revision audit.
 */
@Service
public class WarehouseService {
    private static final String AUTOMATIC_ORDER_RETURN_COMMENT =
            "Автоматическое поступление при отмене заказа";
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(3);
    private static final String DEFAULT_WAREHOUSE_CODE = "MAIN";
    private static final ZoneId ALMATY_ZONE = ZoneId.of("Asia/Almaty");
    private static final DateTimeFormatter CLEAN_INCOMING_DATE_FORMAT =
            DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<StockDocumentType> MANUAL_TYPES =
            Set.of(
                    StockDocumentType.OPENING_BALANCE,
                    StockDocumentType.RECEIPT,
                    StockDocumentType.PURCHASE_ORDER,
                    StockDocumentType.INVENTORY,
                    StockDocumentType.PRICE_SETTING,
                    StockDocumentType.CUSTOMER_RETURN);

    private record DocumentSnapshot(
            StockDocumentType type,
            StockDocumentStatus status,
            StockDocumentPriceType priceType,
            Long warehouseId,
            String reference,
            String comment,
            String priceRuleComment,
            UUID counterpartyId,
            String counterpartyName,
            String effectiveDate,
            String effectiveTime,
            UUID priceSettingGroupId,
            PriceSettingSourceType priceSourceType,
            StockDocumentPriceType priceSourcePriceType,
            UUID priceSourceDocumentId,
            PriceSettingOperation priceOperation,
            BigDecimal priceOperationValue,
            List<DocumentSnapshotLine> lines,
            List<WarehouseDto.PurchaseAllocation> purchaseAllocations) {}

    private record DocumentSnapshotLine(
            Long productId,
            String sku,
            String productName,
            BigDecimal quantity,
            BigDecimal unitCost,
            UUID sourceDocumentId,
            BigDecimal unitPrice,
            BigDecimal sourcePrice,
            String sourceDescription,
            PriceSettingOperation priceOperation,
            BigDecimal priceOperationValue,
            boolean manualPrice,
            String comment,
            String productGroupName) {}

    private record ResolvedPriceSource(
            BigDecimal price, UUID documentId, String description) {}

    private final WarehouseRepository warehouses;
    private final StockDocumentRepository documents;
    private final StockDocumentVersionRepository versions;
    private final StockDocumentLineRepository lines;
    private final PriceSettingGroupRepository priceSettingGroups;
    private final AiPriceSessionRepository aiPriceSessions;
    private final WarehouseCounterpartyRepository counterparties;
    private final StockMovementRepository movements;
    private final StockCostLayerRepository layers;
    private final StockReservationRepository reservations;
    private final ProductRepository products;
    private final OrderRepository orderRepository;
    private final OrderItemRepository orderItems;
    private final UserRepository users;
    @Autowired private WarehouseLedgerReplayService ledgerReplay;
    @Autowired private WarehousePriceChronologyService priceChronology;

    @Autowired
    public WarehouseService(
            WarehouseRepository warehouses,
            StockDocumentRepository documents,
            StockDocumentVersionRepository versions,
            StockDocumentLineRepository lines,
            PriceSettingGroupRepository priceSettingGroups,
            WarehouseCounterpartyRepository counterparties,
            StockMovementRepository movements,
            StockCostLayerRepository layers,
            StockReservationRepository reservations,
            ProductRepository products,
            OrderRepository orderRepository,
            OrderItemRepository orderItems,
            UserRepository users,
            AiPriceSessionRepository aiPriceSessions) {
        this.warehouses = warehouses;
        this.documents = documents;
        this.versions = versions;
        this.lines = lines;
        this.priceSettingGroups = priceSettingGroups;
        this.aiPriceSessions = aiPriceSessions;
        this.counterparties = counterparties;
        this.movements = movements;
        this.layers = layers;
        this.reservations = reservations;
        this.products = products;
        this.orderRepository = orderRepository;
        this.orderItems = orderItems;
        this.users = users;
    }

    /** Compatibility constructor for focused warehouse tests. */
    WarehouseService(
            WarehouseRepository warehouses,
            StockDocumentRepository documents,
            StockDocumentVersionRepository versions,
            StockDocumentLineRepository lines,
            PriceSettingGroupRepository priceSettingGroups,
            WarehouseCounterpartyRepository counterparties,
            StockMovementRepository movements,
            StockCostLayerRepository layers,
            StockReservationRepository reservations,
            ProductRepository products,
            OrderRepository orderRepository,
            OrderItemRepository orderItems,
            UserRepository users) {
        this(warehouses, documents, versions, lines, priceSettingGroups, counterparties,
                movements, layers, reservations, products, orderRepository, orderItems, users, null);
    }

    /** Compatibility constructor for focused warehouse tests that do not exercise price groups. */
    WarehouseService(
            WarehouseRepository warehouses,
            StockDocumentRepository documents,
            StockDocumentVersionRepository versions,
            StockDocumentLineRepository lines,
            StockMovementRepository movements,
            StockCostLayerRepository layers,
            StockReservationRepository reservations,
            ProductRepository products,
            OrderRepository orderRepository,
            OrderItemRepository orderItems,
            UserRepository users) {
        this(
                warehouses,
                documents,
                versions,
                lines,
                null,
                null,
                movements,
                layers,
                reservations,
                products,
                orderRepository,
                orderItems,
                users);
    }

    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public WarehouseLedgerReplayService.ReplayPreview previewLedger(Long productId) {
        if (!products.existsById(productId)) throw new AppExceptions.NotFound("Товар не найден");
        return ledgerReplay.preview(defaultWarehouse().id, productId);
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.Balance> balances(boolean includeCosts) {
        Warehouse warehouse = defaultWarehouse();
        Map<Long, BigDecimal> onHand = toQuantityMap(movements.balanceByWarehouseId(warehouse.id));
        Map<Long, BigDecimal> reserved =
                toQuantityMap(reservations.activeQuantityByWarehouseId(warehouse.id));
        Set<Long> productIds = new LinkedHashSet<>();
        productIds.addAll(onHand.keySet());
        productIds.addAll(reserved.keySet());
        Map<Long, BigDecimal> effectiveReserved =
                effectiveActiveReservations(warehouse.id, productIds);
        Map<Long, Product> productMap = productsById(productIds);
        return productIds.stream()
                .map(
                        productId -> {
                            Product product = productMap.get(productId);
                            if (product == null) return null;
                            BigDecimal total = onHand.getOrDefault(productId, ZERO);
                            BigDecimal held = effectiveReserved.getOrDefault(productId, ZERO);
                            return new WarehouseDto.Balance(
                                    product.id,
                                    product.sku,
                                    product.nameRu,
                                    total,
                                    held,
                                    total.subtract(held),
                                    includeCosts ? inventoryCost(warehouse.id, productId) : null);
                        })
                .filter(Objects::nonNull)
                .sorted(
                        Comparator.comparing(
                                WarehouseDto.Balance::productName, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.ProductPickerItem> productPicker(String search) {
        return products.findByDeletedAtIsNullOrderByNameRuAsc().stream()
                .filter(
                        product ->
                                ProductSearchTextNormalizer.matches(
                                        product.nameRu + " " + product.sku, search))
                .limit(50)
                .map(
                        product ->
                                new WarehouseDto.ProductPickerItem(
                                        product.id, product.sku, product.nameRu, product.active))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.StockShortageRelease> stockShortageReleases() {
        List<OrderItem> shortageItems = orderItems.findStockShortageReleases();
        Map<Long, String> employeeNames =
                users.findAllById(
                                shortageItems.stream()
                                        .map(item -> item.stockShortageReleasedByUserId)
                                        .filter(Objects::nonNull)
                                        .collect(Collectors.toSet()))
                        .stream()
                        .collect(Collectors.toMap(user -> user.id, user -> user.name));
        return shortageItems.stream()
                .map(
                        item ->
                                new WarehouseDto.StockShortageRelease(
                                        item.id,
                                        item.productId,
                                        item.sku,
                                        item.nameRu,
                                        item.stockShortageQuantity,
                                        item.order.id,
                                        item.order.displayCode(),
                                        item.order.status,
                                        item.stockShortageReleasedByUserId,
                                        employeeNames.get(item.stockShortageReleasedByUserId),
                                        item.stockShortageReleasedAt,
                                        item.stockShortageComment))
                .toList();
    }

    @Transactional(readOnly = true)
    public WarehouseDto.ProductReservations reservationsForProduct(Long productId) {
        Warehouse warehouse = defaultWarehouse();
        Product product = productsById(List.of(productId)).get(productId);
        if (product == null) throw new AppExceptions.NotFound("Товар не найден");
        List<WarehouseDto.ReservationOrder> reservationOrders =
                reservations
                        .findByWarehouseIdAndProductIdAndStatusOrderByCreatedAtDesc(
                                warehouse.id, productId, StockReservationStatus.ACTIVE)
                        .stream()
                        .map(
                                reservation ->
                                        orderRepository
                                                .findByIdAndDeletedAtIsNull(reservation.orderId)
                                                .map(
                                                        order ->
                                                                new WarehouseDto.ReservationOrder(
                                                                        reservation.id,
                                                                        order.id,
                                                                        order.displayCode(),
                                                                        order.status,
                                                                        reservation.quantity,
                                                                        reservation.createdAt))
                                                .orElse(null))
                        .filter(Objects::nonNull)
                        .toList();
        return new WarehouseDto.ProductReservations(
                product.id, product.sku, product.nameRu, reservationOrders);
    }

    @Transactional(readOnly = true)
    public WarehouseDto.ProductMovements movementsForProduct(Long productId) {
        Warehouse warehouse = defaultWarehouse();
        Product product = productsById(List.of(productId)).get(productId);
        if (product == null) throw new AppExceptions.NotFound("Товар не найден");

        BigDecimal balance = ZERO;
        List<WarehouseDto.ProductMovement> chronological = new ArrayList<>();
        for (Object[] row :
                movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                        warehouse.id, productId)) {
            StockMovement movement = (StockMovement) row[0];
            StockDocument document = (StockDocument) row[1];
            if ("OPENING_BALANCE".equals(movement.movementType)
                    && document.status == StockDocumentStatus.POSTED
                    && (document.cancelledAt == null
                            || movement.createdAt.isAfter(document.cancelledAt))) {
                balance = ZERO;
            }
            balance = balance.add(movement.quantity);
            chronological.add(
                    new WarehouseDto.ProductMovement(
                            movement.id,
                            document.id,
                            document.documentNumber,
                            document.documentType,
                            document.status,
                            document.sourceOrderId,
                            document.reference,
                            movement.movementType,
                            movement.quantity,
                            balance,
                            movement.occurredAt));
        }
        Collections.reverse(chronological);
        return new WarehouseDto.ProductMovements(
                product.id, product.sku, product.nameRu, chronological);
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.DocumentSummary> listDocuments() {
        return documents
                .findByWarehouseIdAndDeletedAtIsNullOrderByCreatedAtDesc(defaultWarehouse().id)
                .stream()
                .map(this::toSummary)
                .toList();
    }

    /** Posted price-setting documents available as an explicit price source for an order. */
    @Transactional(readOnly = true)
    public List<WarehouseDto.DocumentSummary> listPostedPriceSettingDocuments() {
        return documents
                .findByWarehouseIdAndDeletedAtIsNullOrderByCreatedAtDesc(defaultWarehouse().id)
                .stream()
                .filter(
                        document ->
                                document.documentType == StockDocumentType.PRICE_SETTING
                                        && document.status == StockDocumentStatus.POSTED)
                .map(this::toSummary)
                .toList();
    }

    /**
     * Gives an order a durable, view-only reference to the document that supplied its prices.
     * Soft-deleted documents deliberately remain addressable here for the audit trail.
     */
    @Transactional(readOnly = true)
    public WarehouseDto.PriceSettingDocumentReference priceSettingDocumentReference(UUID id) {
        if (id == null) return null;
        return documents
                .findById(id)
                .filter(document -> document.documentType == StockDocumentType.PRICE_SETTING)
                .map(
                        document ->
                                new WarehouseDto.PriceSettingDocumentReference(
                                        document.id,
                                        document.documentNumber,
                                        document.priceType,
                                        document.deletedAt))
                .orElse(null);
    }

    /** Returns frozen posted prices and refuses cancelled or soft-deleted sources. */
    @Transactional(readOnly = true)
    public Map<Long, BigDecimal> pricesFromPriceSettingDocument(UUID id, Set<Long> productIds) {
        StockDocument document = requiredDocument(id);
        if (document.documentType != StockDocumentType.PRICE_SETTING
                || document.status != StockDocumentStatus.POSTED) {
            throw new AppExceptions.BadRequest(
                    "Для актуализации можно выбрать только проведённый документ установки цен");
        }
        Map<Long, BigDecimal> prices =
                lines.findByDocumentIdOrderById(document.id).stream()
                        .collect(
                                Collectors.toMap(
                                        line -> line.productId,
                                        line -> wholePrice(line.unitPrice, "Цена документа"),
                                        (first, ignored) -> first,
                                        LinkedHashMap::new));
        List<Long> missing = productIds.stream().filter(productId -> !prices.containsKey(productId)).toList();
        if (!missing.isEmpty()) {
            throw new AppExceptions.BadRequest(
                    "В документе установки цен отсутствуют все позиции заказа");
        }
        return prices;
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.PriceSettingGroup> listPriceSettingGroups() {
        return priceSettingGroups.findAllByOrderByUpdatedAtDesc().stream()
                .filter(group -> group.deletedAt == null)
                .map(this::toPriceSettingGroupDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.Counterparty> listCounterparties(boolean includeArchived) {
        if (counterparties == null) return List.of();
        return counterparties.findAllByOrderByArchivedAscNameAsc().stream()
                .filter(counterparty -> includeArchived || !counterparty.archived)
                .map(WarehouseService::toCounterpartyDto)
                .toList();
    }

    @Transactional
    public WarehouseDto.Counterparty createCounterparty(WarehouseDto.CounterpartyRequest request) {
        WarehouseCounterparty counterparty = new WarehouseCounterparty();
        counterparty.id = UUID.randomUUID();
        applyCounterparty(counterparty, request);
        counterparties.save(counterparty);
        return toCounterpartyDto(counterparty);
    }

    @Transactional
    public WarehouseDto.Counterparty updateCounterparty(
            UUID id, WarehouseDto.CounterpartyRequest request) {
        WarehouseCounterparty counterparty = requiredCounterparty(id);
        applyCounterparty(counterparty, request);
        return toCounterpartyDto(counterparty);
    }

    @Transactional
    public WarehouseDto.PriceSettingGroup createPriceSettingGroup(
            WarehouseDto.PriceSettingGroupRequest request, CurrentUser actor) {
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = UUID.randomUUID();
        group.name = requiredText(request.name(), "Укажите название группы");
        group.commonRules = blankToNull(request.commonRules());
        group.comment = blankToNull(request.comment());
        group.createdByUserId = actor.id();
        priceSettingGroups.save(group);
        return toPriceSettingGroupDto(group);
    }

    @Transactional
    public WarehouseDto.PriceSettingGroup updatePriceSettingGroup(
            UUID id, WarehouseDto.PriceSettingGroupRequest request) {
        PriceSettingGroup group = requiredPriceSettingGroup(id);
        group.name = requiredText(request.name(), "Укажите название группы");
        group.commonRules = blankToNull(request.commonRules());
        group.comment = blankToNull(request.comment());
        return toPriceSettingGroupDto(group);
    }

    /** Applies the normal document posting checks to every draft or cancelled document in the group. */
    @Transactional
    public int postPriceSettingGroup(UUID id, CurrentUser actor) {
        List<StockDocument> groupDocuments = activePriceSettingGroupDocumentsForUpdate(id);
        groupDocuments.sort(WarehouseDocumentMoment.order());
        int changed = 0;
        for (StockDocument document : groupDocuments) {
            if (document.status == StockDocumentStatus.POSTED) continue;
            post(document.id, actor, false);
            changed++;
        }
        return changed;
    }

    /** Cancels only posted documents, newest first so price restoration follows reverse chronology. */
    @Transactional
    public int cancelPriceSettingGroup(UUID id, CurrentUser actor) {
        List<StockDocument> groupDocuments = activePriceSettingGroupDocumentsForUpdate(id);
        groupDocuments.sort(WarehouseDocumentMoment.order().reversed());
        int changed = 0;
        for (StockDocument document : groupDocuments) {
            if (document.status != StockDocumentStatus.POSTED) continue;
            cancel(document.id, actor, false);
            changed++;
        }
        return changed;
    }

    /** Soft-deletes all documents; the last deletion also hides an unbound empty group. */
    @Transactional
    public int softDeletePriceSettingGroupDocuments(UUID id, CurrentUser actor) {
        List<StockDocument> groupDocuments = activePriceSettingGroupDocumentsForUpdate(id);
        groupDocuments.sort(WarehouseDocumentMoment.order().reversed());
        for (StockDocument document : groupDocuments) softDelete(document.id, actor);
        softDeleteUnusedPriceSettingGroup(id, actor);
        return groupDocuments.size();
    }

    private List<StockDocument> activePriceSettingGroupDocumentsForUpdate(UUID id) {
        requiredPriceSettingGroup(id);
        List<StockDocument> groupDocuments =
                documents.findActiveForUpdateByPriceSettingGroupId(id);
        if (groupDocuments.stream().anyMatch(
                document -> document.documentType != StockDocumentType.PRICE_SETTING)) {
            throw new AppExceptions.BadRequest("Группа содержит документ другого типа");
        }
        return new ArrayList<>(groupDocuments);
    }

    @Transactional(readOnly = true)
    public WarehouseDto.AiPriceGroupSelection getAiPriceGroupSelection(UUID sourceId) {
        StockDocument source = requiredDocument(sourceId);
        validateAiPriceSelectionSource(source);
        UUID groupId = source.documentType == StockDocumentType.PRICE_SETTING
                ? source.priceSettingGroupId : source.aiPriceSettingGroupId;
        if (groupId == null) return new WarehouseDto.AiPriceGroupSelection(null, null);
        PriceSettingGroup group = requiredPriceSettingGroup(groupId);
        UUID sessionId = aiPriceSessions == null ? null : aiPriceSessions
                .findFirstByReceiptIdAndGroupIdOrderByCreatedAtDesc(sourceId, groupId)
                .filter(session -> "CONFIRMED".equals(session.status)
                        || Objects.equals(session.groupRulesSnapshot, group.commonRules)
                            && (session.sourceDocumentDate == null
                                || Objects.equals(session.sourceDocumentDate, source.effectiveDate != null
                                    ? source.effectiveDate : source.createdAt.atZone(java.time.ZoneId.of("Asia/Almaty")).toLocalDate())))
                .map(session -> session.id).orElse(null);
        return new WarehouseDto.AiPriceGroupSelection(groupId, sessionId);
    }

    @Transactional
    public WarehouseDto.AiPriceGroupSelection selectAiPriceGroup(
            UUID sourceId, UUID groupId, CurrentUser actor) {
        StockDocument source = documents.findForUpdateById(sourceId).orElseThrow(() -> notFound(sourceId));
        validateAiPriceSelectionSource(source);
        if (source.documentType == StockDocumentType.PRICE_SETTING) {
            if (!Objects.equals(groupId, source.priceSettingGroupId))
                throw new AppExceptions.BadRequest("Группа отличается от группы исходного документа");
            return getAiPriceGroupSelection(sourceId);
        }
        UUID previousId = source.aiPriceSettingGroupId;
        // Use a stable group lock order when two sources switch in opposite directions.
        java.util.stream.Stream.of(previousId, groupId).filter(Objects::nonNull).distinct().sorted()
                .forEach(this::lockedPriceSettingGroup);
        source.aiPriceSettingGroupId = groupId;
        documents.saveAndFlush(source);
        if (previousId != null && !Objects.equals(previousId, groupId))
            softDeleteUnusedPriceSettingGroup(previousId, actor);
        return getAiPriceGroupSelection(sourceId);
    }

    private static void validateAiPriceSelectionSource(StockDocument source) {
        if (source.deletedAt == null && (
                source.documentType == StockDocumentType.RECEIPT
                    && (source.status == StockDocumentStatus.DRAFT || source.status == StockDocumentStatus.POSTED)
                || source.documentType == StockDocumentType.PRICE_SETTING
                    && source.status == StockDocumentStatus.DRAFT
                    && source.priceType == StockDocumentPriceType.INCOMING
                    && source.priceSourceType == null && source.priceSettingGroupId != null)) return;
        throw new AppExceptions.BadRequest("Помощник ИИ недоступен для этого документа");
    }

    private PriceSettingGroup lockedPriceSettingGroup(UUID id) {
        return priceSettingGroups.findActiveForUpdate(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Группа установки цен не найдена"));
    }

    private void softDeleteUnusedPriceSettingGroup(UUID id, CurrentUser actor) {
        if (id == null) return;
        priceSettingGroups.findActiveForUpdate(id).ifPresent(group -> {
            if (!documents.existsByPriceSettingGroupIdAndDeletedAtIsNull(id)
                    && !documents.existsByAiPriceSettingGroupIdAndDeletedAtIsNull(id)) {
                group.deletedAt = Instant.now();
                group.deletedByUserId = actor.id();
                priceSettingGroups.save(group);
            }
        });
    }

    /**
     * Calculates a selected subset of a price-setting document without saving or posting anything.
     * The same rule resolver is used later when the draft is saved.
     */
    @Transactional(readOnly = true)
    public List<WarehouseDto.PriceSettingPreviewLine> previewPriceSetting(
            DocumentRequest request) {
        validateManualRequest(request);
        if (request.type() != StockDocumentType.PRICE_SETTING) {
            throw new AppExceptions.BadRequest("Предпросмотр доступен только для установки цен");
        }
        StockDocument document = new StockDocument();
        document.documentType = request.type();
        document.priceType = request.priceType();
        document.warehouseId = warehouse(request.warehouseId()).id;
        document.effectiveDate = documentDate(request);
        document.effectiveTime = documentTime(request);
        applyPriceSettingConfiguration(document, request);
        if (document.priceSourceType == null || document.priceOperation == PriceSettingOperation.MANUAL) {
            throw new AppExceptions.BadRequest("Выберите источник и правило автоматического расчёта");
        }
        Set<Long> productIds =
                request.lines().stream().map(DocumentLineRequest::productId).collect(Collectors.toSet());
        if (productIds.size() != request.lines().size()) {
            throw new AppExceptions.BadRequest("Товар можно указать в документе только один раз");
        }
        Map<Long, Product> productMap = productsById(productIds);
        if (productMap.size() != productIds.size()) {
            throw new AppExceptions.BadRequest("Один или несколько товаров не найдены");
        }
        return request.lines().stream()
                .map(
                        requestLine -> {
                            StockDocumentLine line = new StockDocumentLine();
                            line.productId = requestLine.productId();
                            populateRulePriceSettingLine(
                                    document,
                                    requestLine,
                                    line,
                                    productMap.get(requestLine.productId()));
                            return new WarehouseDto.PriceSettingPreviewLine(
                                    line.productId,
                                    line.unitPrice,
                                    line.sourcePrice,
                                    line.sourceDescription,
                                    line.priceOperation,
                                    line.priceOperationValue);
                        })
                .toList();
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.CleanIncomingPriceHistoryPoint> cleanIncomingPriceHistory(
            Long productId, boolean includeCosts) {
        if (!productsById(List.of(productId)).containsKey(productId)) {
            throw new AppExceptions.NotFound("Товар не найден");
        }
        return lines.findPostedReceiptHistory(productId).stream()
                .sorted(Comparator.comparing(row -> (StockDocument) row[1],
                        WarehouseDocumentMoment.order()))
                .map(row -> {
                    StockDocumentLine line = (StockDocumentLine) row[0];
                    StockDocument receipt = (StockDocument) row[1];
                    return new WarehouseDto.CleanIncomingPriceHistoryPoint(
                            WarehouseDocumentMoment.instant(receipt),
                            includeCosts ? line.unitCost : null, receipt.id, receipt.documentNumber);
                })
                .toList();
    }

    @Transactional(readOnly = true)
    public WarehouseDto.Document getDocument(UUID id, boolean includeCosts) {
        return toDto(viewableDocument(id), includeCosts);
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.DocumentVersion> documentHistory(UUID id, boolean includeCosts) {
        viewableDocument(id);
        List<StockDocumentVersion> documentVersions =
                versions.findByDocumentIdOrderByVersionNumberDesc(id);
        Map<Long, String> employeeNames =
                users.findAllById(
                                documentVersions.stream()
                                        .map(version -> version.changedByUserId)
                                        .filter(Objects::nonNull)
                                        .collect(Collectors.toSet()))
                        .stream()
                        .collect(Collectors.toMap(user -> user.id, user -> user.name));
        return documentVersions.stream()
                .map(version -> toVersionDto(version, employeeNames, includeCosts))
                .toList();
    }

    @Transactional(readOnly = true)
    public WarehouseDto.PurchaseOrderProgress purchaseOrderProgress(UUID id) {
        return purchaseOrderProgress(id, new UUID(0, 0));
    }

    private WarehouseDto.PurchaseOrderProgress purchaseOrderProgress(UUID id, UUID excludedId) {
        StockDocument order = requiredDocument(id);
        if (order.documentType != StockDocumentType.PURCHASE_ORDER) {
            throw new AppExceptions.BadRequest("Документ не является заказом поставщику");
        }
        List<StockDocument> receipts = documents.findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(id);
        Map<Long, BigDecimal> received = new LinkedHashMap<>();
        for (StockDocument receipt : receipts) {
            if (receipt.status != StockDocumentStatus.POSTED) continue;
            for (StockDocumentLine line : lines.findByDocumentIdOrderById(receipt.id)) {
                received.merge(line.productId, line.quantity, BigDecimal::add);
            }
        }
        List<StockDocumentLine> ordered = lines.findByDocumentIdOrderById(id);
        Map<Long, BigDecimal> transferred = new HashMap<>();
        for (Object[] row : documents.allocatedQuantities(id, excludedId)) {
            transferred.put((Long) row[0], (BigDecimal) row[1]);
        }
        Map<Long, Product> productMap = productsById(ordered.stream().map(line -> line.productId).toList());
        return new WarehouseDto.PurchaseOrderProgress(
                receipts.stream().anyMatch(receipt -> receipt.status != StockDocumentStatus.CANCELLED),
                receipts.stream().map(this::toSummary).toList(),
                ordered.stream().map(line -> {
                    Product product = productMap.get(line.productId);
                    BigDecimal actual = received.getOrDefault(line.productId, ZERO);
                    return new WarehouseDto.PurchaseOrderProgressLine(line.productId,
                            product == null ? "—" : product.sku,
                            product == null ? "Удалённый товар" : product.nameRu,
                            line.quantity, actual, line.quantity.subtract(actual).max(ZERO),
                            transferred.getOrDefault(line.productId, ZERO),
                            line.quantity.subtract(actual).subtract(transferred.getOrDefault(line.productId, ZERO)).max(ZERO));
                }).toList());
    }

    @Transactional
    public WarehouseDto.Document createReceiptFromPurchaseOrder(UUID id, CurrentUser actor, boolean includeCosts) {
        StockDocument order = documents.findForUpdateById(id).orElseThrow(() -> notFound(id));
        if (order.documentType != StockDocumentType.PURCHASE_ORDER || order.status != StockDocumentStatus.POSTED) {
            throw new AppExceptions.BadRequest("Сначала проведите заказ поставщику");
        }
        // Reuse an unfinished receipt so a double click cannot create duplicate drafts.
        Optional<StockDocument> existing = documents.findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(id)
                .stream().filter(item -> item.status == StockDocumentStatus.DRAFT).findFirst();
        if (existing.isPresent()) return toDto(existing.get(), includeCosts);
        Map<Long, BigDecimal> remaining = purchaseOrderProgress(id).lines().stream()
                .collect(Collectors.toMap(WarehouseDto.PurchaseOrderProgressLine::productId,
                        WarehouseDto.PurchaseOrderProgressLine::remaining));
        List<DocumentLineRequest> receiptLines = lines.findByDocumentIdOrderById(id).stream()
                .filter(line -> remaining.get(line.productId).signum() > 0)
                .map(line -> new DocumentLineRequest(line.productId, remaining.get(line.productId),
                        line.unitCost, null, null, null, line.comment)).toList();
        if (receiptLines.isEmpty()) throw new AppExceptions.BadRequest("Все товары заказа уже получены");
        return createDraft(new DocumentRequest(StockDocumentType.RECEIPT,
                null, order.warehouseId, null, "По заказу " + order.documentNumber,
                order.comment, null, null, receiptLines, null, null, null, null, null, null,
                null, order.counterpartyId, id), actor, includeCosts);
    }

    @Transactional
    public WarehouseDto.Document createPurchaseOrderFromRemaining(
            UUID id, UUID counterpartyId, CurrentUser actor, boolean includeCosts) {
        StockDocument order = documents.findForUpdateById(id).orElseThrow(() -> notFound(id));
        if (order.documentType != StockDocumentType.PURCHASE_ORDER || order.status != StockDocumentStatus.POSTED) {
            throw new AppExceptions.BadRequest("Заказ поставщику должен быть проведён");
        }
        WarehouseDto.PurchaseOrderProgress progress = purchaseOrderProgress(id);
        if (!progress.hasReceipts()) {
            throw new AppExceptions.BadRequest("Сначала оформите приход по заказу");
        }
        Map<Long, BigDecimal> remaining = progress.lines().stream()
                .collect(Collectors.toMap(WarehouseDto.PurchaseOrderProgressLine::productId,
                        WarehouseDto.PurchaseOrderProgressLine::available));
        List<DocumentLineRequest> requestedLines = lines.findByDocumentIdOrderById(id).stream()
                .filter(line -> remaining.get(line.productId).signum() > 0)
                .map(line -> new DocumentLineRequest(line.productId, remaining.get(line.productId),
                        line.unitCost, null, null, null, line.comment)).toList();
        if (requestedLines.isEmpty()) throw new AppExceptions.BadRequest("Все товары заказа уже получены или перенесены в другие заказы");
        WarehouseDto.Document created = createDraft(new DocumentRequest(StockDocumentType.PURCHASE_ORDER,
                null, order.warehouseId, null, "Неполученные товары по заказу " + order.documentNumber,
                order.comment, null, null, requestedLines, null, null, null, null, null, null,
                requestedLines.stream().map(line -> new WarehouseDto.PurchaseAllocation(id,
                        line.productId(), line.quantity())).toList(), counterpartyId), actor, includeCosts);
        if (created == null) return null;
        return created;
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.PurchaseOrderRemainder> availablePurchaseOrders(UUID excludedId, boolean includeCosts) {
        UUID excluded = excludedId == null ? new UUID(0, 0) : excludedId;
        List<WarehouseDto.PurchaseOrderRemainder> result = new ArrayList<>();
        for (StockDocument source : documents.findByWarehouseIdAndDeletedAtIsNullOrderByCreatedAtDesc(defaultWarehouse().id)) {
            if (source.documentType != StockDocumentType.PURCHASE_ORDER
                    || source.status != StockDocumentStatus.POSTED || source.id.equals(excluded)) continue;
            var progress = purchaseOrderProgress(source.id, excluded);
            if (!progress.hasReceipts()) continue;
            Map<Long, BigDecimal> costs = new HashMap<>();
            for (var line : lines.findByDocumentIdOrderById(source.id)) costs.put(line.productId, line.unitCost);
            var available = progress.lines().stream().filter(line -> line.available().signum() > 0)
                    .map(line -> new WarehouseDto.PurchaseOrderRemainderLine(line.productId(), line.sku(),
                            line.productName(), line.available(), includeCosts ? costs.get(line.productId()) : null)).toList();
            if (!available.isEmpty()) result.add(new WarehouseDto.PurchaseOrderRemainder(toSummary(source), available));
        }
        return result;
    }

    private List<WarehouseDto.PurchaseAllocation> allocationDtos(StockDocument document) {
        return document.purchaseAllocations.stream().map(allocation -> new WarehouseDto.PurchaseAllocation(
                allocation.sourceDocumentId, allocation.productId, allocation.quantity)).toList();
    }

    private void applyPurchaseAllocations(StockDocument document, DocumentRequest request) {
        List<WarehouseDto.PurchaseAllocation> requested = request.purchaseAllocations() == null
                ? allocationDtos(document) : request.purchaseAllocations();
        if (requested.isEmpty()) {
            document.purchaseAllocations.clear();
            return;
        }
        if (document.documentType != StockDocumentType.PURCHASE_ORDER) {
            throw new AppExceptions.BadRequest("Перенос остатка доступен только для заказа поставщику");
        }
        // Lock sources in a stable order: concurrent orders cannot claim the same remainder.
        Map<UUID, WarehouseDto.PurchaseOrderProgress> progress = new HashMap<>();
        for (UUID sourceId : requested.stream().map(WarehouseDto.PurchaseAllocation::sourceDocumentId)
                .distinct().sorted().toList()) {
            if (sourceId == null || sourceId.equals(document.id)) {
                throw new AppExceptions.BadRequest("Некорректный исходный заказ");
            }
            StockDocument source = documents.findForUpdateById(sourceId).orElseThrow(() -> notFound(sourceId));
            if (source.status != StockDocumentStatus.POSTED || source.documentType != StockDocumentType.PURCHASE_ORDER
                    || !Objects.equals(source.warehouseId, document.warehouseId)) {
                throw new AppExceptions.BadRequest("Выберите проведённый заказ того же склада");
            }
            var sourceProgress = purchaseOrderProgress(sourceId, document.id);
            if (!sourceProgress.hasReceipts()) throw new AppExceptions.BadRequest("По исходному заказу ещё нет прихода");
            progress.put(sourceId, sourceProgress);
        }
        Map<Long, BigDecimal> capacity = new HashMap<>();
        request.lines().forEach(line -> capacity.put(line.productId(), quantity(line.quantity())));
        Set<String> seen = new HashSet<>();
        List<PurchaseOrderAllocation> normalized = new ArrayList<>();
        for (var allocation : requested) {
            if (allocation.quantity() == null || allocation.quantity().signum() <= 0
                    || !seen.add(allocation.sourceDocumentId() + ":" + allocation.productId())) {
                throw new AppExceptions.BadRequest("Некорректное распределение остатков");
            }
            BigDecimal allocated = quantity(allocation.quantity()).min(capacity.getOrDefault(allocation.productId(), ZERO));
            if (allocated.signum() <= 0) continue;
            BigDecimal available = progress.get(allocation.sourceDocumentId()).lines().stream()
                    .filter(line -> line.productId().equals(allocation.productId()))
                    .map(WarehouseDto.PurchaseOrderProgressLine::available).findFirst().orElse(ZERO);
            if (allocated.compareTo(available) > 0) {
                throw new AppExceptions.BadRequest("Остаток исходного заказа изменился. Обновите подбор остатков");
            }
            normalized.add(new PurchaseOrderAllocation(allocation.sourceDocumentId(), allocation.productId(), allocated));
            capacity.compute(allocation.productId(), (key, value) -> value.subtract(allocated));
        }
        document.purchaseAllocations.clear();
        document.purchaseAllocations.addAll(normalized);
    }

    @Transactional
    public WarehouseDto.Document createDraft(
            DocumentRequest request, CurrentUser actor, boolean includeCosts) {
        validateManualRequest(request);
        if (request.priceSettingGroupId() != null) lockedPriceSettingGroup(request.priceSettingGroupId());
        if (request.type() == StockDocumentType.PURCHASE_ORDER && request.counterpartyId() == null) {
            throw new AppExceptions.BadRequest("Для заказа поставщику укажите контрагента");
        }
        Warehouse warehouse = warehouse(request.warehouseId());
        StockDocument document = new StockDocument();
        document.id = UUID.randomUUID();
        document.documentType = request.type();
        document.priceType = request.priceType();
        applyPriceSettingConfiguration(document, request);
        document.warehouseId = warehouse.id;
        Order sourceOrder = sourceOrderForRequest(request);
        document.sourceOrderId = sourceOrder == null ? null : sourceOrder.id;
        applyDocumentCounterparty(document, request);
        applyReceiptPurchaseOrder(document, request);
        document.reference =
                sourceOrder == null
                        ? receiptPurchaseOrderReference(document, request.reference())
                        : returnReference(sourceOrder);
        document.comment = blankToNull(request.comment());
        document.priceRuleComment = blankToNull(request.priceRuleComment());
        document.effectiveDate = documentDate(request);
        document.effectiveTime = documentTime(request);
        document.createdByUserId = actor.id();
        document.documentNumber = nextDocumentNumber();
        documents.save(document);
        replaceLines(document, request.lines(), sourceOrder);
        applyPurchaseAllocations(document, request);
        recordVersion(document, actor.id(), "CREATE", "Создан черновик", snapshot(document));
        return toDto(document, includeCosts);
    }

    @Transactional
    public WarehouseDto.Document updateDraft(
            UUID id, DocumentRequest request, CurrentUser actor, boolean includeCosts) {
        validateManualRequest(request);
        StockDocument document = documents.findForUpdateById(id).orElseThrow(() -> notFound(id));
        requireEditable(document);
        DocumentSnapshot before = snapshot(document);
        if (document.documentType != request.type()) {
            throw new AppExceptions.BadRequest("Тип черновика нельзя изменить");
        }
        document.priceType = request.priceType();
        if (request.priceSettingGroupId() != null) lockedPriceSettingGroup(request.priceSettingGroupId());
        applyPriceSettingConfiguration(document, request);
        Warehouse warehouse = warehouse(request.warehouseId());
        document.warehouseId = warehouse.id;
        Order sourceOrder = sourceOrderForUpdate(document, request);
        applyDocumentCounterparty(document, request);
        applyReceiptPurchaseOrder(document, request);
        document.reference =
                sourceOrder == null
                        ? receiptPurchaseOrderReference(document, request.reference())
                        : returnReference(sourceOrder);
        document.comment = blankToNull(request.comment());
        document.priceRuleComment = blankToNull(request.priceRuleComment());
        document.effectiveDate = documentDate(request);
        document.effectiveTime = documentTime(request);
        replaceLines(document, request.lines(), sourceOrder);
        applyPurchaseAllocations(document, request);
        DocumentSnapshot after = snapshot(document);
        String summary = changeSummary(before, after);
        if (summary != null) recordVersion(document, actor.id(), "UPDATE", summary, after);
        return toDto(document, includeCosts);
    }

    @Transactional
    public WarehouseDto.Document applyAiIncomingPrices(
            UUID id, Map<Long, BigDecimal> prices, CurrentUser actor) {
        StockDocument document = documents.findForUpdateById(id).orElseThrow(() -> notFound(id));
        if (document.deletedAt != null || document.status != StockDocumentStatus.DRAFT
                || document.documentType != StockDocumentType.PRICE_SETTING
                || document.priceType != StockDocumentPriceType.INCOMING
                || document.priceSourceType != null) {
            throw new AppExceptions.BadRequest("ИИ может изменить только черновик приходной цены");
        }
        List<StockDocumentLine> documentLines = lines.findByDocumentIdOrderById(id);
        Set<Long> productIds = documentLines.stream()
                .map(line -> line.productId).collect(Collectors.toSet());
        if (prices == null || prices.size() != documentLines.size()
                || !productIds.equals(prices.keySet())) {
            throw new AppExceptions.BadRequest("Состав документа установки цен изменился");
        }
        DocumentSnapshot before = snapshot(document);
        for (StockDocumentLine line : documentLines) {
            line.unitPrice = wholePrice(prices.get(line.productId), "Цена");
            line.manualPrice = true;
            line.priceOperation = PriceSettingOperation.MANUAL;
            line.priceOperationValue = null;
        }
        DocumentSnapshot after = snapshot(document);
        String summary = changeSummary(before, after);
        if (summary != null) recordVersion(document, actor.id(), "UPDATE", summary, after);
        return toDto(document, true);
    }

    /** Save and post exactly the submitted editor state in one transaction. */
    @Transactional
    public WarehouseDto.Document saveAndPost(
            UUID id, DocumentRequest request, CurrentUser actor, boolean includeCosts) {
        if (request.effectiveDate() == null || request.effectiveTime() == null) {
            throw new AppExceptions.BadRequest("Укажите дату и время документа перед проведением");
        }
        updateDraft(id, request, actor, includeCosts);
        return post(id, actor, includeCosts);
    }

    @Transactional
    public WarehouseDto.Document post(UUID id, CurrentUser actor, boolean includeCosts) {
        StockDocument document = documents.findForUpdateById(id).orElseThrow(() -> notFound(id));
        requireEditable(document);
        if (!MANUAL_TYPES.contains(document.documentType)) {
            throw new AppExceptions.BadRequest("Этот документ создаётся только системой");
        }
        ensureDocumentMoment(document);
        if (document.documentType == StockDocumentType.PRICE_SETTING) {
            return postPriceSetting(document, actor, includeCosts);
        }
        if (document.purchaseOrderId != null) {
            StockDocument purchaseOrder = documents.findForUpdateById(document.purchaseOrderId)
                    .orElseThrow(() -> notFound(document.purchaseOrderId));
            if (purchaseOrder.status != StockDocumentStatus.POSTED) {
                throw new AppExceptions.BadRequest("Заказ поставщику должен быть проведён");
            }
        }
        lockWarehouse(document.warehouseId);
        List<StockDocumentLine> documentLines = lines.findByDocumentIdOrderById(document.id);
        if (documentLines.isEmpty())
            throw new AppExceptions.BadRequest("Добавьте хотя бы одну позицию");
        if (document.documentType == StockDocumentType.CUSTOMER_RETURN) {
            validateAndHydrateCustomerReturnLines(document, documentLines, requiredReturnOrder(document));
        }
        Map<Long, Product> productMap =
                productsById(
                        documentLines.stream()
                                .map(line -> line.productId)
                                .collect(Collectors.toSet()));
        if (productMap.size()
                != documentLines.stream()
                        .map(line -> line.productId)
                        .collect(Collectors.toSet())
                        .size()) {
            throw new AppExceptions.BadRequest("Один или несколько товаров не найдены");
        }
        Map<Long, BigDecimal> heldBefore = effectiveActiveReservations(document.warehouseId,
                documentLines.stream().map(line -> line.productId).collect(Collectors.toSet()));
        Set<Long> backdatedInventories = document.documentType == StockDocumentType.INVENTORY
                ? documentLines.stream().map(line -> line.productId)
                        .filter(productId -> hasLaterMovements(document, productId)).collect(Collectors.toSet())
                : Set.of();
        int ignoredReturnLines = 0;
        Set<Long> productsNeedingCostReplay = new LinkedHashSet<>();
        for (StockDocumentLine line : documentLines) {
            if (document.documentType != StockDocumentType.PURCHASE_ORDER) {
                ensureNotBeforeLatestOpening(document, line.productId);
            }
            validateLine(
                    line.quantity,
                    line.unitCost,
                    document.documentType == StockDocumentType.OPENING_BALANCE
                            || document.documentType == StockDocumentType.INVENTORY);
            if (document.documentType == StockDocumentType.PURCHASE_ORDER) continue;
            if (document.documentType == StockDocumentType.CUSTOMER_RETURN
                    && !hasOpeningBalance(document.warehouseId, line.productId)) {
                ignoredReturnLines++;
                continue;
            }
            BigDecimal delta = document.documentType == StockDocumentType.INVENTORY
                    ? ZERO : line.quantity;
            BigDecimal cost = effectiveCost(line, productMap.get(line.productId));
            StockMovement movement = saveMovement(document, line.productId, delta, cost,
                    document.documentType.name());
            movement.sourceLineId = line.id;
            if (document.documentType == StockDocumentType.INVENTORY) {
                movement.inventoryQuantity = line.quantity;
            }
            productsNeedingCostReplay.add(line.productId);
        }
        document.status = StockDocumentStatus.POSTED;
        for (Long productId : productsNeedingCostReplay) {
            WarehouseLedgerReplayService.ReplayPreview replay = ledgerReplay.apply(
                    document.warehouseId, productId,
                    backdatedInventories.contains(productId) ? document.id : null);
            if (document.documentType == StockDocumentType.INVENTORY
                    && !backdatedInventories.contains(productId)
                    && replay.afterBalance().compareTo(heldBefore.getOrDefault(productId, ZERO)) < 0) {
                throw new AppExceptions.BadRequest("Недостаточно незарезервированного остатка для товара: " + productId);
            }
        }
        if (document.documentNumber == null) document.documentNumber = nextDocumentNumber();
        document.postedAt = Instant.now();
        document.postedByUserId = actor.id();
        String postSummary =
                ignoredReturnLines == 0
                        ? "Провёл документ"
                        : "Провёл документ; возврат по "
                                + ignoredReturnLines
                                + " поз. не изменил остатки: не введены начальные остатки";
        recordVersion(document, actor.id(), "POST", postSummary, snapshot(document));
        return toDto(document, includeCosts);
    }

    @Transactional
    public WarehouseDto.Document cancel(UUID id, CurrentUser actor, boolean includeCosts) {
        StockDocument document = documents.findForUpdateById(id).orElseThrow(() -> notFound(id));
        if (document.status != StockDocumentStatus.POSTED) {
            throw new AppExceptions.BadRequest("Отменить можно только проведённый документ");
        }
        if (document.documentType == StockDocumentType.PURCHASE_ORDER
                && !documents.allocatedQuantities(id, new UUID(0, 0)).isEmpty()) {
            throw new AppExceptions.BadRequest("Сначала отмените заказы, в которые перенесён остаток");
        }
        if (document.documentType == StockDocumentType.PURCHASE_ORDER
                && documents.findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(id).stream()
                    .anyMatch(item -> item.status != StockDocumentStatus.CANCELLED)) {
            throw new AppExceptions.BadRequest("Сначала отмените или удалите связанные приходы");
        }
        if (document.documentType == StockDocumentType.PRICE_SETTING) {
            return cancelPriceSetting(document, actor, includeCosts);
        }
        if (!MANUAL_TYPES.contains(document.documentType)) {
            throw new AppExceptions.BadRequest(
                    "Системный документ отменяется вместе с исходной операцией");
        }
        lockWarehouse(document.warehouseId);
        List<StockMovement> originalMovements = currentPostingMovements(document);
        Set<Long> affectedProducts = originalMovements.stream()
                .map(movement -> movement.productId).collect(Collectors.toCollection(LinkedHashSet::new));
        Map<Long, BigDecimal> heldBefore = effectiveActiveReservations(document.warehouseId, affectedProducts);
        for (StockMovement movement : originalMovements) reverseMovement(document, movement);
        document.status = StockDocumentStatus.CANCELLED;
        document.cancelledAt = Instant.now();
        document.cancelledByUserId = actor.id();
        for (Long productId : affectedProducts) {
            WarehouseLedgerReplayService.ReplayPreview replay = replayCostLayers(document.warehouseId, productId);
            if (replay.afterBalance().compareTo(heldBefore.getOrDefault(productId, ZERO)) < 0
                    && heldBefore.getOrDefault(productId, ZERO).signum() > 0) {
                throw new AppExceptions.BadRequest("Отмена затрагивает зарезервированный товар: " + productId);
            }
        }
        recordVersion(document, actor.id(), "CANCEL", "Отменил проведение", snapshot(document));
        return toDto(document, includeCosts);
    }

    /**
     * Restores a price only when this document still owns the current product-card value. A later
     * price setting must never be overwritten by cancellation of an older document.
     */
    private WarehouseDto.Document cancelPriceSetting(
            StockDocument document, CurrentUser actor, boolean includeCosts) {
        List<StockDocumentLine> documentLines = lines.findByDocumentIdOrderById(document.id);
        Map<Long, Product> productMap =
                productsById(
                        documentLines.stream()
                                .map(line -> line.productId)
                                .collect(Collectors.toSet()));
        int restored = priceChronology.cancelPrices(document, documentLines, productMap);
        document.status = StockDocumentStatus.CANCELLED;
        document.cancelledAt = Instant.now();
        document.cancelledByUserId = actor.id();
        String summary =
                restored == documentLines.size()
                        ? "Отменил установку цен и восстановил предыдущие значения"
                        : "Отменил установку цен; восстановлено позиций: "
                                + restored
                                + " из "
                                + documentLines.size();
        recordVersion(document, actor.id(), "CANCEL", summary, snapshot(document));
        return toDto(document, includeCosts);
    }

    /**
     * Keeps an audit trail but excludes the document and all of its movements from warehouse
     * calculations. A posted document is reversed first so it no longer affects stock.
     */
    @Transactional
    public void softDelete(UUID id, CurrentUser actor) {
        StockDocument document = documents.findForUpdateById(id).orElseThrow(() -> notFound(id));
        if (!MANUAL_TYPES.contains(document.documentType)) {
            throw new AppExceptions.BadRequest("Системный документ нельзя удалить вручную");
        }
        if (document.status == StockDocumentStatus.POSTED) {
            cancel(id, actor, false);
        }
        document.deletedAt = Instant.now();
        document.deletedByUserId = actor.id();
        recordVersion(document, actor.id(), "DELETE", "Удалил документ", snapshot(document));
        documents.save(document);
        documents.flush();
        java.util.stream.Stream.of(document.priceSettingGroupId, document.aiPriceSettingGroupId)
                .filter(Objects::nonNull).distinct().sorted()
                .forEach(groupId -> softDeleteUnusedPriceSettingGroup(groupId, actor));
    }

    /**
     * Soft-deletes every warehouse document generated for an order. Movements deliberately have
     * no separate deletion flag: every balance and movement-history query excludes movements
     * whose source document has {@code deletedAt}. Keeping the documents and movements intact
     * preserves the audit trail while removing their effect from stock calculations.
     */
    @Transactional
    public void softDeleteOrderDocuments(Order order, Long actorUserId) {
        if (order == null || order.id == null) return;
        Instant deletedAt = Instant.now();
        List<StockDocument> orderDocuments = documents.findActiveForUpdateBySourceOrderId(order.id);
        Map<Long, Set<Long>> affected = new TreeMap<>();
        for (StockDocument document : orderDocuments) {
            for (StockMovement movement : currentPostingMovements(document)) {
                affected.computeIfAbsent(movement.warehouseId, ignored -> new TreeSet<>())
                        .add(movement.productId);
            }
        }
        affected.keySet().forEach(this::lockWarehouse);
        for (StockDocument document : orderDocuments) {
            document.deletedAt = deletedAt;
            document.deletedByUserId = actorUserId;
            recordVersion(
                    document,
                    actorUserId,
                    "DELETE",
                    "Удалил складской документ вместе с заказом",
                    snapshot(document));
            documents.save(document);
        }
        for (Map.Entry<Long, Set<Long>> entry : affected.entrySet()) {
            for (Long productId : entry.getValue()) replayCostLayers(entry.getKey(), productId);
        }
    }

    /** Idempotently reserves stock for an order when the warehouse has been initialized. */
    @Transactional
    public void reserveOrder(Order order) {
        reserveOrder(order, false);
    }

    /**
     * Reserves the available part of an order when an authorised employee accepts a shortage.
     * The missing part is deliberately not persisted as stock, debt, or a negative movement.
     */
    @Transactional
    public void reserveOrder(Order order, boolean allowStockShortage) {
        if (order == null || order.items == null || order.items.isEmpty()) return;
        Warehouse warehouse = lockWarehouse(defaultWarehouse().id);
        Map<Long, BigDecimal> quantities = orderQuantities(order);
        if (quantities.isEmpty() || !hasAnyTrackedProduct(warehouse.id, quantities.keySet()))
            return;
        // The order composition can be edited while it is being processed. Rebuild the order's
        // reservation inside this transaction, so a repeated call reflects the current lines.
        releaseOrderReservations(order);
        for (Map.Entry<Long, BigDecimal> entry : quantities.entrySet()) {
            if (!movements.existsActiveByWarehouseIdAndProductId(warehouse.id, entry.getKey()))
                continue;
            BigDecimal available =
                    quantity(movements.balanceByProductId(warehouse.id, entry.getKey()))
                            .subtract(effectiveActiveReservationQuantity(warehouse.id, entry.getKey()))
                            .max(ZERO);
            if (available.compareTo(entry.getValue()) < 0) {
                if (!allowStockShortage) {
                    throw new AppExceptions.BadRequest(
                            "Недостаточно товара на складе: " + entry.getKey());
                }
            }
            BigDecimal reservedQuantity = entry.getValue().min(available);
            if (reservedQuantity.signum() <= 0) continue;
            StockReservation reservation = new StockReservation();
            reservation.id = UUID.randomUUID();
            reservation.warehouseId = warehouse.id;
            reservation.orderId = order.id;
            reservation.productId = entry.getKey();
            reservation.quantity = reservedQuantity;
            reservations.save(reservation);
        }
    }

    /**
     * Shrinks only the edited product's existing reservations after a decrease in order demand.
     * Preserve reservation dates: rebuilding them could capture stock received after the order.
     * A decrease neither needs new stock nor requires other order lines to be fully available.
     */
    @Transactional
    public void reduceOrderReservations(Order order, Long productId) {
        if (order == null || order.id == null || productId == null) return;
        lockWarehouse(defaultWarehouse().id);
        BigDecimal remaining = orderQuantities(order).getOrDefault(productId, ZERO);
        List<StockReservation> held = reservations
                .findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE).stream()
                .filter(reservation -> productId.equals(reservation.productId))
                .sorted(Comparator.comparing(reservation -> reservation.createdAt))
                .toList();
        for (StockReservation reservation : held) {
            BigDecimal retained = reservation.quantity.min(remaining);
            if (retained.signum() <= 0) {
                reservation.status = StockReservationStatus.RELEASED;
                reservation.releasedAt = Instant.now();
            } else if (retained.compareTo(reservation.quantity) < 0) {
                reservation.quantity = retained;
            }
            remaining = remaining.subtract(retained);
        }
    }

    /** Releases active reservations and can safely be called for an order without stock records. */
    @Transactional
    public void releaseOrderReservations(Order order) {
        if (order == null || order.id == null) return;
        for (StockReservation reservation :
                reservations.findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE)) {
            reservation.status = StockReservationStatus.RELEASED;
            reservation.releasedAt = Instant.now();
        }
    }

    /** Posts one internal sale document and consumes FIFO layers. It is idempotent per order. */
    @Transactional
    public void postOrderSale(Order order) {
        postOrderSale(order, null, null, false, false);
    }

    /** Posts one internal sale document and records the employee who completed the release. */
    @Transactional
    public void postOrderSale(Order order, Long postedByUserId) {
        postOrderSale(order, postedByUserId, null, false, false);
    }

    /** Replaces a previous release when completion follows an editable order status. */
    @Transactional
    public void postOrderSale(Order order, Long postedByUserId, boolean repostExistingSale) {
        postOrderSale(order, postedByUserId, null, false, repostExistingSale);
    }

    /** Allows a controlled release only for lines where the locked warehouse balance is short. */
    @Transactional
    public void postOrderSaleWithShortage(Order order, Long postedByUserId, String comment) {
        postOrderSaleWithShortage(order, postedByUserId, comment, false);
    }

    @Transactional
    public void postOrderSaleWithShortage(
            Order order, Long postedByUserId, String comment, boolean repostExistingSale) {
        if (!postOrderSale(order, postedByUserId, comment, true, repostExistingSale)) {
            throw new AppExceptions.BadRequest("В заказе нет позиций с недостаточным остатком");
        }
    }

    /**
     * Creates a posted customer-return document when a completed order is cancelled.
     *
     * <p>Only quantities actually recorded in the source sale are restored. This is deliberate:
     * completed legacy orders that predate the warehouse ledger must not manufacture a stock
     * balance on cancellation. Existing manual returns are subtracted, so this operation remains
     * safe if cancellation is retried or a partial return was already processed.</p>
     */
    @Transactional
    public boolean returnOrderSale(Order order, Long postedByUserId) {
        if (order == null || order.id == null || order.items == null || order.items.isEmpty()) {
            return false;
        }
        Warehouse warehouse = lockWarehouse(defaultWarehouse().id);
        StockDocument sale =
                documents
                        .findBySourceOrderIdAndDocumentType(order.id, StockDocumentType.SALE)
                        .orElse(null);
        if (sale == null || sale.status != StockDocumentStatus.POSTED || sale.deletedAt != null) {
            return false;
        }

        Map<Long, BigDecimal> soldByProduct = new LinkedHashMap<>();
        Map<Long, BigDecimal> saleCostByProduct = new HashMap<>();
        for (StockMovement movement : currentPostingMovements(sale)) {
            if (!StockDocumentType.SALE.name().equals(movement.movementType)
                    || movement.quantity == null || movement.quantity.signum() >= 0) continue;
            soldByProduct.merge(movement.productId, movement.quantity.abs(), BigDecimal::add);
            saleCostByProduct.putIfAbsent(movement.productId, movement.unitCost);
        }
        if (soldByProduct.isEmpty()) return false;

        Set<Long> sourceItemIds =
                order.items.stream()
                        .map(item -> item.id)
                        .filter(Objects::nonNull)
                        .collect(Collectors.toSet());
        Map<Long, BigDecimal> returnedByItem = new HashMap<>();
        if (!sourceItemIds.isEmpty()) {
            for (Object[] row :
                    lines.postedQuantityBySourceOrderItemIds(
                            order.id,
                            sourceItemIds,
                            StockDocumentType.CUSTOMER_RETURN,
                            StockDocumentStatus.POSTED)) {
                returnedByItem.put((Long) row[0], quantity((BigDecimal) row[1]));
            }
        }

        Map<Long, BigDecimal> returnedByProduct = new HashMap<>();
        for (OrderItem item : order.items) {
            if (item.id == null || item.productId == null) continue;
            returnedByProduct.merge(
                    item.productId, returnedByItem.getOrDefault(item.id, ZERO), BigDecimal::add);
        }
        Map<Long, BigDecimal> remainingByProduct = new LinkedHashMap<>();
        for (Map.Entry<Long, BigDecimal> sold : soldByProduct.entrySet()) {
            BigDecimal remaining =
                    quantity(sold.getValue()).subtract(returnedByProduct.getOrDefault(sold.getKey(), ZERO));
            if (remaining.signum() > 0) remainingByProduct.put(sold.getKey(), remaining);
        }
        if (remainingByProduct.isEmpty()) return false;

        StockDocument customerReturn = new StockDocument();
        customerReturn.id = UUID.randomUUID();
        customerReturn.documentType = StockDocumentType.CUSTOMER_RETURN;
        customerReturn.status = StockDocumentStatus.POSTED;
        customerReturn.warehouseId = warehouse.id;
        customerReturn.sourceOrderId = order.id;
        customerReturn.reference = returnReference(order);
        customerReturn.comment = AUTOMATIC_ORDER_RETURN_COMMENT;
        customerReturn.documentNumber = nextDocumentNumber();
        customerReturn.createdByUserId = postedByUserId;
        customerReturn.postedByUserId = postedByUserId;
        customerReturn.postedAt = Instant.now();

        List<StockDocumentLine> returnLines = new ArrayList<>();
        for (OrderItem item : order.items) {
            if (item.id == null || item.productId == null || item.quantity == null) continue;
            BigDecimal remainingForProduct = remainingByProduct.get(item.productId);
            if (remainingForProduct == null || remainingForProduct.signum() <= 0) continue;
            BigDecimal alreadyReturned = returnedByItem.getOrDefault(item.id, ZERO);
            BigDecimal availableFromLine = quantity(item.quantity).subtract(alreadyReturned);
            if (availableFromLine.signum() <= 0) continue;
            BigDecimal returnQuantity = availableFromLine.min(remainingForProduct);
            StockDocumentLine line = new StockDocumentLine();
            line.documentId = customerReturn.id;
            line.productId = item.productId;
            line.quantity = returnQuantity;
            line.unitCost = nullableMoney(saleCostByProduct.get(item.productId));
            line.sourceOrderItemId = item.id;
            line.unitPrice = nullableMoney(sourceSalePrice(item));
            line.comment = "Автоматически при отмене заказа";
            returnLines.add(line);
            remainingByProduct.put(item.productId, remainingForProduct.subtract(returnQuantity));
        }
        if (returnLines.isEmpty()) return false;

        documents.save(customerReturn);
        for (StockDocumentLine line : returnLines) {
            lines.save(line);
            if (!hasOpeningBalance(warehouse.id, line.productId)) continue;
            StockMovement movement = saveMovement(
                    customerReturn,
                    line.productId,
                    line.quantity,
                    line.unitCost,
                    StockDocumentType.CUSTOMER_RETURN.name());
            movement.sourceLineId = line.id;
        }
        for (Long productId : returnLines.stream().map(line -> line.productId)
                .collect(Collectors.toCollection(LinkedHashSet::new))) {
            replayCostLayers(warehouse.id, productId);
        }
        recordVersion(
                customerReturn,
                postedByUserId,
                "POST",
                "Автоматически провёл поступление при отмене заказа",
                snapshot(customerReturn));
        return true;
    }

    private boolean postOrderSale(
            Order order, Long postedByUserId, String shortageComment, boolean allowStockShortage,
            boolean repostExistingSale) {
        if (order == null || order.id == null || order.items == null || order.items.isEmpty())
            return false;
        // Serialise on the warehouse before checking the source order, otherwise two concurrent
        // completion calls could both observe an absent sale document.
        Warehouse warehouse = lockWarehouse(defaultWarehouse().id);
        StockDocument existingSale = documents
                .findBySourceOrderIdAndDocumentType(order.id, StockDocumentType.SALE)
                .orElse(null);
        if (existingSale != null) {
            return repostOrderSale(order, existingSale, warehouse, postedByUserId,
                    shortageComment, allowStockShortage, repostExistingSale);
        }
        Map<Long, BigDecimal> quantities = orderQuantities(order);
        if (quantities.isEmpty() || !hasAnyTrackedProduct(warehouse.id, quantities.keySet()))
            return false;
        StockDocument sale = new StockDocument();
        sale.id = UUID.randomUUID();
        sale.documentType = StockDocumentType.SALE;
        sale.status = StockDocumentStatus.POSTED;
        sale.warehouseId = warehouse.id;
        sale.sourceOrderId = order.id;
        sale.reference = "Заказ № " + order.displayCode();
        sale.documentNumber = nextDocumentNumber();
        sale.postedAt = Instant.now();
        sale.postedByUserId = postedByUserId;
        documents.save(sale);

        Map<Long, List<OrderItem>> orderItems =
                order.items.stream()
                        .filter(
                                item ->
                                        item.productId != null
                                                && item.quantity != null
                                                && item.quantity.signum() > 0)
                        .collect(Collectors.groupingBy(item -> item.productId));
        boolean shortageReleased = false;
        for (Map.Entry<Long, BigDecimal> entry : quantities.entrySet()) {
            Long productId = entry.getKey();
            if (!movements.existsActiveByWarehouseIdAndProductId(warehouse.id, productId)) continue;
            BigDecimal sellable = sellableForOrder(warehouse.id, order.id, productId);
            BigDecimal shortage = entry.getValue().subtract(sellable).max(ZERO);
            if (shortage.signum() > 0 && !allowStockShortage) {
                throw new AppExceptions.BadRequest("Недостаточно товара на складе: " + productId);
            }
            BigDecimal cost = null; // FIFO is calculated against the complete chronology below.
            StockMovement saleMovement = saveMovement(
                    sale,
                    productId,
                    entry.getValue().negate(),
                    cost,
                    StockDocumentType.SALE.name());
            saleMovement.allowStockShortage = allowStockShortage;
            List<OrderItem> productOrderItems = orderItems.getOrDefault(productId, List.of());
            for (OrderItem item : productOrderItems)
                item.incomingPrice = cost;
            if (shortage.signum() > 0) {
                shortageReleased = true;
                recordStockShortage(order, productId, shortage, postedByUserId, shortageComment);
            }
        }
        for (StockReservation reservation :
                reservations.findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE)) {
            reservation.status = StockReservationStatus.CONSUMED;
            reservation.releasedAt = Instant.now();
        }
        for (Long productId : quantities.keySet()) replayCostLayers(warehouse.id, productId);
        return shortageReleased;
    }

    private BigDecimal sellableForOrder(Long warehouseId, UUID orderId, Long productId) {
        BigDecimal ownHeld =
                reservations.findByOrderIdAndStatus(orderId, StockReservationStatus.ACTIVE).stream()
                        .filter(reservation -> reservation.productId.equals(productId))
                        .map(reservation -> reservation.quantity)
                        .reduce(ZERO, BigDecimal::add);
        return quantity(movements.balanceByProductId(warehouseId, productId))
                .subtract(effectiveActiveReservationQuantity(warehouseId, productId))
                .add(ownHeld);
    }

    private void recordStockShortage(
            Order order, Long productId, BigDecimal shortage, Long actorUserId, String comment) {
        BigDecimal remainingShortage = shortage;
        for (OrderItem item : order.items) {
            if (!productId.equals(item.productId)
                    || item.quantity == null
                    || item.quantity.signum() <= 0
                    || remainingShortage.signum() <= 0) continue;
            BigDecimal lineShortage = item.quantity.min(remainingShortage);
            item.stockShortageQuantity = lineShortage;
            item.stockShortageReleasedByUserId = actorUserId;
            item.stockShortageReleasedAt = Instant.now();
            item.stockShortageComment = blankToNull(comment);
            remainingShortage = remainingShortage.subtract(lineShortage);
        }
    }

    /** An existing warehouse sale allows edits to reserve the available part of a reopened order. */
    @Transactional(readOnly = true)
    public boolean hasRecordedOrderSale(Order order) {
        if (order == null || order.id == null) return false;
        return documents.findBySourceOrderIdAndDocumentType(order.id, StockDocumentType.SALE)
                .filter(sale -> sale.status == StockDocumentStatus.POSTED && sale.deletedAt == null)
                .isPresent();
    }

    /** Automatic return history survives deletion of a line from a reopened order. */
    @Transactional
    public void detachAutomaticReturnLines(Order order, Long itemId) {
        List<StockDocumentLine> linkedLines = lines.findBySourceOrderItemId(itemId);
        for (StockDocumentLine line : linkedLines) {
            StockDocument document = documents.findById(line.documentId)
                    .orElseThrow(() -> new AppExceptions.BadRequest(
                            "Не найден складской документ для позиции заказа"));
            if (document.documentType != StockDocumentType.CUSTOMER_RETURN
                    || !AUTOMATIC_ORDER_RETURN_COMMENT.equals(document.comment)
                    || !Objects.equals(document.sourceOrderId, order.id)) {
                throw new AppExceptions.BadRequest(
                        "Нельзя удалить позицию заказа, связанную с ручным возвратом покупателя");
            }
        }
        for (StockDocumentLine line : linkedLines) line.sourceOrderItemId = null;
        // Orphan removal may run before dirty updates; clear the FK before deleting the order item.
        if (!linkedLines.isEmpty()) lines.flush();
    }

    /** Reposts the edited order while retaining the sale history needed by manual returns. */
    private boolean repostOrderSale(
            Order order, StockDocument sale, Warehouse warehouse, Long actorUserId,
            String shortageComment, boolean allowStockShortage, boolean repostExistingSale) {
        List<StockDocument> customerReturns =
                documents.findPostedCustomerReturnsBySourceOrderId(order.id);
        List<StockDocument> automaticReturns = customerReturns.stream()
                .filter(document -> AUTOMATIC_ORDER_RETURN_COMMENT.equals(document.comment))
                .toList();
        // Retried completion must not validate or consume stock already sold by this order.
        if (automaticReturns.isEmpty() && !repostExistingSale) return false;

        List<StockMovement> previousSale = currentPostingMovements(sale).stream()
                .sorted(Comparator.comparing((StockMovement movement) -> movement.occurredAt)
                        .thenComparing(movement -> movement.createdAt)
                        .thenComparing(movement -> movement.id.toString()))
                .toList();
        Map<Long, BigDecimal> sold = new LinkedHashMap<>();
        for (StockMovement movement : previousSale) {
            if (movement.quantity.signum() < 0)
                sold.merge(movement.productId, movement.quantity.abs(), BigDecimal::add);
        }
        Map<Long, BigDecimal> manuallyReturned = new LinkedHashMap<>();
        for (StockDocument document : customerReturns) {
            if (AUTOMATIC_ORDER_RETURN_COMMENT.equals(document.comment)) continue;
            for (StockDocumentLine line : lines.findByDocumentIdOrderById(document.id)) {
                manuallyReturned.merge(line.productId, quantity(line.quantity), BigDecimal::add);
            }
        }
        Map<Long, BigDecimal> retainedSale = new LinkedHashMap<>();
        sold.forEach((productId, soldQuantity) -> retainedSale.put(productId,
                soldQuantity.min(manuallyReturned.getOrDefault(productId, ZERO))));
        Map<Long, BigDecimal> automaticallyReturned = new LinkedHashMap<>();
        for (StockDocument document : automaticReturns) {
            for (StockMovement movement : currentPostingMovements(document)) {
                automaticallyReturned.merge(movement.productId, movement.quantity, BigDecimal::add);
            }
        }
        Map<Long, BigDecimal> quantities = orderQuantities(order);
        Map<Long, BigDecimal> newSale = new LinkedHashMap<>();
        for (Map.Entry<Long, BigDecimal> entry : quantities.entrySet()) {
            if (!movements.existsActiveByWarehouseIdAndProductId(warehouse.id, entry.getKey()))
                continue;
            BigDecimal remaining = entry.getValue()
                    .subtract(retainedSale.getOrDefault(entry.getKey(), ZERO)).max(ZERO);
            if (remaining.signum() > 0) newSale.put(entry.getKey(), remaining);
        }
        boolean shortageReleased = false;
        for (OrderItem item : order.items) {
            item.stockShortageQuantity = ZERO;
            item.stockShortageReleasedByUserId = null;
            item.stockShortageReleasedAt = null;
            item.stockShortageComment = null;
        }
        for (Map.Entry<Long, BigDecimal> entry : newSale.entrySet()) {
            Long productId = entry.getKey();
            // Some historical automatic returns have no movement (no opening balance).
            // Account for the old sale's reversal before checking the new posting.
            BigDecimal sellable = sellableForOrder(warehouse.id, order.id, productId)
                    .add(sold.getOrDefault(productId, ZERO))
                    .subtract(automaticallyReturned.getOrDefault(productId, ZERO))
                    .subtract(retainedSale.getOrDefault(productId, ZERO));
            BigDecimal shortage = entry.getValue().subtract(sellable).max(ZERO);
            if (shortage.signum() > 0 && !allowStockShortage)
                throw new AppExceptions.BadRequest("Недостаточно товара на складе: " + productId);
            if (shortage.signum() > 0) {
                shortageReleased = true;
                recordStockShortage(order, productId, shortage, actorUserId, shortageComment);
            }
        }

        Set<Long> affectedProducts = new LinkedHashSet<>(sold.keySet());
        affectedProducts.addAll(newSale.keySet());
        affectedProducts.addAll(automaticallyReturned.keySet());
        for (StockMovement movement : previousSale) reverseMovement(sale, movement);
        for (StockDocument document : automaticReturns) {
            for (StockMovement movement : currentPostingMovements(document))
                reverseMovement(document, movement);
            document.status = StockDocumentStatus.CANCELLED;
            document.cancelledAt = Instant.now();
            document.cancelledByUserId = actorUserId;
            recordVersion(document, actorUserId, "CANCEL",
                    "Отменил автоматический возврат при повторном завершении заказа",
                    snapshot(document));
        }
        Map<Long, BigDecimal> toRetain = new HashMap<>(retainedSale);
        for (StockMovement original : previousSale) {
            BigDecimal retained = original.quantity.abs()
                    .min(toRetain.getOrDefault(original.productId, ZERO));
            if (retained.signum() <= 0) continue;
            StockMovement retainedMovement = saveMovement(sale, original.productId,
                    retained.negate(), original.unitCost, StockDocumentType.SALE.name());
            // Manual returns must stay after their source sale in the FIFO chronology.
            retainedMovement.occurredAt = original.occurredAt;
            retainedMovement.allowStockShortage = original.allowStockShortage;
            retainedMovement.reconciledShortageQuantity =
                    original.reconciledShortageQuantity.min(retained);
            toRetain.put(original.productId, toRetain.get(original.productId).subtract(retained));
        }
        for (Map.Entry<Long, BigDecimal> entry : newSale.entrySet()) {
            StockMovement movement = saveMovement(sale, entry.getKey(), entry.getValue().negate(),
                    null, StockDocumentType.SALE.name());
            movement.allowStockShortage = allowStockShortage;
        }
        sale.postedAt = Instant.now();
        sale.postedByUserId = actorUserId;
        for (StockReservation reservation :
                reservations.findByOrderIdAndStatus(order.id, StockReservationStatus.ACTIVE)) {
            reservation.status = StockReservationStatus.CONSUMED;
            reservation.releasedAt = Instant.now();
        }
        // Replay once the complete replacement is present, never an intermediate return state.
        for (Long productId : affectedProducts) replayCostLayers(warehouse.id, productId);
        return shortageReleased;
    }

    private void validateManualRequest(DocumentRequest request) {
        if (!MANUAL_TYPES.contains(request.type())) {
            throw new AppExceptions.BadRequest("Недопустимый тип складского документа");
        }
        if (request.type() != StockDocumentType.CUSTOMER_RETURN && request.sourceOrderId() != null) {
            throw new AppExceptions.BadRequest("Заказ можно указать только для возврата покупателя");
        }
        if (request.counterpartyId() != null
                && request.type() != StockDocumentType.RECEIPT
                && request.type() != StockDocumentType.PURCHASE_ORDER) {
            throw new AppExceptions.BadRequest(
                    "Контрагента можно указать только для прихода или заказа поставщику");
        }
        if (request.purchaseOrderId() != null && request.type() != StockDocumentType.RECEIPT) {
            throw new AppExceptions.BadRequest("Заказ поставщику можно связать только с приходом");
        }
        if (request.type() == StockDocumentType.PRICE_SETTING && request.priceType() == null) {
            throw new AppExceptions.BadRequest("Выберите тип цены");
        }
        if (request.type() != StockDocumentType.PRICE_SETTING && request.priceType() != null) {
            throw new AppExceptions.BadRequest("Тип цены указывается только в документе установки цен");
        }
        if (request.type() != StockDocumentType.PRICE_SETTING
                && (request.priceSettingGroupId() != null
                        || request.priceSourceType() != null
                        || request.priceSourcePriceType() != null
                        || request.priceSourceDocumentId() != null
                        || request.priceOperation() != null
                        || request.priceOperationValue() != null
                        || request.priceRuleComment() != null)) {
            throw new AppExceptions.BadRequest(
                    "Правила цены указываются только в документе установки цен");
        }
        if (request.type() == StockDocumentType.PRICE_SETTING
                && request.priceSourceType() == PriceSettingSourceType.PRICE_TYPE
                && request.priceSourcePriceType() == null) {
            throw new AppExceptions.BadRequest("Выберите тип цены для источника");
        }
        if (request.type() == StockDocumentType.PRICE_SETTING
                && request.priceSourceType() == PriceSettingSourceType.GROUP_DOCUMENT
                && (request.priceSettingGroupId() == null || request.priceSourceDocumentId() == null)) {
            throw new AppExceptions.BadRequest(
                    "Для источника «документ группы» выберите группу и документ");
        }
    }

    private void applyPriceSettingConfiguration(StockDocument document, DocumentRequest request) {
        if (document.documentType != StockDocumentType.PRICE_SETTING) {
            document.priceSettingGroupId = null;
            document.priceSourceType = null;
            document.priceSourcePriceType = null;
            document.priceSourceDocumentId = null;
            document.priceOperation = null;
            document.priceOperationValue = null;
            return;
        }
        if (request.priceSettingGroupId() != null) requiredPriceSettingGroup(request.priceSettingGroupId());
        document.priceSettingGroupId = request.priceSettingGroupId();
        document.priceSourceType = request.priceSourceType();
        document.priceSourcePriceType = request.priceSourcePriceType();
        document.priceSourceDocumentId = request.priceSourceDocumentId();
        document.priceOperation =
                request.priceSourceType() == null
                        ? PriceSettingOperation.MANUAL
                        : Optional.ofNullable(request.priceOperation()).orElse(PriceSettingOperation.COPY);
        document.priceOperationValue =
                document.priceOperation == PriceSettingOperation.PERCENT
                                || document.priceOperation == PriceSettingOperation.AMOUNT
                        ? nullableMoney(request.priceOperationValue())
                        : null;
        if ((document.priceOperation == PriceSettingOperation.PERCENT
                        || document.priceOperation == PriceSettingOperation.AMOUNT)
                && document.priceOperationValue == null) {
            throw new AppExceptions.BadRequest("Укажите значение правила цены");
        }
        if (document.priceSourceType == PriceSettingSourceType.GROUP_DOCUMENT) {
            StockDocument sourceDocument = requiredDocument(document.priceSourceDocumentId);
            if (sourceDocument.id.equals(document.id)
                    || sourceDocument.documentType != StockDocumentType.PRICE_SETTING
                    || sourceDocument.status != StockDocumentStatus.POSTED
                    || !Objects.equals(sourceDocument.priceSettingGroupId, document.priceSettingGroupId)) {
                throw new AppExceptions.BadRequest(
                        "Источником может быть только проведённый документ этой группы");
            }
        }
    }

    private LocalDate documentDate(DocumentRequest request) {
        return request.effectiveDate() == null ? LocalDate.now(ALMATY_ZONE) : request.effectiveDate();
    }

    private LocalTime documentTime(DocumentRequest request) {
        return request.effectiveTime() == null ? LocalTime.now(ALMATY_ZONE).withSecond(0).withNano(0) : request.effectiveTime();
    }

    private void ensureDocumentMoment(StockDocument document) {
        // Match the editor's displayed fallback for old drafts. Never move a document
        // to the time of this posting merely because its business moment was not stored.
        if (document.effectiveDate == null) {
            var created = document.createdAt.atZone(ALMATY_ZONE);
            document.effectiveDate = created.toLocalDate();
            document.effectiveTime = created.toLocalTime().withSecond(0).withNano(0);
        } else if (document.effectiveTime == null) {
            document.effectiveTime = LocalTime.MIDNIGHT;
        }
        if (documentMoment(document).isAfter(Instant.now())) {
            throw new AppExceptions.BadRequest("Дата и время документа не могут быть в будущем");
        }
    }

    private Instant documentMoment(StockDocument document) {
        return LocalDateTime.of(document.effectiveDate, document.effectiveTime)
                .atZone(ALMATY_ZONE)
                .toInstant();
    }

    private List<Object[]> activeHistory(StockDocument document, Long productId) {
        return movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                document.warehouseId, productId);
    }

    private void ensureNotBeforeLatestOpening(StockDocument document, Long productId) {
        Instant at = documentMoment(document);
        boolean laterOpening = activeHistory(document, productId).stream()
                .filter(row -> !((StockMovement) row[0]).documentId.equals(document.id))
                .anyMatch(row -> {
                    StockMovement movement = (StockMovement) row[0];
                    StockDocument source = (StockDocument) row[1];
                    return isCurrentOpening(movement, source) && movement.occurredAt.isAfter(at);
                });
        if (laterOpening) {
            throw new AppExceptions.BadRequest(
                    "Дата документа раньше действующего ввода начальных остатков для товара: "
                            + productId);
        }
    }

    private boolean hasLaterMovements(StockDocument document, Long productId) {
        Instant at = documentMoment(document);
        return activeHistory(document, productId).stream()
                .map(row -> (StockMovement) row[0])
                .anyMatch(movement -> !movement.documentId.equals(document.id)
                        && movement.occurredAt.isAfter(at));
    }

    private static boolean isCurrentOpening(StockMovement movement, StockDocument source) {
        return "OPENING_BALANCE".equals(movement.movementType)
                && source.documentType == StockDocumentType.OPENING_BALANCE
                && source.status == StockDocumentStatus.POSTED
                && (source.cancelledAt == null || movement.createdAt.isAfter(source.cancelledAt));
    }

    private void replaceLines(
            StockDocument document, List<DocumentLineRequest> requestedLines, Order sourceOrder) {
        if (document.documentType == StockDocumentType.CUSTOMER_RETURN) {
            replaceCustomerReturnLines(document, requestedLines, sourceOrder);
            return;
        }
        if (document.documentType == StockDocumentType.PRICE_SETTING) {
            replacePriceSettingLines(document, requestedLines);
            return;
        }
        Set<Long> productIds =
                requestedLines.stream()
                        .map(DocumentLineRequest::productId)
                        .collect(Collectors.toSet());
        if (productIds.size() != requestedLines.size()) {
            throw new AppExceptions.BadRequest("Товар можно указать в документе только один раз");
        }
        Map<Long, Product> availableProducts = productsById(productIds);
        if (availableProducts.size() != productIds.size()) {
            throw new AppExceptions.BadRequest("Один или несколько товаров не найдены");
        }
        lines.deleteByDocumentId(document.id);
        for (DocumentLineRequest requestLine : requestedLines) {
            validateLine(
                    requestLine.quantity(),
                    requestLine.unitCost(),
                    allowsZeroDraftQuantity(document.documentType));
            StockDocumentLine line = new StockDocumentLine();
            line.documentId = document.id;
            line.productId = requestLine.productId();
            line.quantity = requestLine.quantity().setScale(3, RoundingMode.HALF_UP);
            line.unitCost =
                    document.documentType == StockDocumentType.RECEIPT
                            ? receiptUnitCost(requestLine.unitCost())
                            : document.documentType == StockDocumentType.PURCHASE_ORDER
                                    ? wholePrice(requestLine.unitCost(), "Приходная цена")
                                    : nullableMoney(requestLine.unitCost());
            line.suggestedUnitCost =
                    document.documentType == StockDocumentType.PURCHASE_ORDER
                            ? nullableMoney(requestLine.suggestedUnitCost())
                            : null;
            line.comment = blankToNull(requestLine.comment());
            lines.save(line);
        }
    }

    private void replacePriceSettingLines(
            StockDocument document, List<DocumentLineRequest> requestedLines) {
        if (document.priceType == null) {
            throw new AppExceptions.BadRequest("Выберите тип цены");
        }
        Set<Long> productIds =
                requestedLines.stream()
                        .map(DocumentLineRequest::productId)
                        .collect(Collectors.toCollection(LinkedHashSet::new));
        if (productIds.size() != requestedLines.size()) {
            throw new AppExceptions.BadRequest("Товар можно указать в документе только один раз");
        }
        Map<Long, Product> availableProducts = productsById(productIds);
        if (availableProducts.size() != productIds.size()) {
            throw new AppExceptions.BadRequest("Один или несколько товаров не найдены");
        }
        List<StockDocumentLine> replacement = new ArrayList<>();
        for (DocumentLineRequest requestLine : requestedLines) {
            StockDocumentLine line = new StockDocumentLine();
            line.documentId = document.id;
            line.productId = requestLine.productId();
            line.comment = blankToNull(requestLine.comment());
            line.productGroupName = blankToNull(requestLine.productGroupName());

            if (document.priceSourceType == null) {
                populateLegacyPriceSettingLine(document, requestLine, line);
            } else {
                populateRulePriceSettingLine(document, requestLine, line, availableProducts.get(line.productId));
            }
            replacement.add(line);
        }
        lines.deleteByDocumentId(document.id);
        replacement.forEach(lines::save);
    }

    private void populateLegacyPriceSettingLine(
            StockDocument document, DocumentLineRequest requestLine, StockDocumentLine line) {
        StockDocument source =
                requestLine.sourceDocumentId() == null
                        ? null
                        : requiredActivePriceSource(requestLine.sourceDocumentId());
        if (source != null && !source.warehouseId.equals(document.warehouseId)) {
            throw new AppExceptions.BadRequest("Исходный документ должен относиться к тому же складу");
        }
        StockDocumentLine sourceLine =
                source == null
                        ? null
                        : lines.findByDocumentIdOrderById(source.id).stream()
                                .filter(item -> item.productId.equals(requestLine.productId()))
                                .findFirst()
                                .orElseThrow(
                                        () ->
                                                new AppExceptions.BadRequest(
                                                "Товар отсутствует в исходном документе"));
        if (sourceLine == null) validateLine(requestLine.quantity(), null);
        line.sourceDocumentId = source == null ? null : source.id;
        line.quantity = quantity(sourceLine == null ? requestLine.quantity() : sourceLine.quantity);
        line.unitCost = sourceLine == null ? null : nullableMoney(sourceLine.unitCost);
        line.unitPrice = wholePrice(requestLine.unitPrice(), "Цена");
        line.manualPrice = true;
        line.priceOperation = PriceSettingOperation.MANUAL;
    }

    private void populateRulePriceSettingLine(
            StockDocument document,
            DocumentLineRequest requestLine,
            StockDocumentLine line,
            Product product) {
        validateLine(requestLine.quantity(), null);
        ResolvedPriceSource source = resolvePriceSource(document, product);
        boolean manual = Boolean.TRUE.equals(requestLine.manualPrice())
                || document.priceOperation == PriceSettingOperation.MANUAL;
        line.quantity = quantity(requestLine.quantity());
        line.sourceDocumentId = source.documentId();
        line.sourcePrice = nullableMoney(source.price());
        line.sourceDescription = source.description();
        line.priceOperation = manual ? PriceSettingOperation.MANUAL : document.priceOperation;
        line.priceOperationValue = manual ? null : document.priceOperationValue;
        line.manualPrice = manual;
        line.unitPrice =
                manual
                        ? wholePrice(requestLine.unitPrice(), "Цена")
                        : applyPriceRule(source.price(), document.priceOperation, document.priceOperationValue);
    }

    private ResolvedPriceSource resolvePriceSource(StockDocument document, Product product) {
        return switch (document.priceSourceType) {
            case CLEAN_INCOMING -> resolveCleanIncomingPrice(document, product);
            case PRICE_TYPE -> {
                BigDecimal price = productPrice(product, document.priceSourcePriceType);
                if (price == null) {
                    throw new AppExceptions.BadRequest(
                            "У товара «" + product.nameRu + "» не указана исходная цена");
                }
                yield new ResolvedPriceSource(
                        price,
                        null,
                        "Цена типа: " + priceTypeName(document.priceSourcePriceType));
            }
            case GROUP_DOCUMENT -> resolveGroupDocumentPrice(document, product.id);
        };
    }

    private ResolvedPriceSource resolveCleanIncomingPrice(StockDocument document, Product product) {
        Instant at = WarehouseDocumentMoment.instant(document);
        Object[] source = lines.findPostedReceiptHistory(product.id).stream()
                .filter(row -> !WarehouseDocumentMoment.instant((StockDocument) row[1]).isAfter(at))
                .max(Comparator.comparing(row -> (StockDocument) row[1],
                        WarehouseDocumentMoment.order()))
                .orElse(null);
        StockDocumentLine receiptLine = source == null ? null : (StockDocumentLine) source[0];
        if (receiptLine == null) {
            if (product.incomingPrice == null) {
                throw new AppExceptions.BadRequest(
                        "У товара «"
                                + product.nameRu
                                + "» нет чистой приходной и приходной цены в карточке");
            }
            return new ResolvedPriceSource(
                    product.incomingPrice,
                    null,
                    "Приходная из карточки товара: "
                            + product.incomingPrice.setScale(0, RoundingMode.HALF_UP)
                            + " ₸");
        }
        StockDocument receipt = (StockDocument) source[1];
        String date = " · " + CLEAN_INCOMING_DATE_FORMAT.format(
                WarehouseDocumentMoment.instant(receipt).atZone(ALMATY_ZONE));
        return new ResolvedPriceSource(
                receiptLine.unitCost,
                receipt.id,
                "Чистая приходная: "
                        + receiptLine.unitCost.setScale(0, RoundingMode.HALF_UP)
                        + " ₸ · приход "
                        + (receipt.documentNumber == null ? "без номера" : receipt.documentNumber)
                        + date);
    }

    private ResolvedPriceSource resolveGroupDocumentPrice(StockDocument document, Long productId) {
        StockDocument sourceDocument = requiredDocument(document.priceSourceDocumentId);
        StockDocumentLine sourceLine =
                lines.findByDocumentIdOrderById(sourceDocument.id).stream()
                        .filter(line -> line.productId.equals(productId))
                        .findFirst()
                        .orElseThrow(
                                () ->
                                        new AppExceptions.BadRequest(
                                                "В документе-источнике нет выбранного товара"));
        return new ResolvedPriceSource(
                wholePrice(sourceLine.unitPrice, "Цена документа-источника"),
                sourceDocument.id,
                "Документ группы: "
                        + (sourceDocument.documentNumber == null
                                ? "черновик"
                                : sourceDocument.documentNumber));
    }

    private static BigDecimal applyPriceRule(
            BigDecimal sourcePrice, PriceSettingOperation operation, BigDecimal value) {
        BigDecimal calculated =
                switch (operation) {
                    case COPY -> sourcePrice;
                    case PERCENT -> sourcePrice.multiply(BigDecimal.ONE.add(value.movePointLeft(2)));
                    case AMOUNT -> sourcePrice.add(value);
                    case MANUAL -> throw new AppExceptions.BadRequest("Укажите цену вручную");
                };
        return wholePrice(calculated, "Результат правила цены");
    }

    private static BigDecimal productPrice(Product product, StockDocumentPriceType priceType) {
        if (priceType == null) return null;
        return switch (priceType) {
            case RETAIL -> product.price;
            case WHOLESALE -> product.wholesalePrice;
            case BULK_WHOLESALE -> product.bulkWholesalePrice;
            case SKO -> product.skoPrice;
            case GSKO -> product.gskoPrice;
            case INCOMING -> product.incomingPrice;
        };
    }

    private static String priceTypeName(StockDocumentPriceType priceType) {
        if (priceType == null) return "не указан";
        return switch (priceType) {
            case RETAIL -> "розничная";
            case WHOLESALE -> "оптовая";
            case BULK_WHOLESALE -> "крупно-оптовая";
            case SKO -> "СКО";
            case GSKO -> "ГСКО";
            case INCOMING -> "приходная";
        };
    }

    private StockDocument requiredActivePriceSource(UUID id) {
        if (id == null) throw new AppExceptions.BadRequest("Выберите исходный документ");
        StockDocument source = requiredDocument(id);
        boolean active = source.status == StockDocumentStatus.DRAFT
                || source.status == StockDocumentStatus.POSTED;
        boolean receipt = source.documentType == StockDocumentType.RECEIPT;
        boolean incomingPrices = source.documentType == StockDocumentType.PRICE_SETTING
                && source.priceType == StockDocumentPriceType.INCOMING;
        if (!active || (!receipt && !incomingPrices)) {
            throw new AppExceptions.BadRequest("Исходный документ цен или приход недоступен");
        }
        return source;
    }

    private WarehouseDto.Document postPriceSetting(
            StockDocument document, CurrentUser actor, boolean includeCosts) {
        if (document.priceType == null) throw new AppExceptions.BadRequest("Выберите тип цены");
        List<StockDocumentLine> documentLines = lines.findByDocumentIdOrderById(document.id);
        if (documentLines.isEmpty()) throw new AppExceptions.BadRequest("Добавьте хотя бы одну позицию");
        Map<Long, Product> productMap =
                productsById(
                        documentLines.stream()
                                .map(line -> line.productId)
                                .collect(Collectors.toSet()));
        if (productMap.size() != documentLines.size()) {
            throw new AppExceptions.BadRequest("Один или несколько товаров не найдены");
        }
        for (StockDocumentLine line : documentLines) {
            if (document.priceSourceType == null && line.sourceDocumentId != null) {
                StockDocument source = requiredActivePriceSource(line.sourceDocumentId);
                StockDocumentLine sourceLine = lines.findByDocumentIdOrderById(source.id).stream()
                        .filter(item -> item.productId.equals(line.productId))
                        .findFirst()
                        .orElseThrow(() -> new AppExceptions.BadRequest(
                                "Товар отсутствует в исходном документе"));
                boolean sameCost = line.unitCost == null && sourceLine.unitCost == null;
                if (line.unitCost != null && sourceLine.unitCost != null) {
                    sameCost = line.unitCost.compareTo(sourceLine.unitCost) == 0
                            || line.unitCost.compareTo(
                                    sourceLine.unitCost.setScale(2, RoundingMode.HALF_UP)) == 0;
                }
                if (line.quantity.compareTo(sourceLine.quantity) != 0
                        || !sameCost) {
                    throw new AppExceptions.BadRequest(
                            "Исходный документ изменился. Обновите документ установки цен");
                }
            }
            line.unitPrice = wholePrice(line.unitPrice, "Цена");
        }
        priceChronology.postPrices(document, documentLines, productMap);
        if (document.documentNumber == null) document.documentNumber = nextDocumentNumber();
        document.status = StockDocumentStatus.POSTED;
        document.postedAt = Instant.now();
        document.postedByUserId = actor.id();
        recordVersion(document, actor.id(), "POST", "Установил цены", snapshot(document));
        return toDto(document, includeCosts);
    }

    /**
     * A customer return reverses lines of one completed order. Product, sale price and cost are
     * reconstructed from the persisted order rather than accepted from the browser.
     */
    private void replaceCustomerReturnLines(
            StockDocument document, List<DocumentLineRequest> requestedLines, Order sourceOrder) {
        if (sourceOrder == null) {
            throw new AppExceptions.BadRequest("Для возврата укажите исходный заказ");
        }
        Set<Long> sourceItemIds =
                requestedLines.stream()
                        .map(DocumentLineRequest::sourceOrderItemId)
                        .filter(Objects::nonNull)
                        .collect(Collectors.toCollection(LinkedHashSet::new));
        if (sourceItemIds.size() != requestedLines.size()) {
            throw new AppExceptions.BadRequest("Каждая позиция возврата должна быть выбрана из заказа");
        }
        Map<Long, OrderItem> sourceItems = orderItemsById(sourceOrder);
        if (!sourceItems.keySet().containsAll(sourceItemIds)) {
            throw new AppExceptions.BadRequest("В возврате есть позиция, которой нет в исходном заказе");
        }

        List<StockDocumentLine> replacement = new ArrayList<>();
        for (DocumentLineRequest requestLine : requestedLines) {
            OrderItem sourceItem = sourceItems.get(requestLine.sourceOrderItemId());
            validateSourceItemProduct(sourceItem, requestLine.productId());
            validateLine(requestLine.quantity(), sourceItem.incomingPrice);
            StockDocumentLine line = new StockDocumentLine();
            line.documentId = document.id;
            line.productId = sourceItem.productId;
            line.sourceOrderItemId = sourceItem.id;
            line.quantity = requestLine.quantity().setScale(3, RoundingMode.HALF_UP);
            line.unitPrice = nullableMoney(sourceSalePrice(sourceItem));
            line.unitCost = nullableMoney(sourceItem.incomingPrice);
            line.comment = blankToNull(requestLine.comment());
            replacement.add(line);
        }
        validateCustomerReturnQuantities(document, sourceOrder, replacement);
        lines.deleteByDocumentId(document.id);
        replacement.forEach(lines::save);
    }

    private Order sourceOrderForRequest(DocumentRequest request) {
        if (request.type() != StockDocumentType.CUSTOMER_RETURN) return null;
        if (request.sourceOrderId() == null) {
            throw new AppExceptions.BadRequest("Возврат можно создать только из завершённого заказа");
        }
        return requiredCompletedOrder(request.sourceOrderId());
    }

    private Order sourceOrderForUpdate(StockDocument document, DocumentRequest request) {
        if (document.documentType != StockDocumentType.CUSTOMER_RETURN) return null;
        if (document.sourceOrderId == null) {
            throw new AppExceptions.BadRequest("У возврата не указан исходный заказ");
        }
        if (request.sourceOrderId() != null && !document.sourceOrderId.equals(request.sourceOrderId())) {
            throw new AppExceptions.BadRequest("Нельзя изменить исходный заказ возврата");
        }
        return requiredCompletedOrder(document.sourceOrderId);
    }

    private Order requiredReturnOrder(StockDocument document) {
        if (document.sourceOrderId == null) {
            throw new AppExceptions.BadRequest("У возврата не указан исходный заказ");
        }
        return requiredCompletedOrder(document.sourceOrderId);
    }

    private Order requiredCompletedOrder(UUID orderId) {
        Order order =
                orderRepository
                        .findWithItemsById(orderId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Исходный заказ не найден"));
        if (order.status != OrderStatus.COMPLETED) {
            throw new AppExceptions.BadRequest("Возврат можно оформить только по завершённому заказу");
        }
        return order;
    }

    private void validateAndHydrateCustomerReturnLines(
            StockDocument document, List<StockDocumentLine> documentLines, Order sourceOrder) {
        Map<Long, OrderItem> sourceItems = orderItemsById(sourceOrder);
        for (StockDocumentLine line : documentLines) {
            if (line.sourceOrderItemId == null) {
                throw new AppExceptions.BadRequest("У позиции возврата нет строки исходного заказа");
            }
            OrderItem sourceItem = sourceItems.get(line.sourceOrderItemId);
            if (sourceItem == null) {
                throw new AppExceptions.BadRequest("Строка возврата не найдена в исходном заказе");
            }
            validateSourceItemProduct(sourceItem, line.productId);
            validateLine(line.quantity, sourceItem.incomingPrice);
            line.unitPrice = nullableMoney(sourceSalePrice(sourceItem));
            line.unitCost = nullableMoney(sourceItem.incomingPrice);
        }
        validateCustomerReturnQuantities(document, sourceOrder, documentLines);
    }

    private void validateCustomerReturnQuantities(
            StockDocument document, Order sourceOrder, List<StockDocumentLine> returnLines) {
        Map<Long, BigDecimal> requestedBySourceItem =
                returnLines.stream()
                        .collect(
                                Collectors.groupingBy(
                                        line -> line.sourceOrderItemId,
                                        LinkedHashMap::new,
                                        Collectors.reducing(
                                                ZERO, line -> line.quantity, BigDecimal::add)));
        Map<Long, BigDecimal> alreadyReturned = new HashMap<>();
        for (Object[] row :
                lines.postedQuantityBySourceOrderItemIds(
                        sourceOrder.id,
                        requestedBySourceItem.keySet(),
                        StockDocumentType.CUSTOMER_RETURN,
                        StockDocumentStatus.POSTED)) {
            alreadyReturned.put((Long) row[0], quantity((BigDecimal) row[1]));
        }
        Map<Long, OrderItem> sourceItems = orderItemsById(sourceOrder);
        for (Map.Entry<Long, BigDecimal> entry : requestedBySourceItem.entrySet()) {
            OrderItem sourceItem = sourceItems.get(entry.getKey());
            if (sourceItem == null) {
                throw new AppExceptions.BadRequest("Строка возврата не найдена в исходном заказе");
            }
            BigDecimal remaining =
                    quantity(sourceItem.quantity).subtract(alreadyReturned.getOrDefault(entry.getKey(), ZERO));
            if (entry.getValue().compareTo(remaining) > 0) {
                throw new AppExceptions.BadRequest(
                        "Нельзя вернуть больше, чем было продано: " + sourceItem.nameRu);
            }
        }
    }

    private static Map<Long, OrderItem> orderItemsById(Order order) {
        return order.items.stream()
                .filter(item -> item.id != null)
                .collect(
                        Collectors.toMap(
                                item -> item.id, Function.identity(), (first, ignored) -> first));
    }

    private static void validateSourceItemProduct(OrderItem sourceItem, Long requestedProductId) {
        if (sourceItem.productId == null || !sourceItem.productId.equals(requestedProductId)) {
            throw new AppExceptions.BadRequest("Товар возврата не соответствует исходному заказу");
        }
    }

    private static BigDecimal sourceSalePrice(OrderItem sourceItem) {
        return sourceItem.confirmedUnitPrice != null
                ? sourceItem.confirmedUnitPrice
                : sourceItem.unitPrice;
    }

    private static String returnReference(Order order) {
        return "Возврат по заказу № " + order.displayCode();
    }

    private StockMovement saveMovement(
            StockDocument document,
            Long productId,
            BigDecimal quantity,
            BigDecimal unitCost,
            String movementType) {
        StockMovement movement = new StockMovement();
        movement.id = UUID.randomUUID();
        movement.warehouseId = document.warehouseId;
        movement.documentId = document.id;
        movement.productId = productId;
        movement.quantity = quantity.setScale(3, RoundingMode.HALF_UP);
        movement.unitCost = preciseUnitCost(unitCost);
        movement.movementType = movementType;
        if (document.effectiveDate != null
                && document.effectiveTime != null
                && movementType.equals(document.documentType.name())) {
            movement.occurredAt = documentMoment(document);
        }
        movement.originalQuantity = movement.quantity;
        movement.originalUnitCost = movement.unitCost;
        return movements.save(movement);
    }

    private void reverseMovement(StockDocument document, StockMovement original) {
        StockMovement reversal = saveMovement(document, original.productId,
                original.quantity.negate(), original.unitCost, "CANCEL_" + original.movementType);
        reversal.reversesMovementId = original.id;
        reversal.sourceLineId = original.sourceLineId;
        reversal.occurredAt = original.occurredAt;
    }

    private WarehouseLedgerReplayService.ReplayPreview replayCostLayers(Long warehouseId, Long productId) {
        return ledgerReplay.apply(warehouseId, productId);
    }

    private List<StockMovement> currentPostingMovements(StockDocument document) {
        // A cancelled document keeps its earlier postings and reversals for the audit trail.
        // cancelledAt is the boundary before the most recent posting cycle.
        List<StockMovement> documentMovements = movements.findByDocumentId(document.id);
        Set<UUID> reversed = documentMovements.stream()
                .map(movement -> movement.reversesMovementId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        return documentMovements.stream()
                .filter(movement -> movement.reversesMovementId == null
                        && !movement.movementType.startsWith("CANCEL_")
                        && !reversed.contains(movement.id))
                .filter(movement -> document.cancelledAt == null
                        || movement.createdAt.isAfter(document.cancelledAt))
                .toList();
    }

    private DocumentSnapshot snapshot(StockDocument document) {
        List<StockDocumentLine> documentLines = lines.findByDocumentIdOrderById(document.id);
        Map<Long, Product> productMap =
                productsById(
                        documentLines.stream()
                                .map(line -> line.productId)
                                .collect(Collectors.toSet()));
        return new DocumentSnapshot(
                document.documentType,
                document.status,
                document.priceType,
                document.warehouseId,
                document.reference,
                document.comment,
                document.priceRuleComment,
                document.counterpartyId,
                counterpartyName(document.counterpartyId),
                document.effectiveDate == null ? null : document.effectiveDate.toString(),
                document.effectiveTime == null ? null : document.effectiveTime.toString(),
                document.priceSettingGroupId,
                document.priceSourceType,
                document.priceSourcePriceType,
                document.priceSourceDocumentId,
                document.priceOperation,
                document.priceOperationValue,
                documentLines.stream()
                        .map(
                                line -> {
                                    Product product = productMap.get(line.productId);
                                    return new DocumentSnapshotLine(
                                            line.productId,
                                            product == null ? "—" : product.sku,
                                            product == null ? "Удалённый товар" : product.nameRu,
                                            line.quantity,
                                            line.unitCost,
                                            line.sourceDocumentId,
                                            line.unitPrice,
                                            line.sourcePrice,
                                            line.sourceDescription,
                                            line.priceOperation,
                                            line.priceOperationValue,
                                            line.manualPrice,
                                            line.comment,
                                            line.productGroupName);
                                })
                        .toList(), allocationDtos(document));
    }

    private void recordVersion(
            StockDocument document,
            Long actorUserId,
            String action,
            String changeSummary,
            DocumentSnapshot snapshot) {
        StockDocumentVersion version = new StockDocumentVersion();
        version.documentId = document.id;
        version.versionNumber =
                versions.findTopByDocumentIdOrderByVersionNumberDesc(document.id)
                        .map(previous -> previous.versionNumber + 1)
                        .orElse(1);
        version.action = action;
        version.changeSummary = changeSummary;
        version.snapshotJson = writeSnapshot(snapshot);
        version.changedByUserId = actorUserId;
        versions.save(version);
    }

    private WarehouseDto.DocumentVersion toVersionDto(
            StockDocumentVersion version, Map<Long, String> employeeNames, boolean includeCosts) {
        DocumentSnapshot snapshot = readSnapshot(version.snapshotJson);
        List<WarehouseDto.DocumentLine> snapshotLines =
                snapshot.lines().stream()
                        .map(
                                line ->
                                        new WarehouseDto.DocumentLine(
                                                null,
                                                line.productId(),
                                                line.sku(),
                                                line.productName(),
                                                line.quantity(),
                                                includeCosts ? line.unitCost() : null,
                                                null,
                                                null,
                                                line.sourceDocumentId(),
                                                line.unitPrice(),
                                                line.comment(),
                                                line.sourcePrice(),
                                                line.sourceDescription(),
                                                line.priceOperation(),
                                                line.priceOperationValue(),
                                                line.manualPrice(),
                                                line.productGroupName()))
                        .toList();
        return new WarehouseDto.DocumentVersion(
                version.id,
                version.versionNumber,
                version.action,
                version.changeSummary,
                version.changedByUserId,
                employeeNames.get(version.changedByUserId),
                version.createdAt,
                new WarehouseDto.DocumentVersionSnapshot(
                        snapshot.type(),
                        snapshot.status(),
                        snapshot.priceType(),
                        snapshot.warehouseId(),
                        snapshot.reference(),
                        snapshot.comment(),
                        snapshot.priceRuleComment(),
                        snapshot.effectiveDate() == null
                                ? null
                                : LocalDate.parse(snapshot.effectiveDate()),
                        snapshot.effectiveTime() == null
                                ? null
                                : LocalTime.parse(snapshot.effectiveTime()),
                        snapshotLines,
                        snapshot.priceSettingGroupId(),
                        snapshot.priceSourceType(),
                        snapshot.priceSourcePriceType(),
                        snapshot.priceSourceDocumentId(),
                        snapshot.priceOperation(),
                        snapshot.priceOperationValue(),
                        snapshot.counterpartyId(),
                        snapshot.counterpartyName()));
    }

    private static String changeSummary(DocumentSnapshot before, DocumentSnapshot after) {
        List<String> changes = new ArrayList<>();
        if (!Objects.equals(before.warehouseId(), after.warehouseId())) changes.add("склад");
        if (!Objects.equals(before.reference(), after.reference())) changes.add("основание");
        if (!Objects.equals(before.counterpartyId(), after.counterpartyId())) changes.add("контрагента");
        if (!Objects.equals(before.comment(), after.comment())) changes.add("комментарий");
        if (!Objects.equals(before.priceRuleComment(), after.priceRuleComment())) {
            changes.add("правила документа");
        }
        if (!Objects.equals(before.purchaseAllocations(), after.purchaseAllocations())) changes.add("распределение остатков заказов");
        if (!Objects.equals(before.effectiveDate(), after.effectiveDate())
                || !Objects.equals(before.effectiveTime(), after.effectiveTime())) {
            changes.add("дату и время документа");
        }

        Map<Long, DocumentSnapshotLine> previousLines =
                before.lines().stream()
                        .collect(
                                Collectors.toMap(
                                        DocumentSnapshotLine::productId,
                                        Function.identity(),
                                        (first, ignored) -> first));
        Map<Long, DocumentSnapshotLine> nextLines =
                after.lines().stream()
                        .collect(
                                Collectors.toMap(
                                        DocumentSnapshotLine::productId,
                                        Function.identity(),
                                        (first, ignored) -> first));
        List<String> added =
                after.lines().stream()
                        .filter(line -> !previousLines.containsKey(line.productId()))
                        .map(DocumentSnapshotLine::productName)
                        .toList();
        List<String> removed =
                before.lines().stream()
                        .filter(line -> !nextLines.containsKey(line.productId()))
                        .map(DocumentSnapshotLine::productName)
                        .toList();
        List<String> changed =
                after.lines().stream()
                        .filter(
                                line -> {
                                    DocumentSnapshotLine previous = previousLines.get(line.productId());
                                    return previous != null && !sameLine(previous, line);
                                })
                        .map(DocumentSnapshotLine::productName)
                        .toList();
        if (!added.isEmpty()) changes.add("добавлены: " + namedItems(added));
        if (!removed.isEmpty()) changes.add("удалены: " + namedItems(removed));
        if (!changed.isEmpty()) changes.add("изменены: " + namedItems(changed));
        if (added.isEmpty() && removed.isEmpty()
                && !before.lines().stream().map(DocumentSnapshotLine::productId).toList()
                        .equals(after.lines().stream().map(DocumentSnapshotLine::productId).toList())) {
            changes.add("порядок позиций");
        }
        return changes.isEmpty() ? null : "Изменены " + String.join("; ", changes);
    }

    private static boolean sameLine(DocumentSnapshotLine first, DocumentSnapshotLine second) {
        return first.quantity().compareTo(second.quantity()) == 0
                && Objects.equals(first.unitCost(), second.unitCost())
                && Objects.equals(first.sourceDocumentId(), second.sourceDocumentId())
                && Objects.equals(first.unitPrice(), second.unitPrice())
                && Objects.equals(first.sourcePrice(), second.sourcePrice())
                && Objects.equals(first.sourceDescription(), second.sourceDescription())
                && Objects.equals(first.priceOperation(), second.priceOperation())
                && Objects.equals(first.priceOperationValue(), second.priceOperationValue())
                && first.manualPrice() == second.manualPrice()
                && Objects.equals(first.comment(), second.comment())
                && Objects.equals(first.productGroupName(), second.productGroupName());
    }

    private static String namedItems(List<String> names) {
        int displayed = Math.min(names.size(), 3);
        String result = String.join(", ", names.subList(0, displayed));
        return names.size() > displayed ? result + " и ещё " + (names.size() - displayed) : result;
    }

    private static String writeSnapshot(DocumentSnapshot snapshot) {
        try {
            return JSON.writeValueAsString(snapshot);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Не удалось сохранить версию складского документа", exception);
        }
    }

    private static DocumentSnapshot readSnapshot(String snapshotJson) {
        try {
            return JSON.readValue(snapshotJson, DocumentSnapshot.class);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Не удалось прочитать версию складского документа", exception);
        }
    }

    private WarehouseDto.Document toDto(StockDocument document, boolean includeCosts) {
        PriceSettingGroup group =
                document.priceSettingGroupId == null
                        ? null
                        : priceSettingGroups.findById(document.priceSettingGroupId).orElse(null);
        List<StockDocumentLine> storedLines = lines.findByDocumentIdOrderById(document.id);
        Map<Long, Product> productMap =
                productsById(
                        storedLines.stream()
                                .map(line -> line.productId)
                                .collect(Collectors.toSet()));
        List<WarehouseDto.DocumentLine> documentLines =
                storedLines.stream()
                        .map(
                                line -> {
                                    Product product = productMap.get(line.productId);
                                    return new WarehouseDto.DocumentLine(
                                            line.id,
                                            line.productId,
                                            product == null ? "—" : product.sku,
                                            product == null ? "Удалённый товар" : product.nameRu,
                                    line.quantity,
                                    includeCosts ? line.unitCost : null,
                                    includeCosts ? line.suggestedUnitCost : null,
                                    line.sourceOrderItemId,
                                            line.sourceDocumentId,
                                            line.unitPrice,
                                            line.comment,
                                            line.sourcePrice,
                                            line.sourceDescription,
                                            line.priceOperation,
                                            line.priceOperationValue,
                                            line.manualPrice,
                                            line.productGroupName);
                                })
                        .toList();
        if (document.documentType == StockDocumentType.SALE && storedLines.isEmpty()) {
            documentLines = saleDocumentLines(document, includeCosts);
        }
        return new WarehouseDto.Document(
                document.id,
                document.documentNumber,
                document.documentType,
                document.status,
                document.priceType,
                document.warehouseId,
                document.sourceOrderId,
                document.reference,
                document.comment,
                document.priceRuleComment,
                document.effectiveDate,
                document.effectiveTime,
                document.createdByUserId,
                document.createdAt,
                document.postedAt,
                document.cancelledAt,
                documentLines,
                document.priceSettingGroupId,
                group == null ? null : group.name,
                group == null ? null : group.commonRules,
                group == null ? null : group.comment,
                document.priceSourceType,
                document.priceSourcePriceType,
                document.priceSourceDocumentId,
                document.priceOperation,
                document.priceOperationValue,
                document.deletedAt,
                document.purchaseOrderId,
                allocationDtos(document),
                document.counterpartyId,
                counterpartyName(document.counterpartyId));
    }

    /** Sales store their posted products as movements rather than stock document lines. */
    private List<WarehouseDto.DocumentLine> saleDocumentLines(
            StockDocument document, boolean includeCosts) {
        List<StockMovement> documentMovements = movements.findByDocumentId(document.id);
        Set<UUID> reversedMovementIds = documentMovements.stream()
                .map(movement -> movement.reversesMovementId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        List<StockMovement> saleMovements = documentMovements.stream()
                .filter(movement -> "SALE".equals(movement.movementType)
                        && movement.reversesMovementId == null
                        && movement.quantity != null
                        && movement.quantity.signum() < 0
                        && !reversedMovementIds.contains(movement.id)
                        && (document.cancelledAt == null
                                || movement.createdAt.isAfter(document.cancelledAt)))
                .sorted(Comparator.comparing(movement -> movement.createdAt))
                .toList();
        if (saleMovements.isEmpty()) return List.of();

        Map<Long, Product> productMap = productsById(saleMovements.stream()
                .map(movement -> movement.productId)
                .collect(Collectors.toSet()));
        Map<Long, List<OrderItem>> orderItemsByProduct = document.sourceOrderId == null
                ? Map.of()
                : orderRepository.findById(document.sourceOrderId)
                        .map(order -> order.items.stream()
                                .filter(item -> item.productId != null
                                        && item.quantity != null
                                        && item.quantity.signum() > 0)
                                .collect(Collectors.groupingBy(item -> item.productId)))
                        .orElseGet(Map::of);

        return saleMovements.stream()
                .map(movement -> {
                    Product product = productMap.get(movement.productId);
                    List<OrderItem> orderLines = orderItemsByProduct.getOrDefault(
                            movement.productId, List.of());
                    BigDecimal totalQuantity = orderLines.stream()
                            .map(item -> item.quantity)
                            .reduce(BigDecimal.ZERO, BigDecimal::add);
                    BigDecimal unitPrice = totalQuantity.signum() == 0
                            || orderLines.stream().anyMatch(item -> sourceSalePrice(item) == null)
                            ? null
                            : orderLines.stream()
                                    .map(item -> sourceSalePrice(item).multiply(item.quantity))
                                    .reduce(BigDecimal.ZERO, BigDecimal::add)
                                    .divide(totalQuantity, 2, RoundingMode.HALF_UP);
                    return new WarehouseDto.DocumentLine(
                            null,
                            movement.productId,
                            product == null ? "—" : product.sku,
                            product == null ? "Удалённый товар" : product.nameRu,
                            movement.quantity.abs(),
                            includeCosts ? movement.unitCost : null,
                            null,
                            null,
                            null,
                            unitPrice,
                            null,
                            null,
                            null,
                            null,
                            null,
                            false,
                            null);
                })
                .toList();
    }

    private WarehouseDto.DocumentSummary toSummary(StockDocument document) {
        return new WarehouseDto.DocumentSummary(
                document.id,
                document.documentNumber,
                document.documentType,
                document.status,
                document.priceType,
                document.reference,
                document.effectiveDate,
                document.effectiveTime,
                document.createdAt,
                document.postedAt,
                document.priceSettingGroupId,
                document.priceSourceType,
                document.priceSourcePriceType,
                document.priceSourceDocumentId,
                document.priceOperation,
                document.priceOperationValue,
                document.counterpartyId,
                counterpartyName(document.counterpartyId));
    }

    private WarehouseDto.PriceSettingGroup toPriceSettingGroupDto(PriceSettingGroup group) {
        return new WarehouseDto.PriceSettingGroup(
                group.id,
                group.name,
                group.commonRules,
                group.comment,
                group.createdByUserId,
                group.createdAt,
                group.updatedAt,
                documents.findByPriceSettingGroupIdAndDeletedAtIsNullOrderByCreatedAtDesc(group.id).stream()
                        .map(this::toSummary)
                        .toList());
    }

    private PriceSettingGroup requiredPriceSettingGroup(UUID id) {
        return priceSettingGroups
                .findById(id)
                .filter(group -> group.deletedAt == null)
                .orElseThrow(() -> new AppExceptions.NotFound("Группа установки цен не найдена"));
    }

    private Map<Long, Product> productsById(Collection<Long> productIds) {
        if (productIds.isEmpty()) return Map.of();
        return products.findByIdInAndDeletedAtIsNull(new LinkedHashSet<>(productIds)).stream()
                .collect(Collectors.toMap(product -> product.id, Function.identity()));
    }

    private Warehouse defaultWarehouse() {
        return warehouses
                .findByCodeAndActiveTrue(DEFAULT_WAREHOUSE_CODE)
                .orElseThrow(() -> new AppExceptions.NotFound("Основной склад не найден"));
    }

    private Warehouse warehouse(Long id) {
        if (id == null) return defaultWarehouse();
        return warehouses
                .findById(id)
                .filter(warehouse -> warehouse.active)
                .orElseThrow(() -> new AppExceptions.NotFound("Склад не найден"));
    }

    private Warehouse lockWarehouse(Long id) {
        return warehouses
                .findActiveForUpdateById(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Склад не найден"));
    }

    private StockDocument requiredDocument(UUID id) {
        return documents.findByIdAndDeletedAtIsNull(id).orElseThrow(() -> notFound(id));
    }

    /** Read-only retrieval intentionally includes a soft-deleted document for linked orders. */
    private StockDocument viewableDocument(UUID id) {
        return documents.findById(id).orElseThrow(() -> notFound(id));
    }

    private AppExceptions.NotFound notFound(UUID id) {
        return new AppExceptions.NotFound("Складской документ не найден: " + id);
    }

    private String nextDocumentNumber() {
        return "СКЛ-" + documents.nextDocumentNumber();
    }

    private BigDecimal inventoryCost(Long warehouseId, Long productId) {
        return layers
                .findActiveByWarehouseIdAndProductIdAndRemainingQuantityGreaterThanOrderByReceivedAtAscCreatedAtAsc(
                        warehouseId, productId, BigDecimal.ZERO)
                .stream()
                .map(
                        layer ->
                                layer.unitCost == null
                                        ? BigDecimal.ZERO
                                        : layer.remainingQuantity.multiply(layer.unitCost))
                .reduce(BigDecimal.ZERO, BigDecimal::add)
                .setScale(2, RoundingMode.HALF_UP);
    }

    /**
     * A reservation can hold only stock that already existed when the order entered work.
     * Consequently, an old order does not become reserved against a later receipt merely because
     * the balance is viewed after that receipt has been posted.
     */
    private Map<Long, BigDecimal> effectiveActiveReservations(
            Long warehouseId, Collection<Long> productIds) {
        return productIds.stream()
                .collect(
                        Collectors.toMap(
                                Function.identity(),
                                productId ->
                                        effectiveActiveReservationQuantity(warehouseId, productId)));
    }

    private BigDecimal effectiveActiveReservationQuantity(Long warehouseId, Long productId) {
        List<StockMovement> movementHistory =
                movements.findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
                                warehouseId, productId)
                        .stream()
                        .map(row -> (StockMovement) row[0])
                        .sorted(
                                Comparator.comparing(
                                                (StockMovement movement) -> movement.occurredAt)
                                        .thenComparing(movement -> movement.createdAt)
                                        .thenComparing(movement -> movement.id.toString()))
                        .toList();
        if (movementHistory.isEmpty()) return ZERO;

        // A newer opening balance starts a new warehouse ledger for this product.
        int movementIndex = 0;
        for (int index = 0; index < movementHistory.size(); index++) {
            if ("OPENING_BALANCE".equals(movementHistory.get(index).movementType)) {
                movementIndex = index;
            }
        }

        List<StockReservation> reservationHistory =
                reservations
                        .findByWarehouseIdAndProductIdAndStatusOrderByCreatedAtDesc(
                                warehouseId, productId, StockReservationStatus.ACTIVE)
                        .stream()
                        .sorted(Comparator.comparing(reservation -> reservation.createdAt))
                        .toList();
        BigDecimal onHandAtReservation = ZERO;
        BigDecimal held = ZERO;
        for (StockReservation reservation : reservationHistory) {
            while (movementIndex < movementHistory.size()
                    && !movementHistory
                            .get(movementIndex)
                            .occurredAt
                            .isAfter(reservation.createdAt)) {
                onHandAtReservation =
                        onHandAtReservation.add(movementHistory.get(movementIndex++).quantity);
            }
            BigDecimal reservable = onHandAtReservation.subtract(held).max(ZERO);
            held = held.add(quantity(reservation.quantity).min(reservable));
        }
        return held;
    }

    private static Map<Long, BigDecimal> toQuantityMap(List<Object[]> rows) {
        return rows.stream()
                .collect(
                        Collectors.toMap(
                                row -> (Long) row[0], row -> quantity((BigDecimal) row[1])));
    }

    private static BigDecimal quantity(BigDecimal value) {
        return value == null ? ZERO : value.setScale(3, RoundingMode.HALF_UP);
    }

    private static BigDecimal nullableMoney(BigDecimal value) {
        return value == null ? null : value.setScale(2, RoundingMode.HALF_UP);
    }

    private static BigDecimal preciseUnitCost(BigDecimal value) {
        return value == null ? null : value.setScale(6, RoundingMode.HALF_UP);
    }

    private static BigDecimal receiptUnitCost(BigDecimal value) {
        BigDecimal normalized = preciseUnitCost(value);
        if (normalized == null || normalized.signum() <= 0) {
            throw new AppExceptions.BadRequest("Приходная цена должна быть больше нуля");
        }
        return normalized;
    }

    /** Supplier order prices and price-setting values remain whole and positive. */
    private static BigDecimal wholePrice(BigDecimal value, String label) {
        if (value == null) throw new AppExceptions.BadRequest(label + " обязательна");
        return value.setScale(0, RoundingMode.HALF_UP).max(BigDecimal.ONE).setScale(2);
    }

    private static boolean allowsZeroDraftQuantity(StockDocumentType type) {
        return type == StockDocumentType.OPENING_BALANCE
                || type == StockDocumentType.INVENTORY
                || type == StockDocumentType.PURCHASE_ORDER
                || type == StockDocumentType.RECEIPT;
    }

    private static void validateLine(BigDecimal quantity, BigDecimal unitCost) {
        validateLine(quantity, unitCost, false);
    }

    private static void validateLine(
            BigDecimal quantity, BigDecimal unitCost, boolean zeroQuantityAllowed) {
        if (quantity == null
                || quantity.signum() < 0
                || (!zeroQuantityAllowed && quantity.signum() == 0)) {
            throw new AppExceptions.BadRequest("Количество должно быть больше нуля");
        }
        if (unitCost != null && unitCost.signum() < 0) {
            throw new AppExceptions.BadRequest("Себестоимость не может быть отрицательной");
        }
    }

    private static BigDecimal effectiveCost(StockDocumentLine line, Product product) {
        return line.unitCost != null ? line.unitCost : product.incomingPrice;
    }

    private void applyDocumentCounterparty(StockDocument document, DocumentRequest request) {
        if (request.counterpartyId() == null) {
            document.counterpartyId = null;
            return;
        }
        if (request.type() != StockDocumentType.RECEIPT
                && request.type() != StockDocumentType.PURCHASE_ORDER) {
            throw new AppExceptions.BadRequest(
                    "Контрагента можно указать только для прихода или заказа поставщику");
        }
        WarehouseCounterparty counterparty = requiredCounterparty(request.counterpartyId());
        if (counterparty.archived && request.purchaseOrderId() == null) {
            throw new AppExceptions.BadRequest("Архивного контрагента нельзя выбрать в новом документе");
        }
        document.counterpartyId = counterparty.id;
    }

    private void applyReceiptPurchaseOrder(StockDocument document, DocumentRequest request) {
        if (request.purchaseOrderId() == null) {
            document.purchaseOrderId = null;
            return;
        }
        if (request.type() != StockDocumentType.RECEIPT) {
            throw new AppExceptions.BadRequest("Заказ поставщику можно связать только с приходом");
        }
        StockDocument order = requiredDocument(request.purchaseOrderId());
        if (order.documentType != StockDocumentType.PURCHASE_ORDER
                || order.status != StockDocumentStatus.POSTED
                || !Objects.equals(order.warehouseId, document.warehouseId)) {
            throw new AppExceptions.BadRequest(
                    "Выберите проведённый заказ поставщику того же склада");
        }
        if (order.counterpartyId == null
                || !Objects.equals(order.counterpartyId, document.counterpartyId)) {
            throw new AppExceptions.BadRequest(
                    "Контрагент прихода должен совпадать с контрагентом заказа поставщику");
        }
        document.purchaseOrderId = order.id;
    }

    private String receiptPurchaseOrderReference(StockDocument document, String reference) {
        if (document.purchaseOrderId == null) return blankToNull(reference);
        StockDocument order = requiredDocument(document.purchaseOrderId);
        return "По заказу " + (order.documentNumber == null ? order.id : order.documentNumber);
    }

    private WarehouseCounterparty requiredCounterparty(UUID id) {
        if (counterparties == null) throw new AppExceptions.NotFound("Контрагент не найден");
        return counterparties.findById(id).orElseThrow(() -> new AppExceptions.NotFound("Контрагент не найден"));
    }

    private String counterpartyName(UUID id) {
        if (id == null || counterparties == null) return null;
        return counterparties.findById(id).map(counterparty -> counterparty.name).orElse(null);
    }

    private static WarehouseDto.Counterparty toCounterpartyDto(WarehouseCounterparty counterparty) {
        return new WarehouseDto.Counterparty(
                counterparty.id,
                counterparty.name,
                counterparty.contactName,
                counterparty.phone,
                counterparty.email,
                counterparty.comment,
                counterparty.archived,
                counterparty.createdAt,
                counterparty.updatedAt);
    }

    private static void applyCounterparty(
            WarehouseCounterparty counterparty, WarehouseDto.CounterpartyRequest request) {
        counterparty.name = requiredText(request.name(), "Укажите название контрагента");
        counterparty.contactName = blankToNull(request.contactName());
        counterparty.phone = blankToNull(request.phone());
        counterparty.email = blankToNull(request.email());
        counterparty.comment = blankToNull(request.comment());
        counterparty.archived = Boolean.TRUE.equals(request.archived());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static String requiredText(String value, String message) {
        String normalized = blankToNull(value);
        if (normalized == null) throw new AppExceptions.BadRequest(message);
        return normalized;
    }

    private static void requireEditable(StockDocument document) {
        if (document.deletedAt != null || document.status == StockDocumentStatus.POSTED) {
            throw new AppExceptions.BadRequest("Проведённый или удалённый документ нельзя изменить");
        }
    }

    private static Map<Long, BigDecimal> orderQuantities(Order order) {
        return order.items.stream()
                .filter(
                        item ->
                                item.productId != null
                                        && item.quantity != null
                                        && item.quantity.signum() > 0)
                .collect(
                        Collectors.groupingBy(
                                item -> item.productId,
                                LinkedHashMap::new,
                                Collectors.reducing(ZERO, item -> item.quantity, BigDecimal::add)));
    }

    private boolean hasAnyTrackedProduct(Long warehouseId, Collection<Long> productIds) {
        return productIds.stream()
                .anyMatch(
                        productId ->
                                movements.existsActiveByWarehouseIdAndProductId(
                                        warehouseId, productId));
    }

    /** A return affects stock only after this product's actual opening balance has been entered. */
    private boolean hasOpeningBalance(Long warehouseId, Long productId) {
        return movements.existsPostedOpeningBalanceByWarehouseIdAndProductId(warehouseId, productId);
    }
}
