package kz.company.shop.warehouse.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
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
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.entity.StockDocumentVersion;
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

class WarehouseDocumentLineOrderTest {
    @ParameterizedTest
    @EnumSource(value = StockDocumentType.class, names = {
        "RECEIPT", "PURCHASE_ORDER", "PRICE_SETTING", "INVENTORY", "OPENING_BALANCE"
    })
    void preservesReorderedLinesOnSaveReloadAndHistory(StockDocumentType type) {
        WarehouseRepository warehouses = mock(WarehouseRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        StockDocumentVersionRepository versions = mock(StockDocumentVersionRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        WarehouseCounterpartyRepository counterparties = mock(WarehouseCounterpartyRepository.class);
        WarehouseService service = new WarehouseService(
                warehouses, documents, versions, lines, mock(PriceSettingGroupRepository.class),
                counterparties, mock(StockMovementRepository.class), mock(StockCostLayerRepository.class),
                mock(StockReservationRepository.class), products, mock(OrderRepository.class),
                mock(OrderItemRepository.class), mock(UserRepository.class));

        Warehouse warehouse = new Warehouse();
        warehouse.id = 1L;
        when(warehouses.findByCodeAndActiveTrue("MAIN")).thenReturn(Optional.of(warehouse));
        WarehouseCounterparty supplier = new WarehouseCounterparty();
        supplier.id = UUID.randomUUID();
        supplier.name = "Поставщик";
        when(counterparties.findById(supplier.id)).thenReturn(Optional.of(supplier));

        List<Product> catalog = List.of(product(101L), product(102L), product(103L));
        when(products.findByIdInAndDeletedAtIsNull(anySet())).thenReturn(catalog);
        Map<UUID, StockDocument> savedDocuments = new HashMap<>();
        when(documents.save(any(StockDocument.class))).thenAnswer(invocation -> {
            StockDocument saved = invocation.getArgument(0);
            savedDocuments.put(saved.id, saved);
            return saved;
        });
        when(documents.findForUpdateById(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(savedDocuments.get(invocation.getArgument(0))));
        when(documents.findById(any(UUID.class))).thenAnswer(invocation ->
                Optional.ofNullable(savedDocuments.get(invocation.getArgument(0))));

        // Model the repository contract: generated IDs follow insertion order, reads sort by ID.
        AtomicLong nextId = new AtomicLong();
        List<StockDocumentLine> savedLines = new ArrayList<>();
        when(lines.save(any(StockDocumentLine.class))).thenAnswer(invocation -> {
            StockDocumentLine saved = invocation.getArgument(0);
            saved.id = nextId.incrementAndGet();
            savedLines.add(saved);
            return saved;
        });
        doAnswer(invocation -> {
            UUID documentId = invocation.getArgument(0);
            savedLines.removeIf(line -> line.documentId.equals(documentId));
            return null;
        }).when(lines).deleteByDocumentId(any(UUID.class));
        when(lines.findByDocumentIdOrderById(any(UUID.class))).thenAnswer(invocation -> {
            UUID documentId = invocation.getArgument(0);
            return savedLines.stream().filter(line -> line.documentId.equals(documentId))
                    .sorted(Comparator.comparing(line -> line.id)).toList();
        });

        List<StockDocumentVersion> savedVersions = new ArrayList<>();
        when(versions.save(any(StockDocumentVersion.class))).thenAnswer(invocation -> {
            StockDocumentVersion saved = invocation.getArgument(0);
            savedVersions.add(saved);
            return saved;
        });
        when(versions.findTopByDocumentIdOrderByVersionNumberDesc(any(UUID.class)))
                .thenAnswer(invocation -> savedVersions.stream()
                        .max(Comparator.comparing(version -> version.versionNumber)));
        when(versions.findByDocumentIdOrderByVersionNumberDesc(any(UUID.class)))
                .thenAnswer(invocation -> savedVersions.reversed());

        CurrentUser actor = new CurrentUser(7L, "admin@example.test", "Администратор",
                null, Set.of(), true, BigDecimal.ZERO);
        WarehouseDto.Document created = service.createDraft(
                request(type, supplier.id, List.of(102L, 101L, 103L)), actor, true);
        assertThat(created.lines()).extracting(WarehouseDto.DocumentLine::productId)
                .containsExactly(102L, 101L, 103L);

        WarehouseDto.Document updated = service.updateDraft(created.id(),
                request(type, supplier.id, List.of(103L, 102L, 101L)), actor, true);
        assertThat(updated.lines()).extracting(WarehouseDto.DocumentLine::productId)
                .containsExactly(103L, 102L, 101L);
        assertThat(service.getDocument(created.id(), true).lines())
                .extracting(WarehouseDto.DocumentLine::productId)
                .containsExactly(103L, 102L, 101L);
        assertThat(updated.lines()).allSatisfy(line -> {
            assertThat(line.quantity()).isEqualByComparingTo(BigDecimal.valueOf(line.productId()));
            assertThat(line.comment()).isEqualTo("Строка " + line.productId());
        });

        assertThat(savedVersions).hasSize(2);
        assertThat(savedVersions.get(1).changeSummary).contains("порядок позиций");
        var history = service.documentHistory(created.id(), true);
        assertThat(history.get(0).snapshot().lines()).extracting(WarehouseDto.DocumentLine::productId)
                .containsExactly(103L, 102L, 101L);
        assertThat(history.get(1).snapshot().lines()).extracting(WarehouseDto.DocumentLine::productId)
                .containsExactly(102L, 101L, 103L);

        service.updateDraft(created.id(), request(type, supplier.id, List.of(103L, 102L, 101L)), actor, true);
        assertThat(savedVersions).as("unchanged order must not create another history version").hasSize(2);
    }

    private static Product product(long id) {
        Product product = new Product();
        product.id = id;
        product.sku = "P-" + id;
        product.nameRu = "Товар " + id;
        return product;
    }

    private static WarehouseDto.DocumentRequest request(
            StockDocumentType type, UUID supplierId, List<Long> productIds) {
        return new WarehouseDto.DocumentRequest(type,
                type == StockDocumentType.PRICE_SETTING ? StockDocumentPriceType.RETAIL : null,
                null, null, null, null, LocalDate.of(2026, 9, 1), LocalTime.NOON,
                productIds.stream().map(id -> new WarehouseDto.DocumentLineRequest(
                        id, BigDecimal.valueOf(id), BigDecimal.valueOf(id * 2), null, null,
                        BigDecimal.valueOf(id * 3), "Строка " + id)).toList(),
                null, null, null, null, null, null, List.of(),
                type == StockDocumentType.PURCHASE_ORDER ? supplierId : null);
    }
}
