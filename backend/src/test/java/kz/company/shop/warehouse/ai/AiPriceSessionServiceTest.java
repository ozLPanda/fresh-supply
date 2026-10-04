package kz.company.shop.warehouse.ai;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.mockito.ArgumentCaptor;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.integrations.gpt.GptProvider;
import kz.company.shop.integrations.gpt.GptResult;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.warehouse.entity.*;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.repository.*;
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AiPriceSessionServiceTest {
    private final AiPriceSessionRepository sessions = mock(AiPriceSessionRepository.class);
    private final StockDocumentRepository documents = mock(StockDocumentRepository.class);
    private final StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
    private final PriceSettingGroupRepository groups = mock(PriceSettingGroupRepository.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final WarehouseService warehouse = mock(WarehouseService.class);
    private final GptProvider gpt = mock(GptProvider.class);
    private final ObjectMapper json = new ObjectMapper();
    private final UUID receiptId = UUID.randomUUID();
    private final UUID groupId = UUID.randomUUID();
    private final CurrentUser actor = new CurrentUser(1L, "a@b.c", "A", "1", Set.of("warehouse.manage", "warehouse.costs.read"), true, BigDecimal.ZERO);
    private AiPriceSessionService service;
    private AiPriceSession saved;
    private final Map<UUID, AiPriceSession> persisted = new java.util.HashMap<>();

    @BeforeEach
    void setup() {
        service = new AiPriceSessionService(sessions, documents, lines, groups, products, warehouse, gpt, json);
        StockDocument receipt = new StockDocument();
        receipt.id = receiptId;
        receipt.documentType = StockDocumentType.RECEIPT;
        receipt.status = StockDocumentStatus.POSTED;
        receipt.warehouseId = 1L;
        receipt.effectiveDate = java.time.LocalDate.of(2026, 9, 25);
        when(documents.findByIdAndDeletedAtIsNull(receiptId)).thenReturn(Optional.of(receipt));
        when(documents.findForUpdateById(receiptId)).thenReturn(Optional.of(receipt));
        StockDocumentLine line = new StockDocumentLine();
        line.productId = 7L;
        line.quantity = BigDecimal.ONE;
        line.unitCost = new BigDecimal("75.123456");
        when(lines.findByDocumentIdOrderById(receiptId)).thenReturn(List.of(line));
        Product product = new Product();
        product.id = 7L;
        product.sku = "SKU-7";
        product.nameRu = "Товар";
        product.price = new BigDecimal("90.00");
        when(products.findByIdInAndDeletedAtIsNull(Set.of(7L))).thenReturn(List.of(product));
        PriceSettingGroup group = new PriceSettingGroup();
        group.id = groupId;
        group.name = "Группа";
        group.commonRules = "Розница зависит от порога закупки; труба и асбест — исключения. ГСКО спроси у ДД.";
        when(groups.findById(groupId)).thenReturn(Optional.of(group));
        when(groups.existsById(groupId)).thenReturn(true);
        when(sessions.save(any())).thenAnswer(invocation -> {
            saved = invocation.getArgument(0);
            persisted.put(saved.id, saved);
            return saved;
        });
        when(sessions.findLocked(any())).thenAnswer(invocation -> Optional.ofNullable(persisted.get(invocation.getArgument(0))));
        when(sessions.findById(any())).thenAnswer(invocation -> Optional.ofNullable(persisted.get(invocation.getArgument(0))));
        when(sessions.findByParentSessionId(any())).thenAnswer(invocation -> persisted.values().stream()
                .filter(s -> java.util.Objects.equals(s.parentSessionId, invocation.getArgument(0)))
                .findFirst());
    }

    @Test
    void asksBeforeCreatingAnyDocument() {
        when(gpt.generate(any())).thenReturn(new GptResult("{\"assistantMessage\":\"Нужны уточнения\",\"questions\":[\"Как округлять цены?\"],\"rows\":[]}", null, null, null));
        AiPriceDto.Session result = service.start(receiptId, groupId, actor);
        assertEquals("QUESTIONS", result.status());
        assertEquals(List.of("Как округлять цены?"), result.questions());
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void initialMessageIsUsedImmediatelyAndSurvivesClarificationAndRegeneration() throws Exception {
        String instruction = "Мастер-флешам розницу от старой цены минус 10%";
        when(gpt.generate(any())).thenReturn(
                new GptResult("{\"assistantMessage\":\"Нужно уточнение\",\"questions\":[\"Какую единую базу выбрать?\"],\"rows\":[]}", null, null, null),
                new GptResult(completePrices(), null, null, null));
        AiPriceDto.Session first = service.start(receiptId, groupId, "  " + instruction + "  ", actor);
        assertEquals(new AiPriceDto.Message("user", instruction), first.messages().getFirst());
        assertEquals(first.messages(), service.get(first.id()).messages());
        assertEquals(instruction, json.readTree(saved.messagesJson).get(0).path("content").asText());
        AiPriceDto.Session preview = service.message(first.id(), "Выбери минимум для каждого размера");
        assertEquals(instruction, preview.messages().getFirst().content());
        WarehouseDto.Document draft = mock(WarehouseDto.Document.class);
        when(draft.id()).thenAnswer(invocation -> UUID.randomUUID());
        when(warehouse.createDraft(any(), any(), eq(true))).thenReturn(draft);
        service.confirm(first.id(), actor);
        AiPriceDto.Session regenerated = service.regenerate(first.id(), null, actor);
        assertEquals(instruction, regenerated.messages().getFirst().content());
        ArgumentCaptor<kz.company.shop.integrations.gpt.GptRequest> requests =
                ArgumentCaptor.forClass(kz.company.shop.integrations.gpt.GptRequest.class);
        verify(gpt, times(3)).generate(requests.capture());
        for (var request : requests.getAllValues()) {
            var conversation = json.readTree(request.input()).path("conversation");
            assertEquals("user", conversation.get(0).path("role").asText());
            assertEquals(instruction, conversation.get(0).path("content").asText());
        }
    }

    @Test
    void optionalInitialMessageDoesNotCreateEmptyUserTurns() throws Exception {
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));
        for (String message : new String[] {null, "", " \n\t "}) {
            AiPriceDto.Session result = service.start(receiptId, groupId, message, actor);
            assertEquals(1, result.messages().size());
            assertEquals("assistant", result.messages().getFirst().role());
        }
        ArgumentCaptor<kz.company.shop.integrations.gpt.GptRequest> requests =
                ArgumentCaptor.forClass(kz.company.shop.integrations.gpt.GptRequest.class);
        verify(gpt, times(3)).generate(requests.capture());
        for (var request : requests.getAllValues())
            assertEquals(0, json.readTree(request.input()).path("conversation").size());
    }

    @Test
    void tooLongInitialMessageIsRejectedBeforeSessionOrModelCall() {
        assertThrows(AppExceptions.BadRequest.class,
                () -> service.start(receiptId, groupId, "а".repeat(4001), actor));
        verifyNoInteractions(sessions, gpt, warehouse);
    }

    @Test
    void initialMessageAtLimitIsAccepted() {
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));
        AiPriceDto.Session result = service.start(receiptId, groupId, "а".repeat(4000), actor);
        assertEquals(4000, result.messages().getFirst().content().length());
    }

    @Test
    void startRequestAcceptsMissingMessageAndCarriesExplicitMessage() throws Exception {
        var legacy = json.readValue("{\"groupId\":\"" + groupId + "\"}", AiPriceDto.StartRequest.class);
        assertEquals(groupId, legacy.groupId());
        assertNull(legacy.message());
        var explicit = json.readValue("{\"groupId\":\"" + groupId + "\",\"message\":\"Исключение для розницы\"}", AiPriceDto.StartRequest.class);
        assertEquals("Исключение для розницы", explicit.message());
    }

    @Test
    void excludesHistoricalDmitryNoteAndGroupCommentFromModelInput() throws Exception {
        PriceSettingGroup group = groups.findById(groupId).orElseThrow();
        group.commonRules = "Розница 150-599тг +80%<div>ГСКО от чистой приходной +8%</div>"
                + "<div><br></div><div>для Дмитрия доставка 8000, резка 2400, для поиска: трубы</div>";
        group.comment = "Внутренний комментарий группы";
        when(gpt.generate(any())).thenReturn(new GptResult(
                "{\"assistantMessage\":\"Нужно уточнение\",\"questions\":[\"Как округлять?\"],\"rows\":[]}",
                null, null, null));

        service.start(receiptId, groupId, actor);

        ArgumentCaptor<kz.company.shop.integrations.gpt.GptRequest> request =
                ArgumentCaptor.forClass(kz.company.shop.integrations.gpt.GptRequest.class);
        verify(gpt).generate(request.capture());
        var input = json.readTree(request.getValue().input());
        assertTrue(input.path("groupRules").asText().contains("Розница 150-599тг +80%"));
        assertTrue(input.path("groupRules").asText().contains("ГСКО от чистой приходной +8%"));
        assertFalse(input.path("groupRules").asText().contains("для Дмитрия"));
        assertFalse(input.has("groupComment"));
        assertTrue(group.commonRules.contains("для Дмитрия"));
    }

    @Test
    void identifiesReceiptCostAsCleanIncomingAndKeepsOldPriceForComparison() throws Exception {
        when(gpt.generate(any())).thenReturn(new GptResult(
                "{\"assistantMessage\":\"Нужно уточнение\",\"questions\":[\"Как округлять?\"],\"rows\":[]}",
                null, null, null));

        service.start(receiptId, groupId, actor);

        ArgumentCaptor<kz.company.shop.integrations.gpt.GptRequest> request =
                ArgumentCaptor.forClass(kz.company.shop.integrations.gpt.GptRequest.class);
        verify(gpt).generate(request.capture());
        var input = json.readTree(request.getValue().input());
        assertEquals(receiptId.toString(), input.path("cleanIncomingSource").path("documentId").asText());
        assertEquals("SAVED_RECEIPT", input.path("cleanIncomingSource").path("type").asText());
        assertEquals("products[].unitCost", input.path("cleanIncomingSource").path("priceField").asText());
        assertEquals(0, input.path("products").get(0).path("unitCost").decimalValue()
                .compareTo(new BigDecimal("75.123456")));
        assertTrue(input.path("products").get(0).path("prices").path("INCOMING")
                .path("oldPrice").isNull());
        assertEquals(0, input.path("products").get(0).path("prices").path("RETAIL")
                .path("oldPrice").decimalValue().compareTo(new BigDecimal("90")));
        assertTrue(request.getValue().instructions().contains("WHOLESALE (опт) — от рассчитанной розницы RETAIL"));
    }

    @Test
    void historicalNoteAndGroupCommentChangesDoNotInvalidateCalculation() {
        PriceSettingGroup group = groups.findById(groupId).orElseThrow();
        group.commonRules = "Розница +80%<div>для Дмитрия доставка 8000</div>";
        when(gpt.generate(any())).thenReturn(
                new GptResult("{\"assistantMessage\":\"Нужно уточнение\",\"questions\":[\"Как округлять?\"],\"rows\":[]}", null, null, null),
                new GptResult(completePrices(), null, null, null));
        AiPriceDto.Session first = service.start(receiptId, groupId, actor);
        group.commonRules = "Розница +80%<div>для Дмитрия доставка 10000</div>";
        group.comment = "Новая внутренняя заметка";

        AiPriceDto.Session preview = service.message(first.id(), "До целого тенге");

        assertEquals("PREVIEW", preview.status());
    }

    @Test
    void rejectsIncompleteModelPricesWithoutPersistingDocuments() {
        when(gpt.generate(any())).thenReturn(new GptResult("{\"assistantMessage\":\"Готово\",\"questions\":[],\"rows\":[{\"productId\":7,\"prices\":{\"RETAIL\":{\"newPrice\":100,\"reason\":\"Правило\"}}]}", null, null, null));
        assertThrows(AppExceptions.BadRequest.class, () -> service.start(receiptId, groupId, actor));
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void savedDraftReceiptCanStartSessionAndConfirmPrices() {
        StockDocument receipt = documents.findByIdAndDeletedAtIsNull(receiptId).orElseThrow();
        receipt.status = StockDocumentStatus.DRAFT;
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));
        WarehouseDto.Document draft = mock(WarehouseDto.Document.class);
        when(draft.id()).thenAnswer(invocation -> UUID.randomUUID());
        when(warehouse.createDraft(any(), any(), eq(true))).thenReturn(draft);

        AiPriceDto.Session preview = service.start(receiptId, groupId, actor);
        AiPriceDto.Session confirmed = service.confirm(preview.id(), actor);

        assertEquals("CONFIRMED", confirmed.status());
        assertEquals(6, confirmed.createdDocumentIds().size());
        verify(warehouse, times(6)).createDraft(any(), any(), eq(true));
    }

    @Test
    void incomingPriceDraftIsTheSourceAndIsReusedForItsPriceType() throws Exception {
        StockDocument incoming = documents.findByIdAndDeletedAtIsNull(receiptId).orElseThrow();
        incoming.documentType = StockDocumentType.PRICE_SETTING;
        incoming.status = StockDocumentStatus.DRAFT;
        incoming.priceType = StockDocumentPriceType.INCOMING;
        incoming.priceSettingGroupId = groupId;
        StockDocumentLine sourceLine = lines.findByDocumentIdOrderById(receiptId).getFirst();
        sourceLine.unitCost = new BigDecimal("75.12");
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));
        WarehouseDto.Document updated = mock(WarehouseDto.Document.class);
        when(updated.id()).thenReturn(receiptId);
        when(warehouse.applyAiIncomingPrices(eq(receiptId), any(), eq(actor))).thenReturn(updated);
        WarehouseDto.Document created = mock(WarehouseDto.Document.class);
        when(created.id()).thenAnswer(invocation -> UUID.randomUUID());
        when(warehouse.createDraft(any(), any(), eq(true))).thenReturn(created);

        AiPriceDto.Session preview = service.start(receiptId, groupId, actor);
        AiPriceDto.Session confirmed = service.confirm(preview.id(), actor);

        assertEquals("CONFIRMED", confirmed.status());
        assertEquals(6, confirmed.createdDocumentIds().size());
        assertTrue(confirmed.createdDocumentIds().contains(receiptId));
        verify(warehouse).applyAiIncomingPrices(eq(receiptId), any(), eq(actor));
        verify(warehouse, times(5)).createDraft(any(), eq(actor), eq(true));
        ArgumentCaptor<kz.company.shop.integrations.gpt.GptRequest> prompt =
                ArgumentCaptor.forClass(kz.company.shop.integrations.gpt.GptRequest.class);
        verify(gpt).generate(prompt.capture());
        var input = json.readTree(prompt.getValue().input());
        assertEquals("INCOMING_PRICE_DOCUMENT", input.path("cleanIncomingSource").path("type").asText());
        assertEquals(0, input.path("products").get(0).path("unitCost").decimalValue()
                .compareTo(new BigDecimal("75.12")));
    }

    @Test
    void cancelledReceiptCannotStartSession() {
        StockDocument receipt = documents.findByIdAndDeletedAtIsNull(receiptId).orElseThrow();
        receipt.status = StockDocumentStatus.CANCELLED;
        assertThrows(AppExceptions.BadRequest.class, () -> service.start(receiptId, groupId, actor));
        verifyNoInteractions(gpt, warehouse);
    }

    @Test
    void clarificationThenFullPreviewAndIdempotentConfirmation() {
        when(gpt.generate(any())).thenReturn(
                new GptResult("{\"assistantMessage\":\"Нужно уточнение\",\"questions\":[\"Как рассчитать ГСКО?\"],\"rows\":[]}", null, null, null),
                new GptResult(completePrices(), null, null, null));
        AiPriceDto.Session first = service.start(receiptId, groupId, actor);
        assertEquals("QUESTIONS", first.status());
        assertTrue(first.messages().getFirst().content().contains("Как рассчитать ГСКО?"));
        AiPriceDto.Session preview = service.message(first.id(), "Всё верно");
        assertEquals("PREVIEW", preview.status());
        ArgumentCaptor<kz.company.shop.integrations.gpt.GptRequest> prompt =
                ArgumentCaptor.forClass(kz.company.shop.integrations.gpt.GptRequest.class);
        verify(gpt, times(2)).generate(prompt.capture());
        try {
            var followUp = json.readTree(prompt.getAllValues().get(1).input());
            assertEquals("2026-09-25", followUp.path("documentDate").asText());
            assertEquals("Как рассчитать ГСКО?", followUp.path("pendingQuestions").get(0).asText());
            assertEquals("Всё верно", followUp.path("conversation").get(1).path("content").asText());
        } catch (com.fasterxml.jackson.core.JsonProcessingException error) {
            fail(error);
        }
        assertEquals(6, preview.rows().get(0).prices().size());
        assertEquals(new BigDecimal("10.00"), preview.rows().get(0).prices().get(StockDocumentPriceType.RETAIL).changePercent());
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());

        WarehouseDto.Document draft = mock(WarehouseDto.Document.class);
        when(draft.id()).thenAnswer(invocation -> UUID.randomUUID());
        when(warehouse.createDraft(any(), any(), eq(true))).thenReturn(draft);
        AiPriceDto.Session confirmed = service.confirm(first.id(), actor);
        assertEquals("CONFIRMED", confirmed.status());
        assertEquals(6, confirmed.createdDocumentIds().size());
        AiPriceDto.Session repeated = service.confirm(first.id(), actor);
        assertEquals(confirmed.createdDocumentIds(), repeated.createdDocumentIds());
        verify(warehouse, times(6)).createDraft(any(), any(), eq(true));
    }

    @Test
    void changedDocumentDateRequiresNewCalculation() {
        when(gpt.generate(any())).thenReturn(new GptResult(
                "{\"assistantMessage\":\"Нужна дата\",\"questions\":[\"Какая дата?\"],\"rows\":[]}",
                null, null, null));
        AiPriceDto.Session first = service.start(receiptId, groupId, actor);
        StockDocument receipt = documents.findByIdAndDeletedAtIsNull(receiptId).orElseThrow();
        receipt.effectiveDate = receipt.effectiveDate.plusDays(1);

        assertThrows(AppExceptions.BadRequest.class,
                () -> service.message(first.id(), "Всё верно"));
        verify(gpt, times(1)).generate(any());
    }

    @Test
    void manualEditPersistsServerDraftAndChangesComparison() throws Exception {
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));
        AiPriceDto.Session preview = service.start(receiptId, groupId, actor);
        AiPriceDto.Session edited = service.edit(preview.id(), List.of(
                new AiPriceDto.EditRow(7L, java.util.Map.of(StockDocumentPriceType.RETAIL, new BigDecimal("108")))));
        AiPriceDto.Price retail = edited.rows().get(0).prices().get(StockDocumentPriceType.RETAIL);
        assertEquals(new BigDecimal("108.00"), retail.newPrice());
        assertEquals(new BigDecimal("20.00"), retail.changePercent());
        assertEquals("Изменено вручную", retail.reason());
        assertEquals(0, new BigDecimal("108.00").compareTo(json.readTree(saved.rowsJson).get(0)
                .path("prices").path("RETAIL").path("newPrice").decimalValue()));
    }

    @Test
    void changedReceiptCostBlocksConfirmation() {
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));
        AiPriceDto.Session preview = service.start(receiptId, groupId, actor);
        StockDocumentLine changed = new StockDocumentLine();
        changed.productId = 7L;
        changed.quantity = BigDecimal.ONE;
        changed.unitCost = new BigDecimal("76.123456");
        when(lines.findByDocumentIdOrderById(receiptId)).thenReturn(List.of(changed));
        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(preview.id(), actor));
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void masterFlashExceptionHasWholeListContextAndEarlierResultsAcrossBatches() throws Exception {
        java.util.ArrayList<StockDocumentLine> receiptLines = new java.util.ArrayList<>();
        java.util.ArrayList<Product> productList = new java.util.ArrayList<>();
        java.util.Set<Long> productIds = new java.util.HashSet<>();
        for (long id = 1; id <= 26; id++) {
            StockDocumentLine line = new StockDocumentLine();
            line.productId = id;
            line.quantity = BigDecimal.ONE;
            line.unitCost = BigDecimal.TEN;
            receiptLines.add(line);
            Product product = new Product();
            product.id = id;
            product.sku = "SKU-" + id;
            product.nameRu = switch ((int) id) {
                case 1 -> "Мастер-флеш маленький красный";
                case 26 -> "Мастер-флеш маленький серый";
                case 2 -> "Мастер-флеш большой красный";
                case 25 -> "Мастер-флеш большой серый";
                default -> "Товар " + id;
            };
            product.price = switch ((int) id) {
                case 1, 26 -> new BigDecimal("1000");
                case 2, 25 -> new BigDecimal("2000");
                default -> BigDecimal.TEN;
            };
            productList.add(product);
            productIds.add(id);
        }
        when(lines.findByDocumentIdOrderById(receiptId)).thenReturn(receiptLines);
        when(products.findByIdInAndDeletedAtIsNull(productIds)).thenReturn(productList);
        when(gpt.generate(any())).thenAnswer(invocation -> {
            kz.company.shop.integrations.gpt.GptRequest request = invocation.getArgument(0);
            var input = json.readTree(request.input());
            assertEquals(26, input.path("allProducts").size());
            assertEquals("Мастер-флеш маленький красный", input.path("allProducts").get(0).path("productName").asText());
            assertEquals("Мастер-флеш маленький серый", input.path("allProducts").get(25).path("productName").asText());
            assertEquals(1000, input.path("allProducts").get(25).path("oldPrices").path("RETAIL").asInt());
            assertEquals(input.path("batchNumber").asInt() == 1 ? 0 : 25, input.path("previousBatchRows").size());
            assertEquals("user", input.path("conversation").get(0).path("role").asText());
            var rows = json.createArrayNode();
            for (var item : input.path("products")) {
                var row = rows.addObject();
                row.put("productId", item.path("productId").asLong());
                var prices = row.putObject("prices");
                for (StockDocumentPriceType type : StockDocumentPriceType.values()) {
                    var price = prices.putObject(type.name());
                    boolean masterFlash = item.path("productName").asText().startsWith("Мастер-флеш");
                    int value = type == StockDocumentPriceType.RETAIL && masterFlash
                            ? item.path("prices").path("RETAIL").path("oldPrice").decimalValue()
                                    .multiply(new BigDecimal("0.9")).intValueExact() : 11;
                    price.put("newPrice", value);
                    price.put("reason", "Правило группы");
                }
            }
            var output = json.createObjectNode();
            output.put("assistantMessage", "Готово");
            output.set("questions", json.createArrayNode());
            output.set("rows", rows);
            return new GptResult(json.writeValueAsString(output), null, null, null);
        });
        AiPriceDto.Session result = service.start(receiptId, groupId,
                "Приходная по правилам. Всем мастер-флешам старая розница минус 10%. "
                        + "Одинаковая розница для маленьких и отдельно для больших, независимо от цвета.", actor);
        assertEquals("PREVIEW", result.status());
        assertEquals(26, result.rows().size());
        for (int index : new int[] {0, 25}) {
            var retail = result.rows().get(index).prices().get(StockDocumentPriceType.RETAIL);
            assertEquals(new BigDecimal("900.00"), retail.newPrice());
            assertEquals(new BigDecimal("-10.00"), retail.changePercent());
        }
        for (int index : new int[] {1, 24})
            assertEquals(new BigDecimal("1800.00"), result.rows().get(index).prices().get(StockDocumentPriceType.RETAIL).newPrice());
        assertEquals(new BigDecimal("11.00"), result.rows().getFirst().prices().get(StockDocumentPriceType.INCOMING).newPrice());
        verify(gpt, times(2)).generate(any());
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void differentMasterFlashPricesInLaterBatchRequireClarificationBeforePreview() throws Exception {
        java.util.ArrayList<StockDocumentLine> receiptLines = new java.util.ArrayList<>();
        java.util.ArrayList<Product> productList = new java.util.ArrayList<>();
        java.util.Set<Long> productIds = new java.util.HashSet<>();
        for (long id = 1; id <= 26; id++) {
            StockDocumentLine line = new StockDocumentLine();
            line.productId = id;
            line.quantity = BigDecimal.ONE;
            line.unitCost = BigDecimal.TEN;
            receiptLines.add(line);
            Product product = new Product();
            product.id = id;
            product.sku = "SKU-" + id;
            product.nameRu = id == 1 ? "Мастер-флеш маленький красный"
                    : id == 26 ? "Мастер-флеш маленький серый" : "Товар " + id;
            product.price = id == 1 ? new BigDecimal("1000")
                    : id == 26 ? new BigDecimal("1200") : BigDecimal.TEN;
            productList.add(product);
            productIds.add(id);
        }
        when(lines.findByDocumentIdOrderById(receiptId)).thenReturn(receiptLines);
        when(products.findByIdInAndDeletedAtIsNull(productIds)).thenReturn(productList);
        when(gpt.generate(any())).thenReturn(
                new GptResult("{\"assistantMessage\":\"\",\"questions\":[],\"rows\":[]}", null, null, null),
                new GptResult("{\"assistantMessage\":\"Нужно уточнение\",\"questions\":[\"Какую единую старую розницу выбрать для маленьких мастер-флешей: 1000 или 1200?\"],\"rows\":[]}", null, null, null));
        AiPriceDto.Session result = service.start(receiptId, groupId,
                "Мастер-флешам старая розница минус 10%. Выровняй по размеру независимо от цвета.", actor);
        assertEquals("QUESTIONS", result.status());
        assertEquals(26, result.rows().size());
        assertEquals(List.of("Какую единую старую розницу выбрать для маленьких мастер-флешей: 1000 или 1200?"), result.questions());
        assertTrue(result.rows().stream().allMatch(row ->
                row.prices().values().stream().allMatch(price -> price.newPrice() == null)));
        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(result.id(), actor));
        ArgumentCaptor<kz.company.shop.integrations.gpt.GptRequest> requests =
                ArgumentCaptor.forClass(kz.company.shop.integrations.gpt.GptRequest.class);
        verify(gpt, times(2)).generate(requests.capture());
        for (var request : requests.getAllValues()) {
            var context = json.readTree(request.input()).path("allProducts");
            assertEquals(1000, context.get(0).path("oldPrices").path("RETAIL").asInt());
            assertEquals(1200, context.get(25).path("oldPrices").path("RETAIL").asInt());
        }
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    @Test
    void regenerateAfterDeletionCopiesConversationAndUsesCurrentSource() throws Exception {
        UUID deleted = UUID.randomUUID();
        AiPriceSession parent = confirmedParent(List.of(deleted));
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));
        StockDocumentLine currentLine = lines.findByDocumentIdOrderById(receiptId).getFirst();
        currentLine.unitCost = new BigDecimal("81.50");

        AiPriceDto.Session child = service.regenerate(parent.id, "Считай розницу по новому порогу", actor);

        assertNotEquals(parent.id, child.id());
        assertEquals("PREVIEW", child.status());
        assertEquals(parent.id, persisted.get(child.id()).parentSessionId);
        assertEquals(4, child.messages().size());
        assertEquals("Уточнение прежней сессии", child.messages().get(1).content());
        assertEquals("Считай розницу по новому порогу", child.messages().get(2).content());
        assertEquals(0, new BigDecimal("81.50").compareTo(child.rows().getFirst().unitCost()));
        assertEquals("CONFIRMED", parent.status);
        assertEquals("[\"" + deleted + "\"]", parent.createdDocumentIdsJson);
        ArgumentCaptor<kz.company.shop.integrations.gpt.GptRequest> prompt =
                ArgumentCaptor.forClass(kz.company.shop.integrations.gpt.GptRequest.class);
        verify(gpt).generate(prompt.capture());
        var input = json.readTree(prompt.getValue().input());
        assertEquals("REGENERATE", input.path("generationMode").asText());
        assertEquals("Считай розницу по новому порогу",
                input.path("conversation").get(2).path("content").asText());

        AiPriceDto.Session repeated = service.regenerate(parent.id, "Другой запрос", actor);
        assertEquals(child.id(), repeated.id());
        verify(gpt, times(1)).generate(any());
    }

    @Test
    void regenerateWithoutMessageDoesNotAddFakeChatTurn() {
        AiPriceSession parent = confirmedParent(List.of(UUID.randomUUID()));
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));

        AiPriceDto.Session child = service.regenerate(parent.id, null, actor);

        assertEquals(3, child.messages().size());
        assertEquals("assistant", child.messages().getLast().role());
    }

    @Test
    void unconfirmedSessionCannotRegenerate() {
        AiPriceSession parent = confirmedParent(List.of());
        parent.status = "PREVIEW";
        assertThrows(AppExceptions.BadRequest.class,
                () -> service.regenerate(parent.id, null, actor));
        verifyNoInteractions(gpt);
    }

    @Test
    void activeGeneratedDocumentBlocksRegenerationAndIsVisibleInResponse() {
        UUID activeId = UUID.randomUUID();
        AiPriceSession parent = confirmedParent(List.of(activeId));
        StockDocument active = new StockDocument();
        active.id = activeId;
        active.documentType = StockDocumentType.PRICE_SETTING;
        active.status = StockDocumentStatus.DRAFT;
        when(documents.findByIdAndDeletedAtIsNull(activeId)).thenReturn(Optional.of(active));

        AiPriceDto.Session view = service.get(parent.id);
        assertEquals(List.of(activeId), view.activeGeneratedDocumentIds());
        assertFalse(view.canRegenerate());
        assertThrows(AppExceptions.BadRequest.class, () -> service.regenerate(parent.id, null, actor));
        verifyNoInteractions(gpt);
    }

    @Test
    void sourceIncomingDraftMayRemainActiveWhileOtherGeneratedDocumentsAreDeleted() {
        StockDocument source = documents.findByIdAndDeletedAtIsNull(receiptId).orElseThrow();
        source.documentType = StockDocumentType.PRICE_SETTING;
        source.status = StockDocumentStatus.DRAFT;
        source.priceType = StockDocumentPriceType.INCOMING;
        source.priceSettingGroupId = groupId;
        UUID deleted = UUID.randomUUID();
        AiPriceSession parent = confirmedParent(List.of(receiptId, deleted));
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));

        AiPriceDto.Session view = service.get(parent.id);
        assertEquals(List.of(receiptId), view.activeGeneratedDocumentIds());
        assertTrue(view.canRegenerate());
        AiPriceDto.Session child = service.regenerate(parent.id, null, actor);
        assertEquals("PREVIEW", child.status());
        WarehouseDto.Document updated = mock(WarehouseDto.Document.class);
        when(updated.id()).thenReturn(receiptId);
        when(warehouse.applyAiIncomingPrices(eq(receiptId), any(), eq(actor))).thenReturn(updated);
        WarehouseDto.Document created = mock(WarehouseDto.Document.class);
        when(created.id()).thenAnswer(invocation -> UUID.randomUUID());
        when(warehouse.createDraft(any(), eq(actor), eq(true))).thenReturn(created);

        AiPriceDto.Session confirmedChild = service.confirm(child.id(), actor);
        assertEquals("CONFIRMED", confirmedChild.status());
        assertTrue(confirmedChild.createdDocumentIds().contains(receiptId));
        verify(warehouse).applyAiIncomingPrices(eq(receiptId), any(), eq(actor));
        verify(warehouse, times(5)).createDraft(any(), eq(actor), eq(true));
        verify(gpt).generate(any());
    }

    @Test
    void newlyActiveOldDocumentBlocksChildConfirmation() {
        UUID oldId = UUID.randomUUID();
        AiPriceSession parent = confirmedParent(List.of(oldId));
        when(gpt.generate(any())).thenReturn(new GptResult(completePrices(), null, null, null));
        AiPriceDto.Session child = service.regenerate(parent.id, null, actor);
        StockDocument active = new StockDocument();
        active.id = oldId;
        active.documentType = StockDocumentType.PRICE_SETTING;
        active.status = StockDocumentStatus.DRAFT;
        when(documents.findByIdAndDeletedAtIsNull(oldId)).thenReturn(Optional.of(active));

        assertThrows(AppExceptions.BadRequest.class, () -> service.confirm(child.id(), actor));
        verify(warehouse, never()).createDraft(any(), any(), anyBoolean());
        verify(warehouse, never()).applyAiIncomingPrices(any(), any(), any());
    }

    private AiPriceSession confirmedParent(List<UUID> createdIds) {
        AiPriceSession parent = new AiPriceSession();
        parent.id = UUID.randomUUID();
        parent.receiptId = receiptId;
        parent.groupId = groupId;
        parent.groupName = "Группа";
        parent.status = "CONFIRMED";
        parent.messagesJson = "[{\"role\":\"assistant\",\"content\":\"Первый ответ\"},"
                + "{\"role\":\"user\",\"content\":\"Уточнение прежней сессии\"}]";
        try { parent.createdDocumentIdsJson = json.writeValueAsString(createdIds); }
        catch (com.fasterxml.jackson.core.JsonProcessingException error) { throw new AssertionError(error); }
        persisted.put(parent.id, parent);
        return parent;
    }

    private String completePrices() {
        StringBuilder prices = new StringBuilder();
        for (StockDocumentPriceType type : StockDocumentPriceType.values()) {
            if (!prices.isEmpty()) prices.append(',');
            prices.append('"').append(type.name()).append("\":{\"newPrice\":99,\"reason\":\"Уточнённое правило\"}");
        }
        return "{\"assistantMessage\":\"Готово\",\"questions\":[],\"rows\":[{\"productId\":7,\"prices\":{" + prices + "}}]}";
    }
}
