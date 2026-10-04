package kz.company.shop.priceStatistics.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import kz.company.shop.categories.entity.Category;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.priceImports.dto.PriceImportPreviewDto;
import kz.company.shop.priceImports.entity.PriceImportSession;
import kz.company.shop.priceStatistics.entity.PriceChangeSnapshot;
import kz.company.shop.priceStatistics.entity.PriceStatisticsImport;
import kz.company.shop.priceStatistics.entity.PriceStatisticsScope;
import kz.company.shop.priceStatistics.repository.PriceChangeSnapshotRepository;
import kz.company.shop.priceStatistics.repository.PriceChangeSnapshotRepository.ProductPriceHistoryProjection;
import kz.company.shop.priceStatistics.repository.PriceStatisticsImportRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.warehouse.repository.PriceSettingGroupRepository;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.StockDocumentRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class PriceStatisticsServiceTest {
    private final PriceStatisticsImportRepository imports =
            mock(PriceStatisticsImportRepository.class);
    private final PriceChangeSnapshotRepository snapshots =
            mock(PriceChangeSnapshotRepository.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final CategoryRepository categories = mock(CategoryRepository.class);
    private final StockDocumentRepository documents = mock(StockDocumentRepository.class);
    private final StockDocumentLineRepository documentLines = mock(StockDocumentLineRepository.class);
    private final PriceSettingGroupRepository priceSettingGroups =
            mock(PriceSettingGroupRepository.class);
    private final PriceStatisticsService service =
            new PriceStatisticsService(
                    imports,
                    snapshots,
                    products,
                    categories,
                    documents,
                    documentLines,
                    priceSettingGroups);

    @Test
    void recordsImmutableSnapshotsAndAveragesOnlyChangedPricesWithPositiveOldValue() {
        UUID importId = UUID.randomUUID();
        PriceImportSession session = session(importId);
        Product product = product();
        Category category = category();
        Category categoryWithoutId = new Category();
        when(imports.existsByImportSessionId(importId)).thenReturn(false);
        when(imports.save(any(PriceStatisticsImport.class)))
                .thenAnswer(
                        invocation -> {
                            PriceStatisticsImport value = invocation.getArgument(0);
                            value.id = 10L;
                            return value;
                        });
        when(products.findBySkuInAndDeletedAtIsNull(Set.of("1405"))).thenReturn(List.of(product));
        when(categories.findAllById(Set.of(7L)))
                .thenReturn(List.of(category, categoryWithoutId, category));

        service.recordCompletedImport(session, preview(importId));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<PriceChangeSnapshot>> changesCaptor =
                ArgumentCaptor.forClass(List.class);
        verify(snapshots).saveAll(changesCaptor.capture());
        assertThat(changesCaptor.getValue()).hasSize(2);
        assertThat(changesCaptor.getValue())
                .extracting(change -> change.changePercent)
                .containsExactly(new BigDecimal("20.000000"), new BigDecimal("-10.000000"));
        assertThat(changesCaptor.getValue())
                .allSatisfy(
                        change -> {
                            assertThat(change.productName).isEqualTo("Насос");
                            assertThat(change.categoryName).isEqualTo("Насосы");
                        });

        ArgumentCaptor<PriceStatisticsImport> importCaptor =
                ArgumentCaptor.forClass(PriceStatisticsImport.class);
        verify(imports, times(2)).save(importCaptor.capture());
        PriceStatisticsImport saved = importCaptor.getAllValues().get(1);
        assertThat(saved.changedProducts).isEqualTo(1);
        assertThat(saved.changedPricePoints).isEqualTo(2);
        assertThat(saved.averageChangePercent).isEqualByComparingTo("5.000000");
    }

    @Test
    void recordingIsIdempotentForImportSession() {
        UUID importId = UUID.randomUUID();
        when(imports.existsByImportSessionId(importId)).thenReturn(true);

        service.recordCompletedImport(session(importId), preview(importId));

        verify(imports, never()).save(any());
        verifyNoInteractions(snapshots, products, categories);
    }

    @Test
    void groupsImportsCompletedWithinTenMinutesIntoOnePriceUpdate() {
        UUID retailImportId = UUID.randomUUID();
        UUID wholesaleImportId = UUID.randomUUID();
        UUID laterImportId = UUID.randomUUID();
        PriceStatisticsImport retail =
                statisticsImport(retailImportId, 10L, "retail.xlsx", "2026-07-16T08:00:00Z");
        PriceStatisticsImport wholesale =
                statisticsImport(wholesaleImportId, 11L, "wholesale.xlsx", "2026-07-16T08:08:00Z");
        PriceStatisticsImport later =
                statisticsImport(laterImportId, 12L, "later.xlsx", "2026-07-16T08:19:00Z");
        when(imports.findAllByOrderByCompletedAtAsc())
                .thenReturn(List.of(retail, wholesale, later));
        when(snapshots.findByStatisticsImportIdIn(List.of(10L, 11L)))
                .thenReturn(
                        List.of(
                                snapshot("RETAIL", "100", "120", "20"),
                                snapshot("WHOLESALE", "50", "55", "10")));
        when(snapshots.findByStatisticsImportIdIn(List.of(12L)))
                .thenReturn(List.of(snapshot("RETAIL", "120", "130", "8.333333")));

        var result = service.imports(1, 20);

        assertThat(result.totalItems()).isEqualTo(2);
        assertThat(result.items())
                .first()
                .satisfies(
                        group -> {
                            assertThat(group.importId()).isEqualTo(laterImportId);
                            assertThat(group.importCount()).isEqualTo(1);
                        });
        assertThat(result.items())
                .element(1)
                .satisfies(
                        group -> {
                            assertThat(group.importId()).isEqualTo(retailImportId);
                            assertThat(group.importCount()).isEqualTo(2);
                            assertThat(group.fileNames())
                                    .containsExactly("retail.xlsx", "wholesale.xlsx");
                            assertThat(group.priceTypes())
                                    .anySatisfy(
                                            type -> {
                                                assertThat(type.priceType()).isEqualTo("RETAIL");
                                                assertThat(type.averageChangePercent())
                                                        .isEqualByComparingTo("20");
                                            });
                        });
    }

    @Test
    void analyzesPriceGrowthAndVolatilityAcrossTheSelectedPeriod() {
        UUID firstId = UUID.randomUUID();
        UUID secondId = UUID.randomUUID();
        PriceStatisticsImport first =
                statisticsImport(firstId, 10L, "first.xlsx", "2026-07-01T08:00:00Z");
        PriceStatisticsImport second =
                statisticsImport(secondId, 11L, "second.xlsx", "2026-07-08T08:00:00Z");
        PriceChangeSnapshot increase = snapshot("RETAIL", "100", "110", "10");
        PriceChangeSnapshot decrease = snapshot("RETAIL", "110", "99", "-10");
        decrease.statisticsImportId = 11L;
        when(imports.findAllByOrderByCompletedAtAsc()).thenReturn(List.of(first, second));
        when(snapshots.findByStatisticsImportIdIn(List.of(10L, 11L)))
                .thenReturn(List.of(increase, decrease));

        var result =
                service.periodAnalytics(
                        kz.company.shop.priceStatistics.entity.PriceType.RETAIL, "all");

        assertThat(result.changedProducts()).isEqualTo(1);
        assertThat(result.decreasedProducts()).isEqualTo(1);
        assertThat(result.unstableProducts()).isEqualTo(1);
        assertThat(result.products())
                .singleElement()
                .satisfies(
                        product -> {
                            assertThat(product.netChangePercent()).isEqualByComparingTo("-1");
                            assertThat(product.updateCount()).isEqualTo(2);
                            assertThat(product.averageAbsoluteChangePercent())
                                    .isEqualByComparingTo("10");
                        });
        assertThat(result.categories())
                .singleElement()
                .extracting(category -> category.averageVolatilityPercent())
                .isEqualTo(new BigDecimal("10.000000"));
    }

    @Test
    void returnsProtectedProductDrillDownForTheSelectedPriceType() {
        UUID importId = UUID.randomUUID();
        PriceStatisticsImport statisticsImport = statisticsImport(importId);
        Product product = product();
        when(products.findByIdAndDeletedAtIsNull(3L)).thenReturn(Optional.of(product));
        when(imports.findAllByOrderByCompletedAtAsc()).thenReturn(List.of(statisticsImport));
        when(snapshots.findByStatisticsImportIdIn(List.of(10L)))
                .thenReturn(
                        List.of(
                                snapshot("RETAIL", "100", "120", "20"),
                                snapshot("INCOMING", "50", "60", "20")));

        var result =
                service.productTrendHistory(
                        3L, kz.company.shop.priceStatistics.entity.PriceType.INCOMING, "all");

        assertThat(result.priceType()).isEqualTo("INCOMING");
        assertThat(result.points())
                .singleElement()
                .satisfies(
                        point -> {
                            assertThat(point.oldPrice()).isEqualByComparingTo("50");
                            assertThat(point.newPrice()).isEqualByComparingTo("60");
                        });
    }

    @Test
    void returnsCategoryAndProductBreakdownFromStoredSnapshots() {
        UUID importId = UUID.randomUUID();
        PriceStatisticsImport statisticsImport = statisticsImport(importId);
        when(imports.findAllByOrderByCompletedAtAsc()).thenReturn(List.of(statisticsImport));
        when(snapshots.findByStatisticsImportIdIn(List.of(10L)))
                .thenReturn(
                        List.of(
                                snapshot("RETAIL", "100", "120", "20"),
                                snapshot("WHOLESALE", "50", "45", "-10")));

        var categoryRows = service.categories(importId);
        var productRows = service.products(importId, 1, 20, 7L, "1405");

        assertThat(categoryRows)
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.changedProducts()).isEqualTo(1);
                            assertThat(row.changedPricePoints()).isEqualTo(2);
                            assertThat(row.averageChangePercent()).isEqualByComparingTo("5");
                        });
        assertThat(productRows.totalItems()).isEqualTo(1);
        assertThat(productRows.items())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.sku()).isEqualTo("1405");
                            assertThat(row.changes()).hasSize(2);
                            assertThat(row.averageChangePercent()).isEqualByComparingTo("5");
                        });
    }

    @Test
    void separatesIncomingCostChangesFromSalesPriceStatistics() {
        UUID importId = UUID.randomUUID();
        when(imports.findAllByOrderByCompletedAtAsc())
                .thenReturn(List.of(statisticsImport(importId)));
        when(snapshots.findByStatisticsImportIdIn(List.of(10L)))
                .thenReturn(
                        List.of(
                                snapshot("RETAIL", "100", "120", "20"),
                                snapshot("INCOMING", "50", "60", "20")));

        var incomingRows =
                service.products(importId, 1, 20, null, "", PriceStatisticsScope.INCOMING);
        var salesRows = service.products(importId, 1, 20, null, "", PriceStatisticsScope.SALES);

        assertThat(incomingRows.items())
                .singleElement()
                .satisfies(
                        row ->
                                assertThat(row.changes())
                                        .extracting(change -> change.priceType())
                                        .containsExactly("INCOMING"));
        assertThat(salesRows.items())
                .singleElement()
                .satisfies(
                        row ->
                                assertThat(row.changes())
                                        .extracting(change -> change.priceType())
                                        .containsExactly("RETAIL"));
    }

    @Test
    void restoresMissingCategoryNameFromCurrentCategory() {
        UUID importId = UUID.randomUUID();
        PriceChangeSnapshot change = snapshot("RETAIL", "100", "120", "20");
        change.categoryName = null;
        CategoryRepository.NameRuProjection categoryName =
                mock(CategoryRepository.NameRuProjection.class);
        when(categoryName.getId()).thenReturn(7L);
        when(categoryName.getNameRu()).thenReturn("Насосы");
        when(imports.findAllByOrderByCompletedAtAsc())
                .thenReturn(List.of(statisticsImport(importId)));
        when(snapshots.findByStatisticsImportIdIn(List.of(10L))).thenReturn(List.of(change));
        when(categories.findNamesRuByIdIn(Set.of(7L))).thenReturn(List.of(categoryName));

        var categoryRows = service.categories(importId);
        var productRows = service.products(importId, 1, 20, 7L, "");

        assertThat(categoryRows)
                .singleElement()
                .extracting(row -> row.categoryName())
                .isEqualTo("Насосы");
        assertThat(productRows.items())
                .singleElement()
                .extracting(row -> row.categoryName())
                .isEqualTo("Насосы");
    }

    @Test
    void keepsProductsWithoutCategoryInSingleUnassignedGroup() {
        UUID importId = UUID.randomUUID();
        PriceChangeSnapshot change = snapshot("RETAIL", "100", "120", "20");
        change.categoryId = null;
        change.categoryName = null;
        when(imports.findAllByOrderByCompletedAtAsc())
                .thenReturn(List.of(statisticsImport(importId)));
        when(snapshots.findByStatisticsImportIdIn(List.of(10L))).thenReturn(List.of(change));

        var categoryRows = service.categories(importId);

        assertThat(categoryRows)
                .singleElement()
                .extracting(row -> row.categoryName())
                .isEqualTo("Без категории");
        verify(categories, never()).findNamesRuByIdIn(any());
    }

    @Test
    void returnsChronologicalRetailHistoryForCustomerProductCard() {
        Product product = product();
        ProductPriceHistoryProjection first = mock(ProductPriceHistoryProjection.class);
        when(first.getChangedAt()).thenReturn(Instant.parse("2026-07-01T08:00:00Z"));
        when(first.getOldPrice()).thenReturn(new BigDecimal("100"));
        when(first.getNewPrice()).thenReturn(new BigDecimal("120"));
        when(first.getChangePercent()).thenReturn(new BigDecimal("20"));
        when(products.findByIdAndDeletedAtIsNull(3L)).thenReturn(Optional.of(product));
        when(snapshots.findRetailHistoryByProductId(3L)).thenReturn(List.of(first));

        var history = service.retailHistory(3L, "all");

        assertThat(history.period()).isEqualTo("all");
        assertThat(history.points())
                .singleElement()
                .satisfies(
                        point -> {
                            assertThat(point.changedAt())
                                    .isEqualTo(Instant.parse("2026-07-01T08:00:00Z"));
                            assertThat(point.oldPrice()).isEqualByComparingTo("100");
                            assertThat(point.newPrice()).isEqualByComparingTo("120");
                        });
        verify(snapshots).findRetailHistoryByProductId(3L);
    }

    private PriceImportSession session(UUID id) {
        PriceImportSession session = new PriceImportSession();
        session.id = id;
        session.fileName = "prices.xlsx";
        session.createdByName = "Admin";
        session.completedAt = Instant.parse("2026-07-16T08:00:00Z");
        return session;
    }

    private PriceImportPreviewDto preview(UUID id) {
        return new PriceImportPreviewDto(
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
                                "1405",
                                "Насос",
                                new BigDecimal("100"),
                                new BigDecimal("120"),
                                new BigDecimal("50"),
                                new BigDecimal("45"),
                                null,
                                new BigDecimal("30"),
                                List.of())));
    }

    private Product product() {
        Product product = new Product();
        product.id = 3L;
        product.sku = "1405";
        product.nameRu = "Насос";
        product.categoryId = 7L;
        return product;
    }

    private Category category() {
        Category category = new Category();
        category.id = 7L;
        category.nameRu = "Насосы";
        return category;
    }

    private PriceStatisticsImport statisticsImport(UUID importId) {
        return statisticsImport(importId, 10L, "prices.xlsx", "2026-07-16T08:00:00Z");
    }

    private PriceStatisticsImport statisticsImport(
            UUID importId, Long id, String fileName, String completedAt) {
        PriceStatisticsImport value = new PriceStatisticsImport();
        value.id = id;
        value.importSessionId = importId;
        value.fileName = fileName;
        value.createdByName = "Admin";
        value.completedAt = Instant.parse(completedAt);
        return value;
    }

    private PriceChangeSnapshot snapshot(
            String type, String oldPrice, String newPrice, String percent) {
        PriceChangeSnapshot value = new PriceChangeSnapshot();
        value.statisticsImportId = 10L;
        value.productId = 3L;
        value.sku = "1405";
        value.productName = "Насос";
        value.categoryId = 7L;
        value.categoryName = "Насосы";
        value.priceType = kz.company.shop.priceStatistics.entity.PriceType.valueOf(type);
        value.oldPrice = new BigDecimal(oldPrice);
        value.newPrice = new BigDecimal(newPrice);
        value.changePercent = new BigDecimal(percent);
        return value;
    }
}
