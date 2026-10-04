package kz.company.shop.priceImports.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.priceImports.dto.PriceImportPreviewDto;
import kz.company.shop.priceImports.entity.ImportPriceType;
import kz.company.shop.priceImports.entity.PriceImportSession;
import kz.company.shop.priceImports.entity.PriceImportStatus;
import kz.company.shop.priceImports.repository.PriceImportSessionRepository;
import kz.company.shop.priceStatistics.service.PriceStatisticsService;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.settings.service.ProjectSettingsService;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

class PriceImportServiceTest {
    private final PriceImportPythonRunner runner = mock(PriceImportPythonRunner.class);
    private final PriceImportSessionRepository sessions = mock(PriceImportSessionRepository.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final AuditService audit = mock(AuditService.class);
    private final PriceStatisticsService statistics = mock(PriceStatisticsService.class);
    private final ProjectSettingsService projectSettings = mock(ProjectSettingsService.class);
    private final StockDocumentLineRepository stockDocumentLines = mock(StockDocumentLineRepository.class);
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
    private final PriceImportService service =
            new PriceImportService(
                    runner,
                    sessions,
                    products,
                    audit,
                    statistics,
                    objectMapper,
                    projectSettings,
                    stockDocumentLines);

    @Test
    void analyzeExcludesProductsByDefaultAndConfiguredNameTermsIgnoringCase() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        sourceRow(2, "100", "Корзина для белья"),
                                        sourceRow(3, "200", "НЕ ВЫБИРАТЬ"),
                                        sourceRow(4, "300", "Скрытая позиция"),
                                        sourceRow(5, "400", "Обычный товар"))));
        when(projectSettings.priceImportExcludedNameTerms()).thenReturn(List.of("скрытая позиция"));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("400"))).thenReturn(List.of());
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.totalRows()).isEqualTo(1);
        assertThat(result.rows()).extracting(PriceImportPreviewDto.Row::sku).containsExactly("400");
    }

    @Test
    void analyzeKeepsExcludedNameRowWhenItsSkuAlreadyExistsAndMarksItForHiding() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product product = product("1421", "120");
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        new PriceImportPythonRunner.SourceRow(
                                                "Лист1",
                                                2,
                                                "1421",
                                                "Не выбирать: обновлённое название",
                                                new BigDecimal("130"),
                                                new BigDecimal("110"),
                                                null,
                                                null,
                                                false,
                                                List.of()))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1421"))).thenReturn(List.of(product));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.excludedByName()).isTrue();
                            assertThat(row.newProductName())
                                    .isEqualTo("Не выбирать: обновлённое название");
                            assertThat(row.newPrice()).isEqualByComparingTo("130");
                        });
    }

    @Test
    void analyzeRecognizesMalformedDoNotSelectPrefixesForExistingProducts() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product first = product("201", "100");
        Product second = product("202", "100");
        Product third = product("203", "100");
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        sourceRow(2, "201", "НЕВЫБИРАТЬ Вентилятор"),
                                        sourceRow(3, "202", "НЕ ВЫБЕРАть Насос"),
                                        sourceRow(4, "203", "НЕ ВЫБРАТЬ Кран"))));
        when(products.findBySkuInAndDeletedAtIsNull(anySet()))
                .thenReturn(List.of(first, second, third));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.rows())
                .allSatisfy(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.excludedByName()).isTrue();
                        });
    }

    @Test
    void analyzeRecognizesDoNotSelectImperativeAndTruncatedPrefixes() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product first = product("204", "100");
        Product second = product("205", "100");
        Product third = product("206", "100");
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        sourceRow(2, "204", "НЕ ВЫБИРАЕМ Печь"),
                                        sourceRow(3, "205", "невыбираем Шнур"),
                                        sourceRow(4, "206", "НЕ ВЫБир вентилятор"))));
        when(products.findBySkuInAndDeletedAtIsNull(anySet()))
                .thenReturn(List.of(first, second, third));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.rows())
                .allSatisfy(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.excludedByName()).isTrue();
                        });
    }

    @Test
    void analyzeRecognizesMalformedOutOfStockPrefixesOnlyAtTheStartOfName() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product first = product("101", "100");
        first.nameRu = "FHH,П-2000, Мощность 1000Вт";
        Product second = product("102", "100");
        second.nameRu = "Вентилятор KG-120";
        Product third = product("103", "100");
        third.nameRu = "Вентилятор KG WPA-140 Q-395m/h";
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        sourceRow(
                                                2,
                                                "101",
                                                "НЕТв НАЛИЧИИ FHH,П-2000, Мощность 1000Вт"),
                                        sourceRow(3, "102", "НЕТ в НАЛИЧИВентилятор KG-120"),
                                        sourceRow(
                                                4,
                                                "103",
                                                "НЕТ в НА ЛИЧИИ Вентилятор KG WPA-140 Q-395m/h"))));
        when(products.findBySkuInAndDeletedAtIsNull(anySet()))
                .thenReturn(List.of(first, second, third));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.rows())
                .allSatisfy(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.madeToOrder()).isTrue();
                        });
        assertThat(result.rows())
                .extracting(PriceImportPreviewDto.Row::newProductName)
                .containsExactly(
                        "FHH,П-2000, Мощность 1000Вт",
                        "Вентилятор KG-120",
                        "Вентилятор KG WPA-140 Q-395m/h");
    }

    @Test
    void analyzeTreatsLowercaseConcatenatedTextAsAnAvailabilityPrefix() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product product = product("104", "100");
        product.nameRu = "штуцер";
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(sourceRow(2, "104", "нет в наличииштуцер"))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("104"))).thenReturn(List.of(product));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.madeToOrder()).isTrue();
                            assertThat(row.newProductName()).isEqualTo("штуцер");
                        });
    }

    @Test
    void analyzeMarksProductsWithPostedPriceSettingsAndCountsThemSeparately() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product product = product("105", "100");
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(sourceRow(2, "105", "Product 105"))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("105"))).thenReturn(List.of(product));
        when(stockDocumentLines.findProductIdsInPostedPriceSettings(Set.of(product.id)))
                .thenReturn(Set.of(product.id));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.summary().priceSetting()).isEqualTo(1);
        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("PRICE_SETTING");
                            assertThat(row.pricesLockedByPriceSetting()).isTrue();
                        });
    }

    @Test
    void commitMarksRecognizedOutOfStockProductAsMadeToOrder() throws Exception {
        UUID id = UUID.randomUUID();
        Product product = product("101", "100");
        product.nameRu = "Вентилятор KG-120";
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        1,
                        new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "CHANGED",
                                        "101",
                                        product.nameRu,
                                        new BigDecimal("100"),
                                        new BigDecimal("100"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of(),
                                        product.nameRu,
                                        product.nameRu,
                                        false,
                                        false,
                                        null,
                                        null,
                                        true)));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("101"))).thenReturn(List.of(product));

        service.commit(id);

        assertThat(product.active).isTrue();
        assertThat(product.madeToOrder).isTrue();
        verify(products).saveAll(List.of(product));
    }

    @Test
    void commitIgnoresAvailabilityAndMadeToOrderWhenDisabledForTheImport() throws Exception {
        UUID id = UUID.randomUUID();
        Product product = product("106", "100");
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        false,
                        1,
                        new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "CHANGED",
                                        "106",
                                        product.nameRu,
                                        new BigDecimal("100"),
                                        new BigDecimal("100"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of(),
                                        product.nameRu,
                                        product.nameRu,
                                        false,
                                        false,
                                        null,
                                        null,
                                        true)));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("106"))).thenReturn(List.of(product));

        service.commit(id);

        assertThat(product.active).isTrue();
        assertThat(product.madeToOrder).isFalse();
        verify(products, never()).saveAll(any());
    }

    @Test
    void analyzeBuildsChangedUnchangedNotFoundInvalidAndDuplicatePreview() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        row(2, "A", "120", null, null, List.of()),
                                        row(3, "B", "200", null, null, List.of()),
                                        row(4, "MISSING", "10", null, null, List.of()),
                                        row(5, "BAD", "-1", null, null, List.of()),
                                        row(6, "DUP", "10", null, null, List.of()),
                                        row(7, "dup", "10", null, null, List.of()))));
        Product changed = product("A", "100");
        Product unchanged = product("B", "200");
        when(products.findBySkuInAndDeletedAtIsNull(anySet()))
                .thenReturn(List.of(changed, unchanged));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.summary()).isEqualTo(new PriceImportPreviewDto.Summary(1, 1, 1, 0, 1, 2));
        assertThat(result.rows())
                .extracting(PriceImportPreviewDto.Row::status)
                .containsExactly(
                        "CHANGED", "UNCHANGED", "NOT_FOUND", "INVALID", "DUPLICATE", "DUPLICATE");
    }

    @Test
    void analyzeMatchesNumericSkuWithLeadingZeros() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(row(2, " 00000001405 ", "120", null, null, List.of()))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1405")))
                .thenReturn(List.of(product("1405", "100")));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.summary()).isEqualTo(new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0));
        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.sku()).isEqualTo("1405");
                            assertThat(row.status()).isEqualTo("CHANGED");
                        });
        verify(products).findBySkuInAndDeletedAtIsNull(Set.of("1405"));
    }

    @Test
    void analyzeMarksProductAsChangedWhenOnlyItsNameDiffers() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(sourceRow(2, "1405", "Исправленное название (арт.1405)"))));
        Product product = product("1405", "100");
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1405"))).thenReturn(List.of(product));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.oldProductName()).isEqualTo("Product 1405");
                            assertThat(row.newProductName()).isEqualTo("Исправленное название");
                        });
    }

    @Test
    void analyzeMarksHiddenProductForReactivationWhenTheRegularPriceRowIsUnchanged() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product product = product("1405", "100");
        product.active = false;
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(sourceRow(2, "1405", "Product 1405"))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1405"))).thenReturn(List.of(product));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.oldActive()).isFalse();
                            assertThat(row.oldMadeToOrder()).isFalse();
                            assertThat(row.newActive()).isTrue();
                            assertThat(row.newMadeToOrder()).isFalse();
                        });
    }

    @Test
    void analyzeShowsMadeToOrderProductReturningToRegularAvailability() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product product = product("1406", "100");
        product.madeToOrder = true;
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(sourceRow(2, "1406", "Product 1406"))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1406"))).thenReturn(List.of(product));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor());

        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.oldActive()).isTrue();
                            assertThat(row.oldMadeToOrder()).isTrue();
                            assertThat(row.newActive()).isTrue();
                            assertThat(row.newMadeToOrder()).isFalse();
                        });
    }

    @Test
    void analyzePreservesStorefrontStateWhenAvailabilityUpdatesAreDisabled() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        Product product = product("1407", "100");
        product.active = false;
        product.madeToOrder = true;
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(sourceRow(2, "1407", "Product 1407"))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1407"))).thenReturn(List.of(product));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result =
                service.analyze(file, actor(), false, false, (ImportPriceType) null);

        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("UNCHANGED");
                            assertThat(row.oldActive()).isFalse();
                            assertThat(row.oldMadeToOrder()).isTrue();
                            assertThat(row.newActive()).isFalse();
                            assertThat(row.newMadeToOrder()).isTrue();
                        });
    }

    @Test
    void analyzeKeepsAnExistingMxlProductWithMissingRetailPriceForUnpublication() {
        var file = new MockMultipartFile("file", "retail.mxl", null, new byte[] {1});
        Product product = product("1421", "120");
        product.nameRu = "Хомут трубный КНТ-Р на болте D 180 ТС";
        product.nameKk = product.nameRu;
        when(runner.analyze(file, kz.company.shop.orders.entity.PriceTier.RETAIL))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        new PriceImportPythonRunner.SourceRow(
                                                "1С MXL",
                                                1395,
                                                "1421",
                                                "Очки виртуальной реальности",
                                                null,
                                                null,
                                                null,
                                                null,
                                                true,
                                                List.of()))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1421"))).thenReturn(List.of(product));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result =
                service.analyze(
                        file, actor(), true, kz.company.shop.orders.entity.PriceTier.RETAIL);

        assertThat(result.summary()).isEqualTo(new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0));
        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.missingRetailPrice()).isTrue();
                            assertThat(row.newPrice()).isNull();
                            assertThat(row.newProductName())
                                    .isEqualTo("Очки виртуальной реальности");
                        });
    }

    @Test
    void analyzeDoesNotCreateAProductWhenItsMxlRetailPriceIsMissing() {
        var file = new MockMultipartFile("file", "retail.mxl", null, new byte[] {1});
        when(runner.analyze(file, kz.company.shop.orders.entity.PriceTier.RETAIL))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        new PriceImportPythonRunner.SourceRow(
                                                "1С MXL",
                                                2,
                                                "9999",
                                                "Товар без цены",
                                                null,
                                                null,
                                                null,
                                                null,
                                                true,
                                                List.of()))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("9999"))).thenReturn(List.of());
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result =
                service.analyze(
                        file, actor(), true, kz.company.shop.orders.entity.PriceTier.RETAIL);

        assertThat(result.summary()).isEqualTo(new PriceImportPreviewDto.Summary(0, 0, 1, 0, 0, 0));
        assertThat(result.rows())
                .singleElement()
                .extracting(PriceImportPreviewDto.Row::status)
                .isEqualTo("NOT_FOUND");
    }

    @Test
    void analyzeMarksOnlyMissingNumericSkuForCreation() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(
                                        row(2, "000123", "120", "100", null, List.of()),
                                        row(3, "ABC-123", "200", null, null, List.of()))));
        when(products.findBySkuInAndDeletedAtIsNull(anySet())).thenReturn(List.of());
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor(), true);

        assertThat(result.createMissingProducts()).isTrue();
        assertThat(result.summary()).isEqualTo(new PriceImportPreviewDto.Summary(0, 0, 0, 1, 1, 0));
        assertThat(result.rows())
                .extracting(PriceImportPreviewDto.Row::status)
                .containsExactly("TO_CREATE", "INVALID");
        assertThat(result.rows().get(0).sku()).isEqualTo("123");
        assertThat(result.rows().get(1).errors())
                .contains("Автосоздание доступно только для артикулов из цифр 0-9");
    }

    @Test
    void analyzeRejectsAutocreationWithoutRetailPrice() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(row(2, "123", null, "100", null, List.of()))));
        when(products.findBySkuInAndDeletedAtIsNull(anySet())).thenReturn(List.of());
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor(), true);

        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("INVALID");
                            assertThat(row.errors())
                                    .contains("Для автосоздания товара необходима розничная цена");
                        });
    }

    @Test
    void analyzeKeepsExistingAlphanumericSkuValid() {
        var file = new MockMultipartFile("file", "prices.xlsx", null, new byte[] {1});
        when(runner.analyze(file))
                .thenReturn(
                        new PriceImportPythonRunner.Analysis(
                                "{\"schemaVersion\":1,\"rows\":[]}",
                                List.of(row(2, "ABC-123", "120", null, null, List.of()))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("ABC-123")))
                .thenReturn(List.of(product("ABC-123", "100")));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyze(file, actor(), true);

        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.status()).isEqualTo("CHANGED");
                            assertThat(row.errors()).isEmpty();
                        });
    }

    @Test
    void commitCreatesInactiveDraftForNumericSku() throws Exception {
        UUID id = UUID.randomUUID();
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        true,
                        1,
                        new PriceImportPreviewDto.Summary(0, 0, 0, 1, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "TO_CREATE",
                                        "123",
                                        "Новый товар",
                                        null,
                                        new BigDecimal("120"),
                                        null,
                                        new BigDecimal("100"),
                                        null,
                                        null,
                                        List.of())));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("123"))).thenReturn(List.of());

        var result = service.commit(id);

        assertThat(result.created()).isEqualTo(1);
        assertThat(result.updated()).isZero();
        verify(products)
                .saveAll(
                        argThat(
                                saved -> {
                                    Product draft = saved.iterator().next();
                                    return draft.sku.equals("123")
                                            && draft.nameRu.equals("Новый товар")
                                            && draft.nameKk.equals("Новый товар")
                                            && draft.price.compareTo(new BigDecimal("120")) == 0
                                            && draft.wholesalePrice.compareTo(new BigDecimal("100"))
                                                    == 0
                                            && draft.createdFromPriceImportId.equals(id)
                                            && draft.categoryId == null
                                            && !draft.active;
                                }));
    }

    @Test
    void commitMakesPrefixedDraftProductAvailableToOrderAndCleansItsName() throws Exception {
        UUID id = UUID.randomUUID();
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        true,
                        1,
                        new PriceImportPreviewDto.Summary(0, 0, 0, 1, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "TO_CREATE",
                                        "2115",
                                        "НА ЗАКАЗ Труба ТТ-Р L 500",
                                        null,
                                        new BigDecimal("120"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of())));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("2115"))).thenReturn(List.of());

        service.commit(id);

        verify(products)
                .saveAll(
                        argThat(
                                saved -> {
                                    Product draft = saved.iterator().next();
                                    return draft.nameRu.equals("Труба ТТ-Р L 500")
                                            && draft.nameKk.equals("Труба ТТ-Р L 500")
                                            && draft.madeToOrder;
                                }));
    }

    @Test
    void commitUpdatesOnlyProvidedFieldsAndIsIdempotent() throws Exception {
        UUID id = UUID.randomUUID();
        Product product = product("A", "100");
        product.wholesalePrice = new BigDecimal("80");
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        2,
                        new PriceImportPreviewDto.Summary(1, 0, 1, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "CHANGED",
                                        "A",
                                        "Product A",
                                        new BigDecimal("100"),
                                        new BigDecimal("120"),
                                        new BigDecimal("80"),
                                        null,
                                        null,
                                        null,
                                        List.of()),
                                new PriceImportPreviewDto.Row(
                                        3,
                                        "Лист1",
                                        "NOT_FOUND",
                                        "MISSING",
                                        "Missing",
                                        null,
                                        new BigDecimal("10"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of())));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(anySet())).thenReturn(List.of(product));

        var first = service.commit(id);
        var second = service.commit(id);

        assertThat(first.updated()).isEqualTo(1);
        assertThat(first.skipped()).isEqualTo(1);
        assertThat(second).isEqualTo(first);
        assertThat(product.price).isEqualByComparingTo("120");
        assertThat(product.wholesalePrice).isEqualByComparingTo("80");
        verify(products, times(1)).saveAll(any());
        verify(audit, times(1)).record(eq("IMPORT"), eq("PRODUCT_PRICE_IMPORT"), isNull(), any());
        verify(statistics, times(1))
                .recordCompletedImport(eq(session), any(PriceImportPreviewDto.class));
    }

    @Test
    void commitAppliesOnlyExplicitlySelectedPreviewRows() throws Exception {
        UUID id = UUID.randomUUID();
        Product first = product("A", "100");
        Product second = product("B", "100");
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        2,
                        new PriceImportPreviewDto.Summary(2, 0, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "CHANGED",
                                        "A",
                                        "Product A",
                                        new BigDecimal("100"),
                                        new BigDecimal("120"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of()),
                                new PriceImportPreviewDto.Row(
                                        3,
                                        "Лист1",
                                        "CHANGED",
                                        "B",
                                        "Product B",
                                        new BigDecimal("100"),
                                        new BigDecimal("130"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of())));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("B"))).thenReturn(List.of(second));

        var result = service.commit(id, List.of(1));

        assertThat(result.updated()).isEqualTo(1);
        assertThat(result.skipped()).isZero();
        assertThat(first.price).isEqualByComparingTo("100");
        assertThat(second.price).isEqualByComparingTo("130");
        verify(statistics)
                .recordCompletedImport(
                        eq(session),
                        argThat(
                                recorded ->
                                        recorded.rows().stream()
                                                .map(PriceImportPreviewDto.Row::sku)
                                                .toList()
                                                .equals(List.of("B"))));
    }

    @Test
    void commitRejectsEmptyOrOutOfRangeSelectedPreviewRows() throws Exception {
        UUID id = UUID.randomUUID();
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        1,
                        new PriceImportPreviewDto.Summary(0, 1, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "UNCHANGED",
                                        "A",
                                        "Product A",
                                        new BigDecimal("100"),
                                        new BigDecimal("100"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of())));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));

        assertThatThrownBy(() -> service.commit(id, List.of()))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(() -> service.commit(id, List.of(1)))
                .isInstanceOf(AppExceptions.BadRequest.class);
    }

    @Test
    void commitUpdatesNamesFromThePreviewEvenWhenPricesAreUnchanged() throws Exception {
        UUID id = UUID.randomUUID();
        Product product = product("A", "100");
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        1,
                        new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "CHANGED",
                                        "A",
                                        "Product A",
                                        new BigDecimal("100"),
                                        new BigDecimal("100"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of(),
                                        "Product A",
                                        "Исправленное название")));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("A"))).thenReturn(List.of(product));

        var result = service.commit(id);

        assertThat(result.updated()).isEqualTo(1);
        assertThat(product.nameRu).isEqualTo("Исправленное название");
        assertThat(product.nameKk).isEqualTo("Исправленное название");
        verify(products).saveAll(any());
    }

    @Test
    void commitClearsRetailPriceAndHidesExistingProductWhenMxlPriceIsMissing() throws Exception {
        UUID id = UUID.randomUUID();
        Product product = product("1421", "120");
        product.nameRu = "Хомут трубный КНТ-Р на болте D 180 ТС";
        product.nameKk = product.nameRu;
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "retail.mxl",
                        "ANALYZED",
                        true,
                        1,
                        new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        1395,
                                        "1С MXL",
                                        "CHANGED",
                                        "1421",
                                        product.nameRu,
                                        new BigDecimal("120"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of(),
                                        product.nameRu,
                                        "Очки виртуальной реальности",
                                        true)));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1421"))).thenReturn(List.of(product));

        var result = service.commit(id);

        assertThat(result.updated()).isEqualTo(1);
        assertThat(product.nameRu).isEqualTo("Очки виртуальной реальности");
        assertThat(product.nameKk).isEqualTo("Очки виртуальной реальности");
        assertThat(product.price).isNull();
        assertThat(product.active).isFalse();
        verify(products).saveAll(any());
    }

    @Test
    void commitUpdatesExcludedNameProductAndHidesItWithoutClearingItsPrices() throws Exception {
        UUID id = UUID.randomUUID();
        Product product = product("1421", "120");
        product.wholesalePrice = new BigDecimal("100");
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        1,
                        new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "CHANGED",
                                        "1421",
                                        "Product 1421",
                                        new BigDecimal("120"),
                                        new BigDecimal("130"),
                                        new BigDecimal("100"),
                                        new BigDecimal("110"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of(),
                                        "Product 1421",
                                        "Не выбирать: обновлённое название",
                                        false,
                                        true)));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1421"))).thenReturn(List.of(product));

        var result = service.commit(id);

        assertThat(result.updated()).isEqualTo(1);
        assertThat(product.nameRu).isEqualTo("Не выбирать: обновлённое название");
        assertThat(product.price).isEqualByComparingTo("130");
        assertThat(product.wholesalePrice).isEqualByComparingTo("110");
        assertThat(product.active).isFalse();
        verify(products).saveAll(any());
    }

    @Test
    void commitReactivatesHiddenProductForRegularPriceRow() throws Exception {
        UUID id = UUID.randomUUID();
        Product product = product("1421", "120");
        product.active = false;
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        1,
                        new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "CHANGED",
                                        "1421",
                                        "Product 1421",
                                        new BigDecimal("120"),
                                        new BigDecimal("120"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of(),
                                        "Product 1421",
                                        "Product 1421")));
        PriceImportSession session = session(id, preview);
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1421"))).thenReturn(List.of(product));

        var result = service.commit(id);

        assertThat(result.updated()).isEqualTo(1);
        assertThat(product.active).isTrue();
        verify(products).saveAll(any());
    }

    @Test
    void commitSkipsInvalidAndDuplicateRows() throws Exception {
        UUID id = UUID.randomUUID();
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        2,
                        new PriceImportPreviewDto.Summary(0, 0, 0, 0, 1, 1),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "INVALID",
                                        "BAD",
                                        "Некорректный товар",
                                        null,
                                        new BigDecimal("-1"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of("Розничная цена должна быть больше нуля")),
                                new PriceImportPreviewDto.Row(
                                        3,
                                        "Лист1",
                                        "DUPLICATE",
                                        "DUP",
                                        "Дубликат",
                                        null,
                                        new BigDecimal("100"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of("Артикул повторяется в файле"))));
        PriceImportSession session = session(id, preview);
        session.invalidRows = 1;
        session.duplicateRows = 1;
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));

        var result = service.commit(id);

        assertThat(result.skipped()).isEqualTo(2);
        verifyNoInteractions(products);
    }

    @Test
    void commitRejectsPricesChangedAfterPreview() throws Exception {
        UUID id = UUID.randomUUID();
        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        id,
                        "prices.xlsx",
                        "ANALYZED",
                        false,
                        1,
                        new PriceImportPreviewDto.Summary(1, 0, 0, 0, 0, 0),
                        List.of(
                                new PriceImportPreviewDto.Row(
                                        2,
                                        "Лист1",
                                        "CHANGED",
                                        "A",
                                        "Product A",
                                        new BigDecimal("100"),
                                        new BigDecimal("120"),
                                        null,
                                        null,
                                        null,
                                        null,
                                        List.of())));
        PriceImportSession session = session(id, preview);
        Product product = product("A", "110");
        when(sessions.findByIdForUpdate(id)).thenReturn(java.util.Optional.of(session));
        when(products.findBySkuInAndDeletedAtIsNull(anySet())).thenReturn(List.of(product));

        assertThatThrownBy(() -> service.commit(id)).isInstanceOf(AppExceptions.BadRequest.class);

        verify(products, never()).saveAll(any());
        assertThat(product.price).isEqualByComparingTo("110");
    }

    @Test
    void batchAnalysisRecognizesFileNamesAndMergesPricesBySku() {
        var retail = new MockMultipartFile("files", "розница_all.mxl", null, new byte[] {1});
        var wholesale = new MockMultipartFile("files", "оптовая_all.mxl", null, new byte[] {2});
        var incoming = new MockMultipartFile("files", "приходная.mxl", null, new byte[] {3});
        Product product = product("1405", "100");
        product.wholesalePrice = new BigDecimal("80");
        product.incomingPrice = new BigDecimal("55");

        when(runner.maxRows()).thenReturn(10_000);
        when(runner.analyze(retail, ImportPriceType.RETAIL))
                .thenReturn(
                        analysis(
                                new PriceImportPythonRunner.SourceRow(
                                        "1С MXL",
                                        2,
                                        "00000001405",
                                        "Котёл",
                                        new BigDecimal("120"),
                                        null,
                                        null,
                                        null,
                                        false,
                                        List.of(),
                                        null)));
        when(runner.analyze(wholesale, ImportPriceType.WHOLESALE))
                .thenReturn(
                        analysis(
                                new PriceImportPythonRunner.SourceRow(
                                        "1С MXL",
                                        2,
                                        "1405",
                                        "Котёл",
                                        null,
                                        new BigDecimal("90"),
                                        null,
                                        null,
                                        false,
                                        List.of(),
                                        null)));
        when(runner.analyze(incoming, ImportPriceType.INCOMING))
                .thenReturn(
                        analysis(
                                new PriceImportPythonRunner.SourceRow(
                                        "1С MXL",
                                        2,
                                        "1405",
                                        "Котёл",
                                        null,
                                        null,
                                        null,
                                        null,
                                        false,
                                        List.of(),
                                        new BigDecimal("60"))));
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1405"))).thenReturn(List.of(product));
        when(sessions.save(any(PriceImportSession.class)))
                .thenAnswer(
                        invocation -> {
                            PriceImportSession session = invocation.getArgument(0);
                            if (session.id == null) session.id = UUID.randomUUID();
                            return session;
                        });

        PriceImportPreviewDto result = service.analyzeBatch(List.of(retail, wholesale, incoming), actor(), false);

        assertThat(result.sourceFiles())
                .extracting(PriceImportPreviewDto.SourceFile::priceType)
                .containsExactly(
                        ImportPriceType.RETAIL, ImportPriceType.WHOLESALE, ImportPriceType.INCOMING);
        assertThat(result.rows())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.sku()).isEqualTo("1405");
                            assertThat(row.newPrice()).isEqualByComparingTo("120");
                            assertThat(row.newWholesalePrice()).isEqualByComparingTo("90");
                            assertThat(row.newIncomingPrice()).isEqualByComparingTo("60");
                        });
    }

    @Test
    void batchAnalysisRejectsTwoFilesForTheSamePriceType() {
        var first = new MockMultipartFile("files", "розница_all.mxl", null, new byte[] {1});
        var second = new MockMultipartFile("files", "розничная_сентябрь.mxl", null, new byte[] {2});

        when(runner.maxRows()).thenReturn(10_000);
        when(runner.analyze(first, ImportPriceType.RETAIL))
                .thenReturn(analysis(sourceRow(2, "1405", "Котёл")));

        assertThatThrownBy(() -> service.analyzeBatch(List.of(first, second), actor(), false))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("больше одного файла");
    }

    private PriceImportPythonRunner.SourceRow row(
            int number,
            String sku,
            String price,
            String wholesale,
            String bulk,
            List<String> errors) {
        return new PriceImportPythonRunner.SourceRow(
                "Лист1",
                number,
                sku,
                "Product " + sku,
                decimal(price),
                decimal(wholesale),
                decimal(bulk),
                errors);
    }

    private PriceImportPythonRunner.Analysis analysis(PriceImportPythonRunner.SourceRow source) {
        return new PriceImportPythonRunner.Analysis("{\"schemaVersion\":1,\"rows\":[]}", List.of(source));
    }

    private PriceImportPythonRunner.SourceRow sourceRow(int number, String sku, String name) {
        return new PriceImportPythonRunner.SourceRow(
                "Лист1", number, sku, name, new BigDecimal("100"), null, null, List.of());
    }

    private BigDecimal decimal(String value) {
        return value == null ? null : new BigDecimal(value);
    }

    private Product product(String sku, String price) {
        Product product = new Product();
        product.id = (long) sku.hashCode();
        product.sku = sku;
        product.nameRu = "Product " + sku;
        product.nameKk = product.nameRu;
        product.price = new BigDecimal(price);
        product.active = true;
        return product;
    }

    private CurrentUser actor() {
        return new CurrentUser(
                1L,
                "admin@active.kz",
                "Admin",
                "+7",
                Set.of("products.update"),
                true,
                BigDecimal.ZERO);
    }

    private PriceImportSession session(UUID id, PriceImportPreviewDto preview) throws Exception {
        PriceImportSession session = new PriceImportSession();
        session.id = id;
        session.fileName = preview.fileName();
        session.status = PriceImportStatus.ANALYZED;
        session.analysisJson = "{}";
        session.previewJson = objectMapper.writeValueAsString(preview);
        return session;
    }
}
