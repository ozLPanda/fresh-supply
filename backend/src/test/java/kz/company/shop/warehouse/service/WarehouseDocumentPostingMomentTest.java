package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.repository.OrderItemRepository;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.StockDocument;
import kz.company.shop.warehouse.entity.StockDocumentLine;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.entity.StockDocumentStatus;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.entity.StockDocumentVersion;
import kz.company.shop.warehouse.entity.StockMovement;
import kz.company.shop.warehouse.entity.Warehouse;
import kz.company.shop.warehouse.entity.WarehouseCounterparty;
import kz.company.shop.warehouse.repository.PriceSettingGroupRepository;
import kz.company.shop.warehouse.repository.StockCostLayerRepository;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.StockDocumentRepository;
import kz.company.shop.warehouse.repository.StockDocumentVersionRepository;
import kz.company.shop.warehouse.repository.StockMovementRepository;
import kz.company.shop.warehouse.repository.StockReservationRepository;
import kz.company.shop.warehouse.repository.WarehouseCounterpartyRepository;
import kz.company.shop.warehouse.repository.WarehouseRepository;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class WarehouseDocumentPostingMomentTest {
    private static final ZoneId ALMATY = ZoneId.of("Asia/Almaty");
    private static final LocalDate DOCUMENT_DATE = LocalDate.of(2026, 9, 24);
    private static final LocalTime DOCUMENT_TIME = LocalTime.of(11, 7);
    private static final CurrentUser ACTOR = new CurrentUser(
            7L, "admin@example.test", "Администратор", null, Set.of(), true, BigDecimal.ZERO);

    @ParameterizedTest
    @EnumSource(value = StockDocumentType.class, names = {
        "RECEIPT", "PURCHASE_ORDER", "PRICE_SETTING", "INVENTORY", "OPENING_BALANCE"
    })
    void postsAtSavedDocumentMomentAndKeepsActualPostingTimeForAudit(StockDocumentType type) {
        Fixture fixture = new Fixture(type);
        Instant beforePosting = Instant.now();

        WarehouseDto.Document result = fixture.service.post(fixture.document.id, ACTOR, true);

        fixture.assertPostedMoment(result, DOCUMENT_DATE, DOCUMENT_TIME);
        assertThat(result.postedAt()).isBetween(beforePosting, Instant.now());
        assertThat(result.postedAt()).isAfter(moment(DOCUMENT_DATE, DOCUMENT_TIME));
    }

    @ParameterizedTest
    @EnumSource(value = StockDocumentType.class, names = {"RECEIPT", "INVENTORY"})
    void repostsCancelledDocumentAtItsSavedMoment(StockDocumentType type) {
        Fixture fixture = new Fixture(type);
        fixture.document.status = StockDocumentStatus.CANCELLED;
        fixture.document.postedAt = Instant.parse("2026-09-25T06:00:00Z");
        fixture.document.cancelledAt = Instant.parse("2026-09-25T07:00:00Z");

        WarehouseDto.Document result = fixture.service.post(fixture.document.id, ACTOR, true);

        fixture.assertPostedMoment(result, DOCUMENT_DATE, DOCUMENT_TIME);
        assertThat(result.postedAt()).isAfter(fixture.document.cancelledAt);
        assertThat(fixture.savedMovements.getFirst().sourceLineId).isEqualTo(1L);
        if (type == StockDocumentType.INVENTORY) {
            assertThat(fixture.savedMovements.getFirst().inventoryQuantity)
                    .isEqualByComparingTo("92");
        }
    }

    @ParameterizedTest
    @EnumSource(value = StockDocumentType.class, names = {
        "RECEIPT", "PURCHASE_ORDER", "PRICE_SETTING", "INVENTORY", "OPENING_BALANCE"
    })
    void saveAndPostUsesSubmittedMomentInsteadOfOldSavedOrCreationDate(StockDocumentType type) {
        Fixture fixture = new Fixture(type);
        fixture.document.effectiveDate = LocalDate.of(2026, 9, 25);
        fixture.document.effectiveTime = LocalTime.of(16, 30);

        WarehouseDto.Document result = fixture.service.saveAndPost(
                fixture.document.id, fixture.request(DOCUMENT_DATE, DOCUMENT_TIME), ACTOR, true);

        fixture.assertPostedMoment(result, DOCUMENT_DATE, DOCUMENT_TIME);
        assertThat(fixture.savedVersions).extracting(version -> version.action)
                .containsExactly("UPDATE", "POST");
    }

    @ParameterizedTest
    @EnumSource(value = StockDocumentType.class, names = {
        "RECEIPT", "PURCHASE_ORDER", "PRICE_SETTING", "INVENTORY", "OPENING_BALANCE"
    })
    void legacyDocumentUsesCreationMomentInAlmatyInsteadOfCurrentDate(StockDocumentType type) {
        Fixture fixture = new Fixture(type);
        fixture.document.effectiveDate = null;
        fixture.document.effectiveTime = null;
        // UTC and Almaty dates differ, so this also detects a UTC date fallback.
        fixture.document.createdAt = Instant.parse("2026-09-23T20:07:00Z");

        WarehouseDto.Document result = fixture.service.post(fixture.document.id, ACTOR, true);

        fixture.assertPostedMoment(result, DOCUMENT_DATE, LocalTime.of(1, 7));
    }

    @ParameterizedTest
    @EnumSource(value = StockDocumentType.class, names = {"RECEIPT", "INVENTORY", "PRICE_SETTING"})
    void legacyDateWithoutTimeStartsAtMidnight(StockDocumentType type) {
        Fixture fixture = new Fixture(type);
        fixture.document.effectiveTime = null;

        WarehouseDto.Document result = fixture.service.post(fixture.document.id, ACTOR, true);

        fixture.assertPostedMoment(result, DOCUMENT_DATE, LocalTime.MIDNIGHT);
    }

    @ParameterizedTest
    @ValueSource(strings = {"date", "time", "both"})
    void saveAndPostRejectsMissingEditorMomentBeforeChangingDraft(String missing) {
        Fixture fixture = new Fixture(StockDocumentType.RECEIPT);
        WarehouseDto.DocumentRequest request = fixture.request(
                missing.equals("time") ? DOCUMENT_DATE : null,
                missing.equals("date") ? DOCUMENT_TIME : null);

        assertThatThrownBy(() -> fixture.service.saveAndPost(
                        fixture.document.id, request, ACTOR, true))
                .isInstanceOf(AppExceptions.BadRequest.class);

        verifyNoInteractions(fixture.documents, fixture.lines, fixture.versions,
                fixture.movements, fixture.ledgerReplay, fixture.priceChronology);
        assertThat(fixture.document.effectiveDate).isEqualTo(DOCUMENT_DATE);
        assertThat(fixture.document.effectiveTime).isEqualTo(DOCUMENT_TIME);
        assertThat(fixture.document.status).isEqualTo(StockDocumentStatus.DRAFT);
    }

    @ParameterizedTest
    @EnumSource(value = StockDocumentType.class, names = {
        "RECEIPT", "PURCHASE_ORDER", "PRICE_SETTING", "INVENTORY", "OPENING_BALANCE"
    })
    void rejectsFutureDocumentBeforePostingMovementsPricesOrHistory(StockDocumentType type) {
        Fixture fixture = new Fixture(type);
        fixture.document.effectiveDate = LocalDate.now(ALMATY).plusDays(1);

        assertThatThrownBy(() -> fixture.service.post(fixture.document.id, ACTOR, true))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("будущем");

        assertThat(fixture.document.status).isEqualTo(StockDocumentStatus.DRAFT);
        assertThat(fixture.document.postedAt).isNull();
        verifyNoInteractions(fixture.movements, fixture.ledgerReplay,
                fixture.priceChronology, fixture.versions);
    }

    private static Instant moment(LocalDate date, LocalTime time) {
        return date.atTime(time).atZone(ALMATY).toInstant();
    }

    private static final class Fixture {
        final StockDocumentRepository documents = mock(StockDocumentRepository.class);
        final StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        final StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        final StockMovementRepository movements = mock(StockMovementRepository.class);
        final WarehouseLedgerReplayService ledgerReplay = mock(WarehouseLedgerReplayService.class);
        final WarehousePriceChronologyService priceChronology = mock(WarehousePriceChronologyService.class);
        final StockDocument document = new StockDocument();
        final List<StockDocumentLine> savedLines = new ArrayList<>();
        final List<StockDocumentVersion> savedVersions = new ArrayList<>();
        final List<StockMovement> savedMovements = new ArrayList<>();
        final WarehouseService service;

        Fixture(StockDocumentType type) {
            WarehouseRepository warehouses = mock(WarehouseRepository.class);
            ProductRepository products = mock(ProductRepository.class);
            WarehouseCounterpartyRepository counterparties = mock(WarehouseCounterpartyRepository.class);
            service = new WarehouseService(warehouses, documents, versions, lines,
                    mock(PriceSettingGroupRepository.class), counterparties, movements,
                    mock(StockCostLayerRepository.class), mock(StockReservationRepository.class),
                    products, mock(OrderRepository.class), mock(OrderItemRepository.class),
                    mock(UserRepository.class));
            ReflectionTestUtils.setField(service, "ledgerReplay", ledgerReplay);
            ReflectionTestUtils.setField(service, "priceChronology", priceChronology);

            Warehouse warehouse = new Warehouse();
            warehouse.id = 1L;
            when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
            when(warehouses.findActiveForUpdateById(warehouse.id)).thenReturn(Optional.of(warehouse));
            Product product = new Product();
            product.id = 209L;
            product.sku = "209";
            product.nameRu = "Товар 209";
            when(products.findByIdInAndDeletedAtIsNull(anySet())).thenReturn(List.of(product));
            WarehouseCounterparty supplier = new WarehouseCounterparty();
            supplier.id = UUID.randomUUID();
            supplier.name = "Поставщик";
            when(counterparties.findById(supplier.id)).thenReturn(Optional.of(supplier));

            document.id = UUID.randomUUID();
            document.documentType = type;
            document.status = StockDocumentStatus.DRAFT;
            document.warehouseId = warehouse.id;
            document.documentNumber = "СКЛ-84";
            document.effectiveDate = DOCUMENT_DATE;
            document.effectiveTime = DOCUMENT_TIME;
            document.createdAt = Instant.parse("2026-09-25T04:58:00Z");
            if (type == StockDocumentType.PRICE_SETTING) document.priceType = StockDocumentPriceType.RETAIL;
            if (type == StockDocumentType.PURCHASE_ORDER) document.counterpartyId = supplier.id;
            when(documents.findForUpdateById(document.id)).thenReturn(Optional.of(document));
            when(documents.findById(document.id)).thenReturn(Optional.of(document));

            StockDocumentLine line = new StockDocumentLine();
            line.id = 1L;
            line.documentId = document.id;
            line.productId = product.id;
            line.quantity = new BigDecimal("92");
            line.unitCost = new BigDecimal("400");
            line.unitPrice = new BigDecimal("648");
            savedLines.add(line);
            when(lines.findByDocumentIdOrderById(document.id)).thenAnswer(invocation -> List.copyOf(savedLines));
            doAnswer(invocation -> { savedLines.clear(); return null; })
                    .when(lines).deleteByDocumentId(document.id);
            when(lines.save(any(StockDocumentLine.class))).thenAnswer(invocation -> {
                StockDocumentLine saved = invocation.getArgument(0);
                saved.id = (long) savedLines.size() + 1;
                savedLines.add(saved);
                return saved;
            });
            when(movements.save(any(StockMovement.class))).thenAnswer(invocation -> {
                StockMovement saved = invocation.getArgument(0);
                savedMovements.add(saved);
                return saved;
            });
            when(ledgerReplay.apply(eq(warehouse.id), eq(product.id), isNull())).thenReturn(
                    new WarehouseLedgerReplayService.ReplayPreview(warehouse.id, product.id,
                            List.of(), List.of(), List.of(), BigDecimal.ZERO, new BigDecimal("92"),
                            BigDecimal.ZERO, new BigDecimal("36800"), List.of(), List.of(), true, true));
            when(versions.save(any(StockDocumentVersion.class))).thenAnswer(invocation -> {
                StockDocumentVersion saved = invocation.getArgument(0);
                savedVersions.add(saved);
                return saved;
            });
            when(versions.findTopByDocumentIdOrderByVersionNumberDesc(document.id)).thenAnswer(invocation ->
                    savedVersions.isEmpty() ? Optional.empty() : Optional.of(savedVersions.getLast()));
            when(versions.findByDocumentIdOrderByVersionNumberDesc(document.id))
                    .thenAnswer(invocation -> savedVersions.reversed());
        }

        WarehouseDto.DocumentRequest request(LocalDate date, LocalTime time) {
            return new WarehouseDto.DocumentRequest(document.documentType, document.priceType,
                    null, null, null, null, date, time,
                    List.of(new WarehouseDto.DocumentLineRequest(209L, new BigDecimal("92"),
                            new BigDecimal("400"), null, null, new BigDecimal("648"), null)),
                    null, null, null, null, null, null, List.of(), document.counterpartyId);
        }

        void assertPostedMoment(WarehouseDto.Document result, LocalDate date, LocalTime time) {
            assertThat(result.status()).isEqualTo(StockDocumentStatus.POSTED);
            assertThat(result.effectiveDate()).isEqualTo(date);
            assertThat(result.effectiveTime()).isEqualTo(time);
            assertThat(document.effectiveDate).isEqualTo(date);
            assertThat(document.effectiveTime).isEqualTo(time);
            if (document.documentType == StockDocumentType.PRICE_SETTING) {
                assertThat(savedMovements).isEmpty();
                verify(priceChronology).postPrices(eq(document), any(), any());
            } else if (document.documentType == StockDocumentType.PURCHASE_ORDER) {
                assertThat(savedMovements).isEmpty();
            } else {
                assertThat(savedMovements).singleElement().satisfies(movement -> {
                    assertThat(movement.documentId).isEqualTo(document.id);
                    assertThat(movement.productId).isEqualTo(209L);
                    assertThat(movement.occurredAt).isEqualTo(moment(date, time));
                    assertThat(movement.movementType).isEqualTo(document.documentType.name());
                });
                verify(ledgerReplay).apply(document.warehouseId, 209L, null);
            }
            assertThat(savedVersions.getLast().action).isEqualTo("POST");
            WarehouseDto.DocumentVersionSnapshot snapshot =
                    service.documentHistory(document.id, true).getFirst().snapshot();
            assertThat(snapshot.effectiveDate()).isEqualTo(date);
            assertThat(snapshot.effectiveTime()).isEqualTo(time);
            assertThat(snapshot.status()).isEqualTo(StockDocumentStatus.POSTED);
        }
    }
}
