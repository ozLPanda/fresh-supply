package kz.company.shop.warehouse.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.integrations.gpt.GptImageRequest;
import kz.company.shop.integrations.gpt.GptProvider;
import kz.company.shop.integrations.gpt.GptRequest;
import kz.company.shop.integrations.gpt.GptResult;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;

class InventoryAiServiceTest {
    private final GptProvider gpt = mock(GptProvider.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final InventoryAiService service =
            new InventoryAiService(gpt, products, new ObjectMapper());

    @Test
    void matchesMixedCyrillicLatinLettersAndYoInCatalogNames() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(36L, "1352", "Адаптер нерж 430 0,8 D115 ТС"),
                                product(37L, "436", "Адаптер котла 430 0,8 D150 ТС"),
                                product(38L, "K-1", "Котёл стальной")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":1,"pageLastNumber":3,"rows":[
                  {"sourceNumber":1,"sourceName":"Aдаптер нерж 430 0,8 D115 TC","firstHandwrittenQuantity":4},
                  {"sourceNumber":2,"sourceName":"Адаптер котла 430 0,8 D150 ТC","firstHandwrittenQuantity":5},
                  {"sourceNumber":3,"sourceName":"Котeл стальной","firstHandwrittenQuantity":2}
                ]}
                """,
                                "r8",
                                10L,
                                10L));

        var result = service.analyze(List.of(photo()));

        assertThat(result.rows())
                .extracting(InventoryAiDto.Row::productId)
                .containsExactly(36L, 37L, 38L);
        assertThat(result.questions()).isEmpty();
    }

    @Test
    void matchesCatalogArticleAnnotationOnlyWhenNameAndSkuAgree() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(1722L, "825", "Герметик 1500С"),
                                product(1723L, "826", "Герметик 1800С")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":11,"pageLastNumber":12,"rows":[
                  {"sourceNumber":11,"sourceName":"Герметик 1500C(АРТ-825)","firstHandwrittenQuantity":5},
                  {"sourceNumber":12,"sourceName":"Герметик 1500С(арт-826)","firstHandwrittenQuantity":1}
                ]}
                """,
                                "r10",
                                10L,
                                10L));

        var result = service.analyze(List.of(photo()));

        assertThat(result.rows().get(0).productId()).isEqualTo(1722L);
        assertThat(result.rows().get(0).question()).isNull();
        assertThat(result.rows().get(1).productId()).isNull();
    }

    @Test
    void proposesArticleMatchButDoesNotApproveConflictingDescription() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(List.of(product(1720L, "2454", "Асбестовый лист 5х790х990мм")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":1,"pageLastNumber":1,"rows":[
                  {"sourceNumber":1,"sourceName":"Асбестовый лист, толщ-6мм, размер-790x990мм (арт-2454)","firstHandwrittenQuantity":5}
                ]}
                """,
                                "r12",
                                10L,
                                10L));

        var row = service.analyze(List.of(photo())).rows().getFirst();

        assertThat(row.productId()).isNull();
        assertThat(row.suggestedProductId()).isEqualTo(1720L);
        assertThat(row.suggestedProductName()).isEqualTo("Асбестовый лист 5х790х990мм");
        assertThat(row.quantity()).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(row.question()).contains("Подтвердите");
    }

    @Test
    void chatConfirmationPromotesProposalAndKeepsTheCount() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(List.of(product(1720L, "2454", "Асбестовый лист 5х790х990мм")));
        when(gpt.generate(any(GptRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"assistantMessage":"Товар подтверждён", "rows":[
                  {"pageNumber":1,"sourceNumber":1,"selectedProductId":1720,"question":null}
                ]}
                """,
                                "r13",
                                10L,
                                10L));
        var proposed =
                new InventoryAiDto.Row(
                        1,
                        1,
                        "Асбестовый лист, толщ-6мм, размер-790x990мм (арт-2454)",
                        BigDecimal.valueOf(5),
                        null,
                        null,
                        null,
                        "Подтвердите товар",
                        1720L,
                        "Асбестовый лист 5х790х990мм",
                        "2454");

        var result =
                service.clarify(
                        new InventoryAiDto.ClarifyRequest(
                                List.of(proposed), "Подтверждаю предложенный товар для строки 1"));

        var row = result.rows().getFirst();
        assertThat(row.productId()).isEqualTo(1720L);
        assertThat(row.productName()).isEqualTo("Асбестовый лист 5х790х990мм");
        assertThat(row.quantity()).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(row.question()).isNull();
        assertThat(row.suggestedProductId()).isNull();
        assertThat(result.questions()).isEmpty();
    }

    @Test
    void quantityClarificationDoesNotSilentlyConfirmProposal() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(List.of(product(1720L, "2454", "Асбестовый лист 5х790х990мм")));
        when(gpt.generate(any(GptRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"rows":[{"pageNumber":1,"sourceNumber":1,"quantity":5,"question":null}]}
                """,
                                "r14",
                                10L,
                                10L));
        var proposed =
                new InventoryAiDto.Row(
                        1,
                        1,
                        "Асбестовый лист, толщ-6мм, размер-790x990мм (арт-2454)",
                        null,
                        null,
                        null,
                        null,
                        "Уточните количество. Подтвердите товар.",
                        1720L,
                        "Асбестовый лист 5х790х990мм",
                        "2454");

        var row =
                service.clarify(
                                new InventoryAiDto.ClarifyRequest(
                                        List.of(proposed), "Строка 1: 5 штук"))
                        .rows()
                        .getFirst();

        assertThat(row.quantity()).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(row.productId()).isNull();
        assertThat(row.suggestedProductId()).isEqualTo(1720L);
        assertThat(row.question()).contains("Подтвердите");
    }

    @Test
    void chatCanChooseAnotherExplicitArticleInsteadOfTheProposal() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(1719L, "2453", "Асбестовый лист 3х790х990мм"),
                                product(1720L, "2454", "Асбестовый лист 5х790х990мм")));
        when(gpt.generate(any(GptRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"rows":[{"pageNumber":1,"sourceNumber":1,"selectedProductId":1719,"question":null}]}
                """,
                                "r15",
                                10L,
                                10L));
        var proposed =
                new InventoryAiDto.Row(
                        1,
                        1,
                        "Асбестовый лист, толщ-6мм, размер-790x990мм (арт-2454)",
                        BigDecimal.valueOf(5),
                        null,
                        null,
                        null,
                        "Подтвердите товар",
                        1720L,
                        "Асбестовый лист 5х790х990мм",
                        "2454");

        var row =
                service.clarify(
                                new InventoryAiDto.ClarifyRequest(
                                        List.of(proposed),
                                        "Для строки 1 нужен другой товар: артикул 2453"))
                        .rows()
                        .getFirst();

        assertThat(row.productId()).isEqualTo(1719L);
        assertThat(row.suggestedProductId()).isNull();
        assertThat(row.question()).isNull();
    }

    @Test
    void chatCanRejectProposalWithoutImportingIt() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(List.of(product(1720L, "2454", "Асбестовый лист 5х790х990мм")));
        when(gpt.generate(any(GptRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"rows":[{"pageNumber":1,"sourceNumber":1,"rejectSuggestion":true,"question":null}]}
                """,
                                "r16",
                                10L,
                                10L));
        var proposed =
                new InventoryAiDto.Row(
                        1,
                        1,
                        "Асбестовый лист, толщ-6мм, размер-790x990мм (арт-2454)",
                        BigDecimal.valueOf(5),
                        null,
                        null,
                        null,
                        "Подтвердите товар",
                        1720L,
                        "Асбестовый лист 5х790х990мм",
                        "2454");

        var row =
                service.clarify(
                                new InventoryAiDto.ClarifyRequest(
                                        List.of(proposed), "Строка 1: нет, это не он"))
                        .rows()
                        .getFirst();

        assertThat(row.productId()).isNull();
        assertThat(row.suggestedProductId()).isNull();
        assertThat(row.question()).contains("Предложение отклонено");
    }

    @Test
    void matchesLetterZeToDigitThreeInModelCodeWithSameDimensions() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(53L, "1295", "Зонт моно 3М-П 430, 0,5 D115 ТС"),
                                product(54L, "435", "Зонт моно 3М-П 430, 0,5 D150 ТС")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":21,"pageLastNumber":22,"rows":[
                  {"sourceNumber":21,"sourceName":"Зонт моно ЗМ-П 430, 0,5 D115 TC","firstHandwrittenQuantity":0},
                  {"sourceNumber":22,"sourceName":"Зонт моно ЗМ-П 430, 0,5 D150 ТС","firstHandwrittenQuantity":1}
                ]}
                """,
                                "r11",
                                10L,
                                10L));

        var result = service.analyze(List.of(photo()));

        assertThat(result.rows())
                .extracting(InventoryAiDto.Row::productId)
                .containsExactly(53L, 54L);
        assertThat(result.questions()).isEmpty();
    }

    @Test
    void doesNotChooseSimilarProductWithDifferentTechnicalSize() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(
                                        38L,
                                        "1803",
                                        "Адаптер-переход Моно АПМ-Р 430, 0,8, d 115/120")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":1,"pageLastNumber":1,"rows":[
                  {"sourceNumber":1,"sourceName":"Адаптер-переход Моно АПМ-Р 430, 0,8, d 115/150","firstHandwrittenQuantity":0}
                ]}
                """,
                                "r9",
                                10L,
                                10L));

        var row = service.analyze(List.of(photo())).rows().getFirst();

        assertThat(row.productId()).isNull();
        assertThat(row.quantity()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(row.suggestedProductId()).isEqualTo(38L);
        assertThat(row.question()).contains("Подтвердите");
    }

    @Test
    void usesOnlyFirstHandwrittenColumnAndKeepsPaperOrder() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(7L, "A-1", "Адаптер 115"),
                                product(8L, "A-2", "Адаптер 150")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":1,"pageLastNumber":3,"rows":[
                  {"sourceNumber":2,"sourceName":"Адаптер 150","firstHandwrittenQuantity":5,"secondHandwrittenQuantity":99,"quantity":99,"question":null},
                  {"sourceNumber":1,"sourceName":"Адаптер 115","firstHandwrittenQuantity":4,"secondHandwrittenQuantity":2,"quantity":2,"question":null},
                  {"sourceNumber":3,"sourceName":"Неизвестный","firstHandwrittenQuantity":8,"secondHandwrittenQuantity":1,"question":null}
                ]}
                """,
                                "r1",
                                100L,
                                100L));
        var result = service.analyze(List.of(photo()));
        assertThat(result.rows())
                .extracting(InventoryAiDto.Row::sourceNumber)
                .containsExactly(1, 2, 3);
        assertThat(result.rows().get(0).quantity()).isEqualByComparingTo(BigDecimal.valueOf(4));
        assertThat(result.rows().get(1).quantity()).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(result.rows().get(0).productId()).isEqualTo(7L);
        assertThat(result.rows().get(2).productId()).isNull();
        assertThat(result.rows().get(2).quantity()).isEqualByComparingTo(BigDecimal.valueOf(8));
        assertThat(result.questions()).hasSize(1);
        ArgumentCaptor<GptImageRequest> request = ArgumentCaptor.forClass(GptImageRequest.class);
        verify(gpt).generateImages(request.capture());
        assertThat(request.getValue().instructions())
                .contains("FIRST handwritten numeric column", "SECOND handwritten numeric column");
    }

    @Test
    void clarificationChangesOnlyUncertainRow() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(7L, "A-1", "Адаптер 115"),
                                product(8L, "A-2", "Адаптер 150")));
        when(gpt.generate(any(GptRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"assistantMessage":"Строка 2 уточнена", "rows":[
                  {"pageNumber":1,"sourceNumber":1,"sourceName":"Подмена","quantity":999,"question":null},
                  {"pageNumber":1,"sourceNumber":2,"sourceName":"Адаптер 115","quantity":6,"question":null}
                ]}
                """,
                                "r2",
                                20L,
                                20L));
        var clear =
                new InventoryAiDto.Row(
                        1, 1, "Адаптер 150", BigDecimal.valueOf(4), 8L, "Адаптер 150", "A-2", null);
        var pending =
                new InventoryAiDto.Row(1, 2, "Адаптер", null, null, null, null, "Какой размер?");
        var result =
                service.clarify(
                        new InventoryAiDto.ClarifyRequest(
                                List.of(clear, pending), "Строка 2: Адаптер 115, 6 штук"));
        assertThat(result.rows())
                .containsExactly(
                        clear,
                        new InventoryAiDto.Row(
                                1,
                                2,
                                "Адаптер 115",
                                BigDecimal.valueOf(6),
                                7L,
                                "Адаптер 115",
                                "A-1",
                                null));
        assertThat(result.questions()).isEmpty();
    }

    @Test
    void clarificationKeepsKnownCountAndProductWhenOnlyOtherFieldIsAnswered() throws Exception {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(7L, "A-1", "Адаптер 115"),
                                product(8L, "A-2", "Адаптер 150")));
        when(gpt.generate(any(GptRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"rows":[
                  {"pageNumber":1,"sourceNumber":1,"sourceName":"Адаптер 115","quantity":null},
                  {"pageNumber":1,"sourceNumber":2,"quantity":6}
                ]}
                """,
                                "r6",
                                10L,
                                10L));
        var knownCount =
                new InventoryAiDto.Row(
                        1, 1, "Адаптер", BigDecimal.valueOf(8), null, null, null, "Какой товар?");
        var knownProduct =
                new InventoryAiDto.Row(
                        1, 2, "Адаптер 150", null, 8L, "Адаптер 150", "A-2", "Сколько?");
        var result =
                service.clarify(
                        new InventoryAiDto.ClarifyRequest(
                                List.of(knownCount, knownProduct),
                                "Строка 1 — Адаптер 115; строка 2 — 6 штук"));
        assertThat(result.rows().get(0).quantity()).isEqualByComparingTo(BigDecimal.valueOf(8));
        assertThat(result.rows().get(0).productId()).isEqualTo(7L);
        assertThat(result.rows().get(1).quantity()).isEqualByComparingTo(BigDecimal.valueOf(6));
        assertThat(result.rows().get(1).productId()).isEqualTo(8L);
        assertThat(result.questions()).isEmpty();
        ArgumentCaptor<GptRequest> prompt = ArgumentCaptor.forClass(GptRequest.class);
        verify(gpt).generate(prompt.capture());
        var context = new ObjectMapper().readTree(prompt.getValue().input()).path("uncertainRows");
        assertThat(context.get(0).path("quantity").decimalValue())
                .isEqualByComparingTo(BigDecimal.valueOf(8));
        assertThat(context.get(1).path("productId").asLong()).isEqualTo(8L);
    }

    @Test
    void clarificationCanCorrectKnownCountWhenHumanStatesNewQuantity() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(List.of(product(7L, "A-1", "Адаптер 115")));
        when(gpt.generate(any(GptRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                        {"rows":[{"pageNumber":1,"sourceNumber":1,"sourceName":"Адаптер 115","quantity":9,"question":null}]}
                        """,
                                "r7",
                                10L,
                                10L));
        var pending =
                new InventoryAiDto.Row(
                        1, 1, "Адаптер", BigDecimal.valueOf(8), null, null, null, "Какой товар?");
        var result =
                service.clarify(
                        new InventoryAiDto.ClarifyRequest(
                                List.of(pending), "Строка 1: Адаптер 115, количество 9 шт"));
        assertThat(result.rows().getFirst().quantity()).isEqualByComparingTo(BigDecimal.valueOf(9));
        assertThat(result.rows().getFirst().productId()).isEqualTo(7L);
    }

    @Test
    void missingPaperNumberIsPreservedForQuestion() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(7L, "A-1", "Адаптер 115"),
                                product(8L, "A-2", "Адаптер 150")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":1,"pageLastNumber":3,"rows":[
                  {"sourceNumber":1,"sourceName":"Адаптер 115","firstHandwrittenQuantity":4},
                  {"sourceNumber":3,"sourceName":"Адаптер 115","firstHandwrittenQuantity":5}
                ]}
                """,
                                "r3",
                                10L,
                                10L));
        var result = service.analyze(List.of(photo()));
        assertThat(result.rows())
                .extracting(InventoryAiDto.Row::sourceNumber)
                .containsExactly(1, 2, 3);
        assertThat(result.rows().get(1).question()).contains("Не распознана строка");
    }

    @Test
    void blankFirstCountDoesNotBecomePrintedOrSecondCount() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(
                        List.of(
                                product(7L, "A-1", "Адаптер 115"),
                                product(8L, "A-2", "Адаптер 150")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":1,"pageLastNumber":2,"rows":[
                  {"sourceNumber":1,"sourceName":"Адаптер 115","firstHandwrittenQuantity":null,"secondHandwrittenQuantity":9,"quantity":1000},
                  {"sourceNumber":2,"sourceName":"Адаптер 150","firstHandwrittenQuantity":0,"secondHandwrittenQuantity":15,"quantity":1000}
                ]}
                """,
                                "r5",
                                10L,
                                10L));
        var result = service.analyze(List.of(photo()));
        assertThat(result.rows().get(0).quantity()).isNull();
        assertThat(result.rows().get(0).productId()).isEqualTo(7L);
        assertThat(result.rows().get(1).quantity()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(result.rows().get(1).productId()).isEqualTo(8L);
        assertThat(result.questions()).hasSize(1);
    }

    @Test
    void duplicateCatalogMatchStaysAsQuestionWithoutLosingCount() {
        when(products.findByDeletedAtIsNullOrderByNameRuAsc())
                .thenReturn(List.of(product(7L, "A-1", "Адаптер 115")));
        when(gpt.generateImages(any(GptImageRequest.class)))
                .thenReturn(
                        new GptResult(
                                """
                {"pageFirstNumber":1,"pageLastNumber":2,"rows":[
                  {"sourceNumber":1,"sourceName":"Адаптер 115","firstHandwrittenQuantity":4},
                  {"sourceNumber":2,"sourceName":"Адаптер 115","firstHandwrittenQuantity":5}
                ]}
                """,
                                "r4",
                                10L,
                                10L));
        var result = service.analyze(List.of(photo()));
        assertThat(result.rows().get(0).productId()).isEqualTo(7L);
        assertThat(result.rows().get(1).productId()).isNull();
        assertThat(result.rows().get(1).quantity()).isEqualByComparingTo(BigDecimal.valueOf(5));
        assertThat(result.rows().get(1).question()).contains("уже есть выше");
    }

    private static Product product(long id, String sku, String name) {
        Product product = new Product();
        product.id = id;
        product.sku = sku;
        product.nameRu = name;
        return product;
    }

    private static MockMultipartFile photo() {
        return new MockMultipartFile(
                "files",
                "page.jpg",
                "image/jpeg",
                new byte[] {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 1});
    }
}
