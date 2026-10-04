package kz.company.shop.orders.ai;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.*;
import kz.company.shop.integrations.gpt.*;
import kz.company.shop.orders.ai.OrderAssistantDto.*;
import kz.company.shop.orders.dto.*;
import kz.company.shop.orders.entity.*;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.orders.service.*;
import kz.company.shop.products.entity.*;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import kz.company.shop.regularbuyers.repository.RegularBuyerRepository;
import kz.company.shop.regularbuyers.service.RegularBuyerAliasLearningService;
import kz.company.shop.warehouse.repository.WarehouseCounterpartyRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class OrderAssistantServiceTest {
    final OrderAssistantSessionRepository sessions = mock(OrderAssistantSessionRepository.class);
    final OrderAssistantMemoryRepository memories = mock(OrderAssistantMemoryRepository.class);
    final ProductRepository products = mock(ProductRepository.class);
    final RegularBuyerRepository buyers = mock(RegularBuyerRepository.class);
    final WarehouseCounterpartyRepository suppliers = mock(WarehouseCounterpartyRepository.class);
    final BarcodeOrderService barcode = mock(BarcodeOrderService.class);
    final OrderService orders = mock(OrderService.class);
    final OrderRepository orderRepository = mock(OrderRepository.class);
    final GptProvider gpt = mock(GptProvider.class);
    final RegularBuyerAliasLearningService aliasLearning =
            mock(RegularBuyerAliasLearningService.class);
    final AuthContext auth = mock(AuthContext.class);
    final ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    final Map<UUID, OrderAssistantSession> stored = new HashMap<>();
    final LocalDate day = LocalDate.of(2026, 1, 1);
    OrderAssistantService service;

    @BeforeEach
    void setup() {
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                7L,
                                "a@b.test",
                                "User",
                                null,
                                Set.of("orders.update", "warehouse.read"),
                                true,
                                BigDecimal.ZERO));
        when(sessions.save(any()))
                .thenAnswer(
                        i -> {
                            OrderAssistantSession s = i.getArgument(0);
                            stored.put(s.id, s);
                            return s;
                        });
        when(sessions.lockOwned(any(), eq(7L)))
                .thenAnswer(i -> Optional.ofNullable(stored.get(i.getArgument(0))));
        when(sessions.findByIdAndOwnerId(any(), eq(7L)))
                .thenAnswer(i -> Optional.ofNullable(stored.get(i.getArgument(0))));
        service =
                new OrderAssistantService(
                        sessions,
                        memories,
                        products,
                        buyers,
                        suppliers,
                        barcode,
                        orders,
                        orderRepository,
                        gpt,
                        json,
                        auth,
                        aliasLearning);
        product(1L, "Лук репчатый");
        product(2L, "Картофель");
    }

    Product product(long id, String name) {
        Product p = new Product();
        p.id = id;
        p.sku = "P" + id;
        p.nameRu = name;
        p.price = new BigDecimal("10.00");
        p.measurementUnit = MeasurementUnit.KG;
        when(products.findByIdAndDeletedAtIsNull(id)).thenReturn(Optional.of(p));
        when(barcode.findProduct(eq(p.sku), any(), any()))
                .thenReturn(
                        new BarcodeOrderProductDto(
                                id,
                                p.sku,
                                name,
                                null,
                                false,
                                p.price,
                                p.price,
                                p.price,
                                p.price,
                                MeasurementUnit.KG));
        return p;
    }

    Session start(Mode mode, List<SeedItem> items) {
        return service.start(
                new Start(mode, PriceTier.RETAIL, day, null, null, null, null, "Тест", items));
    }

    SeedItem seed(long id) {
        return new SeedItem(id, BigDecimal.ONE, MeasurementUnit.KG, new BigDecimal("10.00"));
    }

    Session respond(Session s, String output) {
        when(gpt.generate(any())).thenReturn(new GptResult(output, null, null, null));
        return service.message(s.id(), new Message("Уточнение", s.revision()));
    }

    String row(long id, String source, String quantity, String unit) {
        return "{\"productId\":"
                + id
                + ",\"source\":\""
                + source
                + "\",\"quantity\":"
                + quantity
                + ",\"measurementUnit\":"
                + (unit == null ? "null" : "\"" + unit + "\"")
                + "}";
    }

    OrderDto order(UUID id) throws Exception {
        return json.readValue(
                "{\"id\":\""
                        + id
                        + "\",\"createdByUserId\":7,\"status\":\"PROCESSING\",\"items\":[]}",
                OrderDto.class);
    }

    @Test
    void foreignSessionIsNotFoundBeforeProviderOrMutation() {
        assertThatThrownBy(() -> service.message(UUID.randomUUID(), new Message("заявка", 0)))
                .isInstanceOf(AppExceptions.NotFound.class);
        verifyNoInteractions(gpt, barcode, orders);
    }

    @Test
    void staleRevisionCannotChangeProposalOrCallProvider() {
        Session s = start(Mode.DRAFT, List.of(seed(1)));
        assertThatThrownBy(() -> service.message(s.id(), new Message("лук 5", 9)))
                .hasMessageContaining("изменился");
        verifyNoInteractions(gpt);
        assertThat(service.get(s.id()).revision()).isZero();
    }

    @Test
    void unknownProductAndUnsupportedUnitBlockApply() {
        Session s =
                respond(
                        start(Mode.CREATE, List.of()),
                        "{\"items\":[" + row(999, "Масло 10 л", "10", "L") + "]}");
        assertThat(s.ready()).isFalse();
        assertThat(s.proposal().items()).hasSize(1);
        assertThatThrownBy(() -> service.apply(s.id(), new Apply(s.revision(), false)))
                .hasMessageContaining("уточнения");
        verify(barcode, never()).create(any(), any());
    }

    @Test
    void catalogUnitMismatchAndMissingUnitCannotBeApplied() {
        Session s =
                respond(
                        start(Mode.CREATE, List.of()),
                        "{\"items\":["
                                + row(1, "лук", "3", "PIECE")
                                + ","
                                + row(2, "картофель", "0.150", null)
                                + "]}");
        assertThat(s.ready()).isFalse();
        assertThat(s.proposal().items()).allSatisfy(i -> assertThat(i.issue()).isNotBlank());
    }

    @Test
    void duplicateProductQuantitiesMustBeClarified() {
        Session s =
                respond(
                        start(Mode.CREATE, List.of()),
                        "{\"items\":["
                                + row(1, "лук", "3", "KG")
                                + ","
                                + row(1, "лук реп", "4", "KG")
                                + "]}");
        assertThat(s.ready()).isFalse();
        assertThat(s.proposal().questions()).anyMatch(q -> q.contains("повторяется"));
    }

    @Test
    void omittedExistingRowsRequireAnotherConfirmation() {
        Session s =
                respond(
                        start(Mode.DRAFT, List.of(seed(1), seed(2))),
                        "{\"items\":[" + row(1, "Лук репчатый", "5", "KG") + "]}");
        assertThat(s.ready()).isFalse();
        assertThat(s.proposal().questions()).anyMatch(q -> q.contains("Картофель"));
        assertThatThrownBy(() -> service.apply(s.id(), new Apply(s.revision(), false)))
                .hasMessageContaining("уточнения");
    }

    @Test
    void draftApplicationHasNoPersistedOrderSideEffectsAndIsIdempotent() {
        Session s = start(Mode.DRAFT, List.of(seed(1)));
        Session applied = service.apply(s.id(), new Apply(s.revision(), false));
        assertThat(applied.orderId()).isNull();
        assertThat(applied.appliedRevision()).isZero();
        int count = applied.messages().size();
        assertThat(service.apply(s.id(), new Apply(s.revision(), false)).messages()).hasSize(count);
        verifyNoInteractions(orders, orderRepository);
        verify(barcode, never()).create(any(), any());
        verify(memories, times(1)).save(any());
    }

    @Test
    void doubleCreateReturnsSameOrderAndDoesNotDuplicate() throws Exception {
        UUID id = UUID.randomUUID();
        when(barcode.create(any(), eq(7L))).thenReturn(order(id));
        Session s = start(Mode.CREATE, List.of(seed(1)));
        assertThat(service.apply(s.id(), new Apply(0, false)).orderId()).isEqualTo(id);
        assertThat(service.apply(s.id(), new Apply(0, false)).orderId()).isEqualTo(id);
        verify(barcode, times(1)).create(any(), eq(7L));
    }

    @Test
    void stockShortageOverrideRequiresSeparatePermission() {
        Session s = start(Mode.CREATE, List.of(seed(1)));
        doThrow(new AppExceptions.Forbidden("warehouse.negative_stock"))
                .when(auth)
                .require("warehouse.negative_stock");
        assertThatThrownBy(() -> service.apply(s.id(), new Apply(0, true)))
                .isInstanceOf(AppExceptions.Forbidden.class);
        verify(barcode, never()).create(any(), any());
    }

    @Test
    void providerFailureKeepsHistoryAndDraftUnchanged() {
        Session s = start(Mode.DRAFT, List.of(seed(1)));
        when(gpt.generate(any())).thenThrow(new GptProviderException("secret-upstream-body"));
        assertThatThrownBy(() -> service.message(s.id(), new Message("текст", 0)))
                .hasMessageContaining("OPENAI_API_KEY")
                .hasMessageNotContaining("secret-upstream-body");
        assertThat(service.get(s.id())).isEqualTo(s);
    }

    @Test
    void malformedResponseCannotEraseDraft() {
        Session s = start(Mode.DRAFT, List.of(seed(1)));
        assertThatThrownBy(() -> respond(s, "{\"items\":null}"))
                .hasMessageContaining("некорректный");
        assertThat(service.get(s.id())).isEqualTo(s);
    }

    @Test
    void modelDoesNotSetPricesAndSeedPriceIsPreserved() {
        Session s =
                respond(
                        start(
                                Mode.DRAFT,
                                List.of(
                                        new SeedItem(
                                                1L,
                                                BigDecimal.ONE,
                                                MeasurementUnit.KG,
                                                new BigDecimal("9.50")))),
                        "{\"items\":[{\"productId\":1,\"source\":\"Лук репчатый\",\"quantity\":2,\"measurementUnit\":\"KG\",\"unitPrice\":0.01}]}");
        assertThat(s.proposal().items().get(0).unitPrice()).isEqualByComparingTo("9.50");
    }

    @Test
    void correctedProductAliasIsSavedOnlyAfterApply() {
        Session s =
                respond(
                        start(Mode.DRAFT, List.of()),
                        "{\"items\":[" + row(1, "Лук реп 4 кг", "4", "KG") + "]}");
        verify(memories, never()).save(any());
        service.apply(s.id(), new Apply(s.revision(), false));
        ArgumentCaptor<OrderAssistantMemory> cap =
                ArgumentCaptor.forClass(OrderAssistantMemory.class);
        verify(memories).save(cap.capture());
        assertThat(cap.getValue().source).isEqualTo("лук реп");
        assertThat(cap.getValue().targetId).isEqualTo("1");
        assertThat(cap.getValue().ownerId).isEqualTo(7);
    }

    @Test
    void completeVikingAndGarageListsRetainAllLinesIncludingUnresolvedOnes() {
        for (int count : List.of(22, 15)) {
            List<String> rows = new ArrayList<>();
            for (int n = 1; n <= count; n++) {
                product(n, "Товар " + n);
                rows.add(
                        row(
                                n,
                                "Строка " + n,
                                n == count ? "0.150" : "1",
                                n == count ? null : "KG"));
            }
            Session s =
                    respond(
                            start(Mode.DRAFT, List.of()),
                            "{\"items\":[" + String.join(",", rows) + "]}");
            assertThat(s.proposal().items()).hasSize(count);
            assertThat(s.ready()).isFalse();
            assertThat(s.proposal().items().get(count - 1).quantity())
                    .isEqualByComparingTo("0.150");
        }
    }

    @Test
    void fingerprintNormalizesDatabaseDecimalScaleAndRounding() throws Exception {
        OrderDto original =
                json.readValue(
                        "{\"total\":1.63959,\"createdAt\":\"2026-01-01T00:00:00.123456789Z\",\"items\":[{\"id\":1,\"quantity\":1.333,\"unitPrice\":1.23,\"lineTotal\":1.63959}]}",
                        OrderDto.class);
        OrderDto persisted =
                json.readValue(
                        "{\"total\":1.64,\"createdAt\":\"2026-01-01T00:00:00.123457Z\",\"items\":[{\"id\":1,\"quantity\":1.333,\"unitPrice\":1.2300,\"lineTotal\":1.64}]}",
                        OrderDto.class);
        assertThat(service.fingerprint(original)).isEqualTo(service.fingerprint(persisted));
    }

    @Test
    void onlySessionCreatedOrderCanBeChangedAndExternalChangesBlockApply() throws Exception {
        UUID id = UUID.randomUUID();
        when(barcode.create(any(), eq(7L))).thenReturn(order(id));
        Session s = service.apply(start(Mode.CREATE, List.of(seed(1))).id(), new Apply(0, false));
        s = respond(s, "{\"items\":[" + row(1, "Лук репчатый", "5", "KG") + "]}");
        Order entity = new Order();
        entity.id = id;
        entity.createdByUserId = 7L;
        when(orderRepository.findForUpdateById(id)).thenReturn(Optional.of(entity));
        when(orders.adminGet(id))
                .thenReturn(
                        json.readValue(
                                "{\"id\":\""
                                        + id
                                        + "\",\"comment\":\"External change\",\"items\":[]}",
                                OrderDto.class));
        Session changed = s;
        assertThatThrownBy(() -> service.apply(changed.id(), new Apply(changed.revision(), false)))
                .hasMessageContaining("вне этого диалога");
        verify(orders, never())
                .replaceAssistantItems(any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void pendingDeletionSurvivesUnrelatedMessagesUntilExplicitConfirmation() {
        Session s =
                respond(
                        start(Mode.DRAFT, List.of(seed(1), seed(2))),
                        "{\"items\":[" + row(1, "Лук репчатый", "5", "KG") + "]}");
        s = respond(s, "{\"items\":[" + row(1, "Лук репчатый", "6", "KG") + "]}");
        assertThat(s.ready()).isFalse();
        s = service.message(s.id(), new Message("Подтверждаю удаление", s.revision()));
        assertThat(s.ready()).isTrue();
    }

    @Test
    void productGradesAreNotCollapsedInMemory() {
        assertThat(OrderAssistantService.normalizeSource("Яйца С0")).isEqualTo("яйца с0");
        assertThat(OrderAssistantService.normalizeSource("Яйца С1")).isEqualTo("яйца с1");
        assertThat(OrderAssistantService.normalizeSource("Лук репчатый4 кг"))
                .isEqualTo("лук репчатый");
    }

    @Test
    void supplierCommentIsReplacedWithoutAccumulation() {
        assertThat(
                        OrderAssistantService.withoutSupplierNote(
                                "Заказ\nПоставщик (справочно): Старый\nПримечание"))
                .isEqualTo("Заказ\nПримечание");
    }

    @Test
    void sharedBuyerAliasesAreSentToModelAndResolveToOfficialBuyer() throws Exception {
        RegularBuyer buyer = buyer("ТОО Север", "Викинг", "Кафе Ёлка");
        when(buyers.findByArchivedFalseOrderByNameAsc()).thenReturn(List.of(buyer));
        Session result =
                respond(start(Mode.DRAFT, List.of()), buyerResponse(buyer.id, "кафе   елка"));
        assertThat(result.ready()).isTrue();
        assertThat(result.proposal().regularBuyerName()).isEqualTo("ТОО Север");
        ArgumentCaptor<GptRequest> sent = ArgumentCaptor.forClass(GptRequest.class);
        verify(gpt).generate(sent.capture());
        var directory = json.readTree(sent.getValue().input()).path("regularBuyers").get(0);
        assertThat(directory.path("aliases").get(0).asText()).isEqualTo("Викинг");
        assertThat(directory.path("aliases").get(1).asText()).isEqualTo("Кафе Ёлка");
        assertThat(directory.has("comment")).isFalse();
    }

    @Test
    void sharedAliasCollisionRequiresClarificationEvenIfModelPicksOneBuyer() {
        RegularBuyer first = buyer("ТОО Север", "Гараж");
        RegularBuyer second = buyer("ИП Юг", "гараж");
        when(buyers.findByArchivedFalseOrderByNameAsc()).thenReturn(List.of(first, second));
        Session result = respond(start(Mode.DRAFT, List.of()), buyerResponse(first.id, " ГАРАЖ "));
        assertThat(result.ready()).isFalse();
        assertThat(result.proposal().questions())
                .anyMatch(q -> q.contains("несколькими покупателями"));
        Session clarified = respond(result, buyerResponse(second.id, "ИП Юг"));
        assertThat(clarified.ready()).isTrue();
        assertThat(clarified.proposal().regularBuyerId()).isEqualTo(second.id);
    }

    @Test
    void stalePersonalMappingCannotOverrideSharedAlias() {
        RegularBuyer assigned = buyer("ТОО Север", "Викинг");
        RegularBuyer wrong = buyer("ИП Юг", "Южный");
        when(buyers.findByArchivedFalseOrderByNameAsc()).thenReturn(List.of(assigned, wrong));
        Session result = respond(start(Mode.DRAFT, List.of()), buyerResponse(wrong.id, "Викинг"));
        assertThat(result.ready()).isFalse();
        assertThat(result.proposal().questions()).anyMatch(q -> q.contains("ТОО Север"));
    }

    private void allowAliasManagement() {
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                7L,
                                "a@b.test",
                                "User",
                                null,
                                Set.of("orders.update", "warehouse.read", "regular-buyers.manage"),
                                true,
                                BigDecimal.ZERO));
    }

    private Session aliasMessage(
            Session session, RegularBuyer buyer, String alias, String message) {
        var response = json.createObjectNode();
        response.put("regularBuyerId", buyer.id.toString());
        response.put("buyerSource", buyer.name);
        response.put("message", "Покупатель выбран");
        response.putArray("items");
        response.putArray("questions").add("Уточните товар");
        var suggestion = response.putObject("buyerAliasSuggestion");
        suggestion.put("alias", alias);
        suggestion.put("buyerId", buyer.id.toString());
        when(gpt.generate(any())).thenReturn(new GptResult(response.toString(), null, null, null));
        return service.message(session.id(), new Message(message, session.revision()));
    }

    @Test
    void aliasHeaderOnlyProposesAndShortConfirmationPreservesProductQuestionsWithoutCallingModel() {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север", "Северный");
        Session pending = aliasMessage(start(Mode.DRAFT, List.of()), buyer, "Викинг", "Викинг");
        verifyNoInteractions(aliasLearning);
        assertThat(pending.proposal().buyerAliasSuggestion().alias()).isEqualTo("Викинг");
        assertThat(pending.messages().get(pending.messages().size() - 1).content())
                .isEqualTo(OrderAssistantAliasApproval.question("Викинг", buyer.name));
        when(aliasLearning.append(buyer.id, "Викинг"))
                .thenReturn(
                        new RegularBuyerAliasLearningService.Result(
                                RegularBuyerAliasLearningService.Status.ADDED, buyer.name));
        clearInvocations(gpt);
        Session saved = service.message(pending.id(), new Message("Да", pending.revision()));
        verifyNoInteractions(gpt);
        verify(aliasLearning).append(buyer.id, "Викинг");
        assertThat(saved.proposal().buyerAliasSuggestion()).isNull();
        assertThat(saved.proposal().regularBuyerId()).isEqualTo(buyer.id);
        assertThat(saved.proposal().questions()).contains("Уточните товар");
        assertThat(saved.ready()).isFalse();
        assertThat(saved.messages().get(saved.messages().size() - 1).content())
                .contains("добавлено");
    }

    @Test
    void explicitFullMappingAddsSharedAliasBeforeOrderIsReady() {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север");
        when(aliasLearning.append(buyer.id, "Викинг"))
                .thenReturn(
                        new RegularBuyerAliasLearningService.Result(
                                RegularBuyerAliasLearningService.Status.ADDED, buyer.name));
        Session saved =
                aliasMessage(
                        start(Mode.DRAFT, List.of()), buyer, "Викинг", "Викинг — это ТОО Север");
        verify(aliasLearning).append(buyer.id, "Викинг");
        assertThat(saved.ready()).isFalse();
        assertThat(saved.proposal().buyerAliasSuggestion()).isNull();
    }

    @Test
    void rejectedAliasDoesNotChangeOrderOrCallModel() {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север");
        Session pending = aliasMessage(start(Mode.DRAFT, List.of()), buyer, "Викинг", "Викинг");
        clearInvocations(gpt);
        Session rejected = service.message(pending.id(), new Message("Нет", pending.revision()));
        verifyNoInteractions(gpt, aliasLearning);
        assertThat(rejected.proposal().buyerAliasSuggestion()).isNull();
        assertThat(rejected.proposal().questions()).isEqualTo(pending.proposal().questions());
    }

    @Test
    void orderPermissionAloneCannotAddSharedAlias() {
        RegularBuyer buyer = buyer("ТОО Север");
        Session saved =
                aliasMessage(
                        start(Mode.DRAFT, List.of()), buyer, "Викинг", "Викинг — это ТОО Север");
        verifyNoInteractions(aliasLearning);
        assertThat(saved.messages().get(saved.messages().size() - 1).content())
                .contains("требуется право");
    }

    @Test
    void fabricatedOrAlreadyKnownAliasIsNotOffered() {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север", "Викинг");
        Session saved =
                aliasMessage(
                        start(Mode.DRAFT, List.of()), buyer, "Викинг", "Викинг — это ТОО Север");
        assertThat(saved.proposal().buyerAliasSuggestion()).isNull();
        saved = aliasMessage(saved, buyer, "Выдумка", "Продолжим");
        assertThat(saved.proposal().buyerAliasSuggestion()).isNull();
        verifyNoInteractions(aliasLearning);
    }

    @Test
    void collisionReportedWithoutClaimingTagWasSaved() {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север");
        when(aliasLearning.append(buyer.id, "Викинг"))
                .thenReturn(
                        new RegularBuyerAliasLearningService.Result(
                                RegularBuyerAliasLearningService.Status.CONFLICT, buyer.name));
        Session saved =
                aliasMessage(start(Mode.DRAFT, List.of()), buyer, "Викинг", "Викинг = ТОО Север");
        assertThat(saved.messages().get(saved.messages().size() - 1).content())
                .contains("не добавлено", "другим покупателем");
    }

    @Test
    void unrelatedYesCannotApproveNewPairFromModel() {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север");
        Session pending = aliasMessage(start(Mode.DRAFT, List.of()), buyer, "Викинг", "Викинг");
        // An intervening assistant message invalidates the dedicated confirmation context.
        var state = stored.get(pending.id());
        state.messagesJson =
                "[{\"role\":\"user\",\"content\":\"Викинг\"},{\"role\":\"assistant\",\"content\":\"Заменить товар?\"}]";
        RegularBuyer other = buyer("ИП Юг");
        Session result = aliasMessage(pending, other, "Викинг", "Да");
        verifyNoInteractions(aliasLearning);
        assertThat(result.proposal().buyerAliasSuggestion().buyerId()).isEqualTo(other.id);
    }

    @Test
    void pendingAliasCanBeConfirmedAfterApplyingOrderDraft() throws Exception {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север");
        Session ready = respond(start(Mode.DRAFT, List.of()), buyerResponse(buyer.id, buyer.name));
        Proposal p = ready.proposal();
        var state = stored.get(ready.id());
        state.proposalJson =
                json.writeValueAsString(
                        new Proposal(
                                p.regularBuyerId(),
                                p.regularBuyerName(),
                                p.supplierId(),
                                p.supplierName(),
                                p.customerId(),
                                p.pendingCustomerEmail(),
                                p.pendingCustomerPhone(),
                                p.comment(),
                                p.items(),
                                p.questions(),
                                p.buyerSource(),
                                p.supplierSource(),
                                new BuyerAliasSuggestion("Викинг", buyer.id, buyer.name)));
        Session applied = service.apply(ready.id(), new Apply(ready.revision(), false));
        assertThat(applied.messages().get(applied.messages().size() - 1).content())
                .isEqualTo(OrderAssistantAliasApproval.question("Викинг", buyer.name));
        when(aliasLearning.append(buyer.id, "Викинг"))
                .thenReturn(
                        new RegularBuyerAliasLearningService.Result(
                                RegularBuyerAliasLearningService.Status.ADDED, buyer.name));
        clearInvocations(gpt);
        service.message(applied.id(), new Message("Да", applied.revision()));
        verifyNoInteractions(gpt);
        verify(aliasLearning).append(buyer.id, "Викинг");
    }

    private Session questionSession(
            List<String> questions,
            List<Clarification> clarifications,
            String source,
            BuyerAliasSuggestion alias)
            throws Exception {
        Session session = start(Mode.DRAFT, List.of(seed(1)));
        Proposal p = session.proposal();
        stored.get(session.id()).proposalJson =
                json.writeValueAsString(
                        new Proposal(
                                null,
                                null,
                                p.supplierId(),
                                p.supplierName(),
                                p.customerId(),
                                p.pendingCustomerEmail(),
                                p.pendingCustomerPhone(),
                                p.comment(),
                                p.items(),
                                questions,
                                source,
                                p.supplierSource(),
                                alias,
                                clarifications,
                                false));
        return service.get(session.id());
    }

    private Clarification choice(String question) {
        return new Clarification(
                null,
                ClarificationKind.CHOICE,
                question,
                List.of(new AnswerOption(null, "Да", "да"), new AnswerOption(null, "Нет", "нет")));
    }

    private Message select(Session s, UUID buyerId) {
        return new Message(null, s.revision(), null, buyerId, true);
    }

    @Test
    void interactiveActionValidationRejectsMixedAndEmptyActions() {
        Session s = start(Mode.DRAFT, List.of(seed(1)));
        for (Message message :
                List.of(
                        new Message(null, 0, null, null, false),
                        new Message("да", 0, "id", null, false),
                        new Message("да", 0, null, UUID.randomUUID(), true),
                        new Message(null, 0, "id", UUID.randomUUID(), false)))
            assertThatThrownBy(() -> service.message(s.id(), message))
                    .hasMessageContaining("одно действие");
        verifyNoInteractions(gpt, aliasLearning);
    }

    @Test
    void choiceIdsAreStableScopedAndRejectStaleAnswerOrRevision() throws Exception {
        Session s =
                questionSession(
                        List.of("Заменить картофель?"),
                        List.of(choice("Заменить картофель?")),
                        null,
                        null);
        String id = s.proposal().clarifications().get(0).options().get(0).id();
        assertThat(service.get(s.id()).proposal().clarifications())
                .isEqualTo(s.proposal().clarifications());
        assertThatThrownBy(
                        () ->
                                service.message(
                                        s.id(), new Message(null, 0, "foreign-id", null, false)))
                .hasMessageContaining("устарел");
        when(gpt.generate(any()))
                .thenReturn(
                        new GptResult(
                                "{\"items\":[" + row(1, "Лук репчатый", "1", "KG") + "]}",
                                null,
                                null,
                                null));
        Session next = service.message(s.id(), new Message(null, 0, id, null, false));
        assertThatThrownBy(() -> service.message(s.id(), new Message(null, 0, id, null, false)))
                .hasMessageContaining("изменился");
        assertThatThrownBy(
                        () ->
                                service.message(
                                        s.id(),
                                        new Message(null, next.revision(), id, null, false)))
                .hasMessageContaining("устарел");
    }

    @Test
    void productYesCannotApproveAliasAndPreservesOtherQuestions() throws Exception {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север");
        Session s =
                questionSession(
                        List.of("Заменить картофель?", "Сколько лука?"),
                        List.of(choice("Заменить картофель?"), choice("Сколько лука?")),
                        "Викинг",
                        new BuyerAliasSuggestion("Викинг", buyer.id, buyer.name));
        stored.get(s.id()).messagesJson =
                json.writeValueAsString(
                        List.of(
                                new Chat(
                                        "assistant",
                                        OrderAssistantAliasApproval.question(
                                                "Викинг", buyer.name))));
        String answer = s.proposal().clarifications().get(0).options().get(0).id();
        when(gpt.generate(any()))
                .thenReturn(
                        new GptResult(
                                "{\"items\":[" + row(1, "Лук репчатый", "1", "KG") + "]}",
                                null,
                                null,
                                null));
        Session result = service.message(s.id(), new Message(null, 0, answer, null, false));
        verifyNoInteractions(aliasLearning);
        assertThat(result.proposal().questions()).contains("Сколько лука?");
        assertThat(result.proposal().buyerAliasSuggestion()).isNotNull();
        assertThat(result.ready()).isFalse();
        var input = ArgumentCaptor.forClass(GptRequest.class);
        verify(gpt).generate(input.capture());
        assertThat(input.getValue().input())
                .contains("На вопрос «Заменить картофель?» выбран ответ «Да»: да");
    }

    @Test
    void aliasButtonsApplyOnlyPersistedMappingAndKeepProductQuestions() {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север");
        Session s = aliasMessage(start(Mode.DRAFT, List.of()), buyer, "Викинг", "Викинг");
        String answer =
                s.proposal().clarifications().stream()
                        .filter(c -> c.id().endsWith(":alias"))
                        .findFirst()
                        .orElseThrow()
                        .options()
                        .get(0)
                        .id();
        when(aliasLearning.append(buyer.id, "Викинг"))
                .thenReturn(
                        new RegularBuyerAliasLearningService.Result(
                                RegularBuyerAliasLearningService.Status.ADDED, buyer.name));
        clearInvocations(gpt);
        Session result =
                service.message(s.id(), new Message(null, s.revision(), answer, null, false));
        verifyNoInteractions(gpt);
        verify(aliasLearning).append(buyer.id, "Викинг");
        assertThat(result.proposal().questions()).contains("Уточните товар");
        assertThat(result.proposal().buyerAliasSuggestion()).isNull();
    }

    @Test
    void buyerSelectionClearsLegacyBuyerQuestionsButPreservesProductChoice() throws Exception {
        RegularBuyer buyer = buyer("ТОО Север");
        String productQuestion = "Покупателю заменить яблоки на груши?";
        Session s =
                questionSession(
                        List.of(
                                "Выберите постоянного покупателя",
                                productQuestion,
                                "Выберите покупателя и укажите количество картофеля"),
                        List.of(choice(productQuestion)),
                        "Викинг",
                        null);
        Session result = service.message(s.id(), select(s, buyer.id));
        assertThat(result.proposal().regularBuyerId()).isEqualTo(buyer.id);
        assertThat(result.proposal().buyerSelected()).isTrue();
        assertThat(result.proposal().questions())
                .doesNotContain("Выберите постоянного покупателя")
                .contains(productQuestion, "Выберите покупателя и укажите количество картофеля");
        assertThat(result.proposal().items()).isEqualTo(s.proposal().items());
        assertThat(result.proposal().clarifications())
                .anySatisfy(
                        c -> {
                            assertThat(c.kind()).isEqualTo(ClarificationKind.CHOICE);
                            assertThat(c.question()).isEqualTo(productQuestion);
                        });
        verifyNoInteractions(gpt, aliasLearning);
        assertThat(result.ready()).isFalse();
    }

    @Test
    void dropdownBuyerIsAuthoritativeAcrossModelResponse() throws Exception {
        RegularBuyer chosen = buyer("ТОО Север"), other = buyer("ИП Юг");
        Session s = questionSession(List.of("Выберите покупателя"), List.of(), "Викинг", null);
        Session selected = service.message(s.id(), select(s, chosen.id));
        Session result = respond(selected, buyerResponse(other.id, "ИП Юг"));
        assertThat(result.proposal().regularBuyerId()).isEqualTo(chosen.id);
        assertThat(result.proposal().buyerSelected()).isTrue();
        assertThat(result.messages())
                .anySatisfy(
                        c ->
                                assertThat(c.content())
                                        .contains("Для его изменения используйте список"));
    }

    @Test
    void buyerSelectionOffersAliasButNeverSavesWithoutSeparateAnswer() throws Exception {
        allowAliasManagement();
        RegularBuyer buyer = buyer("ТОО Север");
        Session s = questionSession(List.of("Выберите покупателя"), List.of(), "Викинг", null);
        stored.get(s.id()).messagesJson =
                json.writeValueAsString(List.of(new Chat("user", "Викинг\nЛук 1 кг")));
        Session selected = service.message(s.id(), select(s, buyer.id));
        assertThat(selected.proposal().buyerAliasSuggestion())
                .isEqualTo(new BuyerAliasSuggestion("Викинг", buyer.id, buyer.name));
        assertThat(selected.proposal().clarifications())
                .anyMatch(c -> c.id().endsWith(":alias") && c.options().size() == 2);
        verifyNoInteractions(aliasLearning, gpt);
        Session cleared = service.message(selected.id(), select(selected, null));
        assertThat(cleared.proposal().regularBuyerId()).isNull();
        assertThat(cleared.proposal().buyerSource()).isNull();
        assertThat(cleared.proposal().buyerAliasSuggestion()).isNull();
        Session reselected = service.message(cleared.id(), select(cleared, buyer.id));
        assertThat(reselected.proposal().buyerAliasSuggestion()).isNull();
    }

    @Test
    void buyerSelectionRejectsArchivedAndMissingBuyerWithoutMutation() {
        RegularBuyer archived = buyer("Архив");
        archived.archived = true;
        Session s = start(Mode.DRAFT, List.of(seed(1)));
        for (UUID id : List.of(archived.id, UUID.randomUUID()))
            assertThatThrownBy(() -> service.message(s.id(), select(s, id)))
                    .hasMessageContaining("действующего");
        assertThat(service.get(s.id())).isEqualTo(s);
        verifyNoInteractions(gpt, aliasLearning);
    }

    @Test
    void structuredClarificationBlocksReadyEvenWithoutLegacyQuestionList() throws Exception {
        Session s = questionSession(List.of(), List.of(choice("Заменить картофель?")), null, null);
        assertThat(s.proposal().clarifications()).hasSize(1);
        assertThat(s.ready()).isFalse();
        assertThatThrownBy(() -> service.apply(s.id(), new Apply(0, false)))
                .hasMessageContaining("уточнения");
    }

    @Test
    void modelBuyerClarificationGetsDropdownAndModelOptionIdsAreIgnored() {
        Session s =
                respond(
                        start(Mode.DRAFT, List.of()),
                        "{\"items\":["
                                + row(1, "Лук репчатый", "1", "KG")
                                + "],\"clarifications\":[{\"kind\":\"BUYER\",\"question\":\"Выберите покупателя\",\"options\":[{\"id\":\"fake\",\"label\":\"Покупатель 1\",\"answer\":\"да\"}]}]}");
        assertThat(s.proposal().clarifications()).hasSize(1);
        assertThat(s.proposal().clarifications().get(0).kind()).isEqualTo(ClarificationKind.BUYER);
        assertThat(s.proposal().clarifications().get(0).options()).isEmpty();
        assertThat(s.ready()).isFalse();
    }

    private BarcodeOrderCreateRequest manualForm(boolean shortage) {
        return new BarcodeOrderCreateRequest(
                null,
                null,
                null,
                PriceTier.WHOLESALE,
                day,
                List.of(
                        new BarcodeOrderItemRequest(
                                1L,
                                new BigDecimal("2"),
                                new BigDecimal("15.00"),
                                MeasurementUnit.KG)),
                "Проверено в форме",
                shortage,
                null);
    }

    private OrderDto manualSavedOrder(UUID id) throws Exception {
        var node = json.createObjectNode();
        node.put("id", id.toString());
        node.put("createdByUserId", 7L);
        node.put("status", "PROCESSING");
        node.put("priceTier", "WHOLESALE");
        node.put("comment", "Проверено в форме");
        node.put("total", 30);
        node.put("paidTotal", 0);
        var line = node.putArray("items").addObject();
        line.put("id", 42);
        line.put("productId", 1);
        line.put("sku", "P1");
        line.put("nameRu", "Лук репчатый");
        line.put("quantity", new BigDecimal("2.000"));
        line.put("measurementUnit", "KG");
        line.put("unitPrice", new BigDecimal("15.00"));
        line.put("lineTotal", 30);
        line.put("confirmedUnitPrice", new BigDecimal("15.00"));
        line.put("confirmedLineTotal", 30);
        return json.treeToValue(node, OrderDto.class);
    }

    @Test
    void manualCheckoutCanCreateReviewedPartialOrderAndAdoptsActualSavedLines() throws Exception {
        Session session =
                respond(
                        start(Mode.CREATE, List.of(seed(1))),
                        "{\"items\":["
                                + row(1, "Лук репчатый", "1", "KG")
                                + ",{\"source\":\"Неизвестный товар\",\"issue\":\"Нужен выбор\"}],\"questions\":[\"Уточните неизвестный товар\"]}");
        assertThat(session.ready()).isFalse();
        var form = manualForm(false);
        var saved = manualSavedOrder(UUID.randomUUID());
        when(barcode.create(form, 7L)).thenReturn(saved);
        assertThat(service.checkout(session.id(), new Checkout(session.revision(), form)))
                .isEqualTo(saved);
        Session adopted = service.get(session.id());
        assertThat(adopted.orderId()).isEqualTo(saved.id());
        assertThat(adopted.revision()).isEqualTo(session.revision() + 1);
        assertThat(adopted.appliedRevision()).isEqualTo(adopted.revision());
        assertThat(adopted.priceTier()).isEqualTo(PriceTier.WHOLESALE);
        assertThat(adopted.orderDate()).isEqualTo(day);
        assertThat(adopted.proposal().items()).hasSize(1);
        assertThat(adopted.proposal().items().get(0).quantity()).isEqualByComparingTo("2");
        assertThat(adopted.proposal().items().get(0).unitPrice()).isEqualByComparingTo("15.00");
        assertThat(adopted.proposal().comment()).isEqualTo(saved.comment());
        assertThat(adopted.proposal().questions()).isEmpty();
        assertThat(adopted.proposal().clarifications()).isEmpty();
        assertThat(adopted.messages())
                .anySatisfy(c -> assertThat(c.content()).contains("Заказ оформлен через форму"));
        assertThat(stored.get(session.id()).orderSnapshot).isEqualTo(service.fingerprint(saved));
        verifyNoInteractions(aliasLearning);
    }

    @Test
    void repeatedManualCheckoutReturnsSameOrderEvenAfterSessionRevisionAdvanced() throws Exception {
        Session session = start(Mode.CREATE, List.of(seed(1)));
        var form = manualForm(false);
        var saved = manualSavedOrder(UUID.randomUUID());
        when(barcode.create(form, 7L)).thenReturn(saved);
        when(orders.adminGet(saved.id())).thenReturn(saved);
        service.checkout(session.id(), new Checkout(session.revision(), form));
        assertThat(
                        service.checkout(
                                session.id(), new Checkout(session.revision(), manualForm(true))))
                .isEqualTo(saved);
        verify(barcode, times(1)).create(any(), eq(7L));
        verify(orders, never())
                .replaceAssistantItems(any(), any(), any(), any(), anyBoolean(), any());
        verify(auth, never()).require("warehouse.negative_stock");
    }

    @Test
    void manualCheckoutRejectsDraftForeignAndStaleSessions() {
        Session draft = start(Mode.DRAFT, List.of(seed(1))),
                create = start(Mode.CREATE, List.of(seed(1)));
        assertThatThrownBy(() -> service.checkout(draft.id(), new Checkout(0, manualForm(false))))
                .hasMessageContaining("не создаёт");
        assertThatThrownBy(
                        () ->
                                service.checkout(
                                        UUID.randomUUID(), new Checkout(0, manualForm(false))))
                .isInstanceOf(AppExceptions.NotFound.class);
        assertThatThrownBy(() -> service.checkout(create.id(), new Checkout(99, manualForm(false))))
                .hasMessageContaining("изменился");
        verify(barcode, never()).create(any(), any());
    }

    @Test
    void manualCheckoutCannotBypassNegativeStockPermission() {
        Session session = start(Mode.CREATE, List.of(seed(1)));
        doThrow(new AppExceptions.Forbidden("warehouse.negative_stock"))
                .when(auth)
                .require("warehouse.negative_stock");
        assertThatThrownBy(() -> service.checkout(session.id(), new Checkout(0, manualForm(true))))
                .isInstanceOf(AppExceptions.Forbidden.class);
        verify(barcode, never()).create(any(), any());
        assertThat(service.get(session.id()).orderId()).isNull();
    }

    @Test
    void manualCheckoutPropagatesNormalFormValidationWithoutAdoptingOrder() {
        Session session = start(Mode.CREATE, List.of(seed(1)));
        var form = manualForm(false);
        when(barcode.create(form, 7L))
                .thenThrow(new AppExceptions.BadRequest("Недостаточно остатка"));
        assertThatThrownBy(() -> service.checkout(session.id(), new Checkout(0, form)))
                .hasMessageContaining("остатка");
        assertThat(service.get(session.id())).isEqualTo(session);
        verifyNoInteractions(orders);
    }

    @Test
    void manuallyCreatedSessionOrderCanBeCorrectedInSameConversation() throws Exception {
        Session session = start(Mode.CREATE, List.of(seed(1)));
        var form = manualForm(false);
        var saved = manualSavedOrder(UUID.randomUUID());
        when(barcode.create(form, 7L)).thenReturn(saved);
        service.checkout(session.id(), new Checkout(0, form));
        Session proposal =
                respond(
                        service.get(session.id()),
                        "{\"items\":[" + row(1, "Лук репчатый", "3", "KG") + "]}");
        Order entity = new Order();
        entity.id = saved.id();
        entity.createdByUserId = 7L;
        when(orderRepository.findForUpdateById(saved.id())).thenReturn(Optional.of(entity));
        when(orders.adminGet(saved.id())).thenReturn(saved);
        when(orders.replaceAssistantItems(
                        eq(saved.id()), any(), isNull(), any(), eq(false), eq(7L)))
                .thenReturn(saved);
        service.apply(session.id(), new Apply(proposal.revision(), false));
        var lines = ArgumentCaptor.forClass(List.class);
        verify(orders)
                .replaceAssistantItems(
                        eq(saved.id()), lines.capture(), isNull(), any(), eq(false), eq(7L));
        var line = (BarcodeOrderItemRequest) lines.getValue().get(0);
        assertThat(line.quantity()).isEqualByComparingTo("3");
        assertThat(line.unitPrice()).isEqualByComparingTo("15.00");
        verify(barcode, times(1)).create(any(), any());
    }

    @Test
    void checkoutDoesNotReplaceOrderAlreadyCreatedViaAssistantApply() throws Exception {
        Session session = start(Mode.CREATE, List.of(seed(1)));
        var saved = manualSavedOrder(UUID.randomUUID());
        when(barcode.create(any(), eq(7L))).thenReturn(saved);
        Session applied = service.apply(session.id(), new Apply(0, false));
        when(orders.adminGet(saved.id())).thenReturn(saved);
        assertThat(service.checkout(applied.id(), new Checkout(999, manualForm(false))))
                .isEqualTo(saved);
        verify(barcode, times(1)).create(any(), any());
    }

    private RegularBuyer buyer(String name, String... aliases) {
        RegularBuyer buyer = new RegularBuyer();
        buyer.id = UUID.randomUUID();
        buyer.name = name;
        buyer.aliases = new ArrayList<>(List.of(aliases));
        when(buyers.findById(buyer.id)).thenReturn(Optional.of(buyer));
        return buyer;
    }

    private String buyerResponse(UUID id, String source) {
        return "{\"regularBuyerId\":\""
                + id
                + "\",\"buyerSource\":\""
                + source
                + "\",\"items\":["
                + row(1, "Лук репчатый", "1", "KG")
                + "]}";
    }
}
