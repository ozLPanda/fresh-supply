package kz.company.shop.warehouse.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.integrations.gpt.*;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.*;
import kz.company.shop.warehouse.repository.*;
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AiPriceCatalogScopeTest {
    private final AiPriceSessionRepository sessions = mock(AiPriceSessionRepository.class);
    private final StockDocumentRepository documents = mock(StockDocumentRepository.class);
    private final StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
    private final PriceSettingGroupRepository groups = mock(PriceSettingGroupRepository.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final WarehouseService warehouse = mock(WarehouseService.class);
    private final GptProvider gpt = mock(GptProvider.class);
    private final ObjectMapper json = new ObjectMapper();
    private final UUID sourceId = UUID.randomUUID();
    private final UUID groupId = UUID.randomUUID();
    private final CurrentUser actor = new CurrentUser(1L, "a@b.c", "A", "1", Set.of(), true, BigDecimal.ZERO);
    private final Map<UUID, AiPriceSession> stored = new HashMap<>();
    private final List<Product> catalog = new ArrayList<>();
    private final List<StockDocumentLine> sourceLines = new ArrayList<>();
    private final List<JsonNode> calculationInputs = new ArrayList<>();
    private final List<JsonNode> scopeInputs = new ArrayList<>();
    private AiPriceSessionService service;
    private StockDocument source;
    private String scopeJson;
    private boolean omitLastRow;
    private boolean extraType;
    private boolean askCalculation;
    private boolean omitOldPrice;

    @BeforeEach
    void setup() throws Exception {
        service = new AiPriceSessionService(sessions, documents, lines, groups, products, warehouse, gpt, json);
        source = new StockDocument();
        source.id = sourceId;
        source.documentType = StockDocumentType.RECEIPT;
        source.status = StockDocumentStatus.POSTED;
        source.warehouseId = 1L;
        source.effectiveDate = LocalDate.of(2026, 10, 1);
        when(documents.findByIdAndDeletedAtIsNull(sourceId)).thenReturn(Optional.of(source));
        when(documents.findForUpdateById(sourceId)).thenReturn(Optional.of(source));
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = groupId;
        group.name = "Группа";
        group.commonRules = "Приход +3.8%; розница +80%; опт -10% от розницы";
        when(groups.findById(groupId)).thenReturn(Optional.of(group));
        when(groups.existsById(groupId)).thenReturn(true);
        for (long id = 1632; id <= 1641; id++) {
            addProduct(id, "Мастер флеш " + (id % 2 == 0 ? "маленький" : "большой") + " цвет " + id,
                    id % 2 == 0 ? "17112" : "17763");
            if (id != 1634 && id != 1636) addSource(id);
        }
        addProduct(1723, "Герметик для установки (под мастер флеш)", "1000");
        when(lines.findByDocumentIdOrderById(sourceId)).thenAnswer(call -> List.copyOf(sourceLines));
        when(products.findByDeletedAtIsNullOrderByNameRuAsc()).thenAnswer(call -> List.copyOf(catalog));
        when(products.findByIdInAndDeletedAtIsNull(any())).thenAnswer(call -> {
            Collection<Long> ids = call.getArgument(0);
            return catalog.stream().filter(product -> ids.contains(product.id)).toList();
        });
        when(sessions.save(any())).thenAnswer(call -> {
            AiPriceSession session = call.getArgument(0);
            stored.put(session.id, session);
            return session;
        });
        when(sessions.findLocked(any())).thenAnswer(call -> Optional.ofNullable(stored.get(call.getArgument(0))));
        when(sessions.findById(any())).thenAnswer(call -> Optional.ofNullable(stored.get(call.getArgument(0))));
        when(sessions.findByParentSessionId(any())).thenAnswer(call -> stored.values().stream()
                .filter(session -> Objects.equals(session.parentSessionId, call.getArgument(0))).findFirst());
        WarehouseDto.Document draft = mock(WarehouseDto.Document.class);
        when(draft.id()).thenAnswer(call -> UUID.randomUUID());
        when(warehouse.createDraft(any(), eq(actor), eq(true))).thenReturn(draft);
        WarehouseDto.Document incoming = mock(WarehouseDto.Document.class);
        when(incoming.id()).thenReturn(sourceId);
        when(warehouse.applyAiIncomingPrices(eq(sourceId), any(), eq(actor))).thenReturn(incoming);
        scopeJson = scope(List.of("INCOMING", "WHOLESALE", "BULK_WHOLESALE", "SKO", "GSKO"),
                catalog.subList(0, 10).stream().map(product -> product.id).toList());
        when(gpt.generate(any())).thenAnswer(call -> {
            GptRequest request = call.getArgument(0);
            JsonNode input = json.readTree(request.input());
            if (input.has("catalog")) {
                scopeInputs.add(input);
                return new GptResult(scopeJson, null, null, null);
            }
            calculationInputs.add(input);
            ObjectNode result = json.createObjectNode();
            result.put("assistantMessage", "Готово");
            var questions = result.putArray("questions");
            var rows = result.putArray("rows");
            if (askCalculation || omitOldPrice) {
                questions.add(omitOldPrice ? "Нет старой розничной цены; какую базу взять?" : "Какую базу выравнивания выбрать?");
            } else {
                for (JsonNode item : input.path("products")) {
                    ObjectNode row = rows.addObject();
                    row.set("productId", item.path("productId"));
                    ObjectNode prices = row.putObject("prices");
                    for (Iterator<String> keys = item.path("prices").fieldNames(); keys.hasNext();) {
                        String key = keys.next();
                        BigDecimal price = key.equals("RETAIL")
                                ? item.path("prices").path(key).path("oldPrice").decimalValue()
                                    .multiply(new BigDecimal("0.9")).setScale(0, java.math.RoundingMode.HALF_UP)
                                : new BigDecimal("99");
                        prices.putObject(key).put("newPrice", price).put("reason", "Правило и уточнение");
                    }
                    if (extraType) prices.putObject("INVENTED").put("newPrice", 99).put("reason", "Лишний тип");
                }
                if (omitLastRow) rows.remove(rows.size() - 1);
            }
            return new GptResult(json.writeValueAsString(result), null, null, null);
        });
    }

    @Test
    void allCatalogCategoryRetailAndOnlyReceiptOtherPricesCreateExactDocuments() {
        AiPriceDto.Session preview = start();
        assertEquals("PREVIEW", preview.status());
        assertEquals(10, preview.rows().size());
        assertEquals(10, preview.rows().stream().map(AiPriceDto.Row::productId).distinct().count());
        assertFalse(preview.rows().stream().anyMatch(row -> row.productId() == 1723));
        for (AiPriceDto.Row row : preview.rows()) {
            boolean outside = row.productId() == 1634 || row.productId() == 1636;
            assertEquals(outside, row.catalogOnly());
            assertEquals(outside ? 1 : 6, row.prices().size());
            assertEquals(new BigDecimal(row.productId() % 2 == 0 ? "15401.00" : "15987.00"), row.prices().get(StockDocumentPriceType.RETAIL).newPrice());
            if (outside) assertNull(row.unitCost());
        }
        AiPriceDto.Session confirmed = service.confirm(preview.id(), actor);
        assertEquals(6, confirmed.createdDocumentIds().size());
        ArgumentCaptor<WarehouseDto.DocumentRequest> requests = ArgumentCaptor.forClass(WarehouseDto.DocumentRequest.class);
        verify(warehouse, times(6)).createDraft(requests.capture(), eq(actor), eq(true));
        for (WarehouseDto.DocumentRequest request : requests.getAllValues()) {
            assertEquals(request.priceType() == StockDocumentPriceType.RETAIL ? 10 : 8, request.lines().size());
            for (WarehouseDto.DocumentLineRequest line : request.lines()) {
                boolean outside = line.productId() == 1634 || line.productId() == 1636;
                assertEquals(outside ? null : sourceId, line.sourceDocumentId());
                assertNull(line.unitCost());
            }
        }
        assertEquals(confirmed.createdDocumentIds(), service.confirm(preview.id(), actor).createdDocumentIds());
        verify(warehouse, times(6)).createDraft(any(), eq(actor), eq(true));
        verify(products, never()).save(any());
    }

    @Test
    void mixedSourceKeepsReferenceRetailWithoutApplyingIt() {
        addProduct(2000, "Обычная труба", "1500");
        addSource(2000);
        AiPriceDto.Session preview = start();
        AiPriceDto.Row other = preview.rows().stream().filter(row -> row.productId() == 2000).findFirst().orElseThrow();
        assertEquals(5, other.prices().size());
        assertFalse(other.prices().containsKey(StockDocumentPriceType.RETAIL));
        JsonNode context = calculationInputs.getFirst().path("allProducts");
        JsonNode reference = null;
        for (JsonNode item : context) if (item.path("productId").asLong() == 2000) reference = item;
        assertNotNull(reference);
        assertEquals(1500, reference.path("oldPrices").path("RETAIL").asInt());
        assertEquals(6, reference.path("oldPrices").size());
        service.confirm(preview.id(), actor);
        ArgumentCaptor<WarehouseDto.DocumentRequest> requests = ArgumentCaptor.forClass(WarehouseDto.DocumentRequest.class);
        verify(warehouse, times(6)).createDraft(requests.capture(), eq(actor), eq(true));
        for (var request : requests.getAllValues())
            assertEquals(request.priceType() != StockDocumentPriceType.RETAIL,
                    request.lines().stream().anyMatch(line -> line.productId() == 2000));
    }

    @Test
    void unrequestedReferencePriceChangeBlocksConfirmAndSnapshotSurvivesEdit() {
        addProduct(2000, "Обычная труба", "1500");
        addSource(2000);
        AiPriceDto.Session preview = start();
        AiPriceDto.Session edited = service.edit(preview.id(), List.of(new AiPriceDto.EditRow(2000L,
                Map.of(StockDocumentPriceType.WHOLESALE, new BigDecimal("100")))));
        AiPriceDto.Row other = edited.rows().stream().filter(row -> row.productId() == 2000).findFirst().orElseThrow();
        assertFalse(other.prices().containsKey(StockDocumentPriceType.RETAIL));
        assertEquals(new BigDecimal("1500"), other.referencePrices().get(StockDocumentPriceType.RETAIL));
        catalog.getLast().price = new BigDecimal("1600");
        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(preview.id(), actor));
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void onlyCatalogRequestKeepsSourceSnapshotButOmitsUnrequestedPricesAndDocuments() throws Exception {
        scopeJson = scope(List.of(), List.of(1634L, 1636L));
        AiPriceDto.Session preview = start();
        assertEquals(10, preview.rows().size());
        assertEquals(8, preview.rows().stream().filter(row -> row.prices().isEmpty()).count());
        assertEquals(2, calculationInputs.getFirst().path("products").size());
        assertEquals(1, service.confirm(preview.id(), actor).createdDocumentIds().size());
        ArgumentCaptor<WarehouseDto.DocumentRequest> request = ArgumentCaptor.forClass(WarehouseDto.DocumentRequest.class);
        verify(warehouse).createDraft(request.capture(), eq(actor), eq(true));
        assertEquals(StockDocumentPriceType.RETAIL, request.getValue().priceType());
        assertEquals(2, request.getValue().lines().size());
        assertThrows(AppExceptions.BadRequest.class, () -> service.edit(preview.id(), List.of(
                new AiPriceDto.EditRow(1632L, Map.of(StockDocumentPriceType.INCOMING, BigDecimal.TEN)))));
    }

    @Test
    void incomingDraftIsReusedForSourceOnly() {
        source.documentType = StockDocumentType.PRICE_SETTING;
        source.status = StockDocumentStatus.DRAFT;
        source.priceType = StockDocumentPriceType.INCOMING;
        source.priceSettingGroupId = groupId;
        AiPriceDto.Session preview = start();
        AiPriceDto.Session confirmed = service.confirm(preview.id(), actor);
        assertEquals(6, confirmed.createdDocumentIds().size());
        ArgumentCaptor<Map<Long, BigDecimal>> incoming = ArgumentCaptor.forClass(Map.class);
        verify(warehouse).applyAiIncomingPrices(eq(sourceId), incoming.capture(), eq(actor));
        assertEquals(8, incoming.getValue().size());
        assertFalse(incoming.getValue().containsKey(1634L));
        verify(warehouse, times(5)).createDraft(any(), eq(actor), eq(true));
    }

    @Test
    void questionFollowUpAndRegenerationRetainScopeAndRefreshPrices() {
        askCalculation = true;
        AiPriceDto.Session first = start();
        assertEquals("QUESTIONS", first.status());
        assertEquals(10, first.rows().size());
        askCalculation = false;
        AiPriceDto.Session preview = service.message(first.id(), "Возьми минимум отдельно для каждого размера");
        assertEquals(10, preview.rows().size());
        assertEquals(10, scopeInputs.getLast().path("previousScope").size());
        assertEquals(3, scopeInputs.getLast().path("conversation").size());
        service.confirm(preview.id(), actor);
        catalog.get(2).price = new BigDecimal("18000");
        AiPriceDto.Session child = service.regenerate(preview.id(), "Уточнения прежние", actor);
        assertEquals(10, child.rows().size());
        assertEquals(new BigDecimal("16200.00"), child.rows().stream().filter(row -> row.productId() == 1634).findFirst().orElseThrow()
                .prices().get(StockDocumentPriceType.RETAIL).newPrice());
        assertEquals(10, scopeInputs.getLast().path("previousScope").size());
        assertEquals(child.id(), service.regenerate(preview.id(), null, actor).id());
        assertEquals(3, scopeInputs.size());
    }

    @Test
    void followUpCanChangeScopeAndEditsCannotAddUnrequestedType() throws Exception {
        AiPriceDto.Session preview = start();
        scopeJson = scope(List.of("INCOMING"), List.of(1634L));
        AiPriceDto.Session changed = service.message(preview.id(), "Розницу только товару 1634, приходную всем исходным");
        assertEquals(9, changed.rows().size());
        AiPriceDto.Session edited = service.edit(changed.id(), List.of(new AiPriceDto.EditRow(1634L,
                Map.of(StockDocumentPriceType.RETAIL, new BigDecimal("15000")))));
        assertTrue(edited.rows().getLast().catalogOnly());
        assertEquals(new BigDecimal("15000.00"), edited.rows().getLast().prices().get(StockDocumentPriceType.RETAIL).newPrice());
        assertThrows(AppExceptions.BadRequest.class, () -> service.edit(changed.id(), List.of(new AiPriceDto.EditRow(1634L,
                Map.of(StockDocumentPriceType.INCOMING, BigDecimal.TEN)))));
    }

    @Test
    void invalidScopeIdsAndTypesNeverReachPriceGeneration() throws Exception {
        for (String invalid : List.of(
                scope(List.of("INCOMING"), List.of(99999L)),
                scope(List.of("INCOMING"), List.of(1634L, 1634L)),
                scope(List.of("NOT_A_PRICE"), List.of(1634L)),
                scope(List.of("RETAIL", "RETAIL"), List.of(1634L)),
                scope(List.of(), List.of()),
                "{\"questions\":[],\"sourcePriceTypes\":[\"INCOMING\"],\"catalogSelections\":[{\"productId\":1634.5,\"priceTypes\":[\"RETAIL\"]}]}",
                "{\"questions\":[],\"sourcePriceTypes\":[\"INCOMING\"],\"catalogSelections\":[{\"productId\":1634,\"priceTypes\":[\"BAD\"]}]}")) {
            scopeJson = invalid;
            assertThrows(AppExceptions.BadRequest.class, this::start);
        }
        assertTrue(calculationInputs.isEmpty());
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void scopeQuestionsBlockCalculationsAndPreserveExistingRows() {
        scopeJson = "{\"assistantMessage\":\"Нужны уточнения\",\"questions\":[\"Какие товары входят в категорию?\"]}";
        AiPriceDto.Session result = start();
        assertEquals("QUESTIONS", result.status());
        assertEquals(8, result.rows().size());
        assertTrue(calculationInputs.isEmpty());
        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(result.id(), actor));
    }

    @Test
    void missingSelectedRowOrExtraPriceTypeRejectsModelTable() {
        omitLastRow = true;
        assertThrows(AppExceptions.BadRequest.class, this::start);
        omitLastRow = false;
        extraType = true;
        assertThrows(AppExceptions.BadRequest.class, this::start);
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void unknownOldRetailIsSentAsNullAndRequiresClarification() {
        catalog.get(2).price = null;
        omitOldPrice = true;
        AiPriceDto.Session result = start();
        assertEquals("QUESTIONS", result.status());
        assertNull(result.rows().stream().filter(row -> row.productId() == 1634).findFirst().orElseThrow()
                .prices().get(StockDocumentPriceType.RETAIL).oldPrice());
        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(result.id(), actor));
    }

    @Test
    void changedCatalogPriceNameOrReceiptCompositionBlocksConfirm() {
        AiPriceDto.Session preview = start();
        Product selected = catalog.get(2);
        BigDecimal old = selected.price;
        selected.price = old.add(BigDecimal.ONE);
        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(preview.id(), actor));
        selected.price = old;
        String originalName = selected.nameRu;
        selected.nameRu = "Другая категория или размер";
        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(preview.id(), actor));
        selected.nameRu = originalName;
        sourceLines.removeLast();
        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(preview.id(), actor));
        assertThrows(AppExceptions.BadRequest.class, () -> service.message(preview.id(), "Подтверждаю"));
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void legacyRowJsonDefaultsCatalogOnlyToFalse() throws Exception {
        AiPriceDto.Row legacy = json.readValue("{\"productId\":7,\"sku\":\"A\",\"productName\":\"Товар\",\"quantity\":1,\"unitCost\":10,\"prices\":{}}", AiPriceDto.Row.class);
        assertFalse(legacy.catalogOnly());
        assertNull(legacy.referencePrices());
        assertFalse(new AiPriceDto.Row(7L, "A", "Товар", BigDecimal.ONE, BigDecimal.TEN, Map.of()).catalogOnly());
    }

    private AiPriceDto.Session start() {
        return service.start(sourceId, groupId,
                "Всем мастер флешам из системы розницу -10%, выровнять по размеру. Остальные цены только приходу.", actor);
    }

    private void addProduct(long id, String name, String retail) {
        Product product = new Product();
        product.id = id;
        product.sku = "SKU-" + id;
        product.nameRu = name;
        product.price = new BigDecimal(retail);
        catalog.add(product);
    }

    private void addSource(long id) {
        StockDocumentLine line = new StockDocumentLine();
        line.productId = id;
        line.quantity = BigDecimal.ONE;
        line.unitCost = new BigDecimal("100.00");
        sourceLines.add(line);
    }

    private String scope(List<String> sourceTypes, List<Long> selectedIds) throws Exception {
        ObjectNode result = json.createObjectNode();
        result.put("assistantMessage", "Область определена");
        result.putArray("questions");
        result.set("sourcePriceTypes", json.valueToTree(sourceTypes));
        var selections = result.putArray("catalogSelections");
        for (Long id : selectedIds) {
            var item = selections.addObject();
            item.put("productId", id);
            item.putArray("priceTypes").add("RETAIL");
        }
        return json.writeValueAsString(result);
    }
}
