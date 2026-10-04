package kz.company.shop.priceImports.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.categories.service.CategoryService;
import kz.company.shop.priceImports.entity.PriceImportSession;
import kz.company.shop.priceImports.repository.PriceImportSessionRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.search.SearchEmbeddingIndexer;
import kz.company.shop.settings.service.ProjectSettingsService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

class ImportCreatedProductServiceTest {
    private final ProductRepository products = mock(ProductRepository.class);
    private final PriceImportSessionRepository imports = mock(PriceImportSessionRepository.class);
    private final CategoryService categories = mock(CategoryService.class);
    private final ProjectSettingsService settings = mock(ProjectSettingsService.class);
    private final SearchEmbeddingIndexer searchEmbeddingIndexer =
            mock(SearchEmbeddingIndexer.class);
    private final AuditService auditService = mock(AuditService.class);
    private final ImportCreatedProductService service =
            new ImportCreatedProductService(
                    products, imports, categories, settings, searchEmbeddingIndexer, auditService);

    @Test
    void returnsProductsWithTheirSourceFileAndCategory() {
        UUID importId = UUID.randomUUID();
        Product product = product(importId);
        PriceImportSession session = session(importId);
        when(products.findAll(any(Specification.class), any(Pageable.class)))
                .thenAnswer(
                        invocation ->
                                new PageImpl<>(List.of(product), invocation.getArgument(1), 1));
        when(imports.findAllById(List.of(importId))).thenReturn(List.of(session));
        when(categories.namesRu(List.of(7L))).thenReturn(Map.of(7L, "Насосы"));

        var result = service.list(0, 500, "  1405 ", importId, false, "nameRu", "asc");

        assertThat(result.page()).isEqualTo(1);
        assertThat(result.size()).isEqualTo(200);
        assertThat(result.totalItems()).isEqualTo(1);
        assertThat(result.items())
                .singleElement()
                .satisfies(
                        item -> {
                            assertThat(item.id()).isEqualTo(11L);
                            assertThat(item.sku()).isEqualTo("1405");
                            assertThat(item.categoryId()).isEqualTo(7L);
                            assertThat(item.categoryName()).isEqualTo("Насосы");
                            assertThat(item.importId()).isEqualTo(importId);
                            assertThat(item.importFileName()).isEqualTo("prices.xlsx");
                            assertThat(item.importedAt()).isEqualTo(session.completedAt);
                        });

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Pageable> pageableCaptor = ArgumentCaptor.forClass(Pageable.class);
        verify(products).findAll(any(Specification.class), pageableCaptor.capture());
        assertThat(pageableCaptor.getValue().getPageNumber()).isZero();
        assertThat(pageableCaptor.getValue().getPageSize()).isEqualTo(200);
        assertThat(pageableCaptor.getValue().getSort().getOrderFor("nameRu").isAscending())
                .isTrue();
    }

    @Test
    void labelsProductsWithoutCategory() {
        UUID importId = UUID.randomUUID();
        Product product = product(importId);
        product.categoryId = null;
        PriceImportSession session = session(importId);
        when(products.findAll(any(Specification.class), any(Pageable.class)))
                .thenAnswer(
                        invocation ->
                                new PageImpl<>(List.of(product), invocation.getArgument(1), 1));
        when(imports.findAllById(List.of(importId))).thenReturn(List.of(session));
        when(categories.namesRu(List.of())).thenReturn(Map.of());

        var result = service.list(1, 20, null, null, null, null, null);

        assertThat(result.items())
                .singleElement()
                .satisfies(
                        item -> {
                            assertThat(item.categoryId()).isNull();
                            assertThat(item.categoryName()).isEqualTo("Нет категории");
                        });
    }

    @Test
    void returnsOnlyImportsThatStillOwnCreatedProducts() {
        UUID importId = UUID.randomUUID();
        PriceImportSession session = session(importId);
        session.committedCreated = 25;
        when(imports.findAllWithCreatedProducts()).thenReturn(List.of(session));

        var result = service.imports();

        assertThat(result)
                .singleElement()
                .satisfies(
                        item -> {
                            assertThat(item.importId()).isEqualTo(importId);
                            assertThat(item.fileName()).isEqualTo("prices.xlsx");
                            assertThat(item.completedAt()).isEqualTo(session.completedAt);
                            assertThat(item.createdCount()).isEqualTo(25);
                        });
    }

    @Test
    void skipsDraftsWithInvalidPriceOrExcludedNameDuringActivationAnalysis() {
        UUID importId = UUID.randomUUID();
        Product eligible = product(importId);
        Product excluded = product(importId);
        excluded.id = 12L;
        excluded.nameRu = "Не Выбирать насос";
        Product zeroPrice = product(importId);
        zeroPrice.id = 13L;
        zeroPrice.price = BigDecimal.ZERO;
        when(products.findImportCreatedDrafts()).thenReturn(List.of(eligible, excluded, zeroPrice));
        when(settings.priceImportExcludedNameTerms()).thenReturn(List.of("витринный образец"));

        var result = service.analyzeDraftActivation();

        assertThat(result.totalDrafts()).isEqualTo(3);
        assertThat(result.readyToActivate()).isEqualTo(1);
        assertThat(result.excludedNameTerms())
                .contains("не выбирать", "корзина", "витринный образец");
        assertThat(result.skippedProducts())
                .extracting(item -> item.productId())
                .containsExactlyInAnyOrder(12L, 13L);
        assertThat(result.skippedProducts())
                .filteredOn(item -> item.productId().equals(12L))
                .singleElement()
                .satisfies(
                        item ->
                                assertThat(item.reasons())
                                        .contains("Служебные слова: не выбирать"));
        assertThat(result.skippedProducts())
                .filteredOn(item -> item.productId().equals(13L))
                .singleElement()
                .satisfies(item -> assertThat(item.reasons()).contains("Цена не больше 0"));
    }

    @Test
    void activatesOnlyDraftsThatPassTheSameAnalysis() {
        Product eligible = product(UUID.randomUUID());
        Product excluded = product(UUID.randomUUID());
        excluded.id = 12L;
        excluded.nameRu = "Корзина для мусора";
        when(products.findImportCreatedDrafts()).thenReturn(List.of(eligible, excluded));
        when(settings.priceImportExcludedNameTerms()).thenReturn(List.of());
        when(products.saveAll(any())).thenReturn(List.of(eligible));

        var result = service.activateEligibleDrafts();

        assertThat(result.activatedProducts()).isEqualTo(1);
        assertThat(eligible.active).isTrue();
        assertThat(excluded.active).isFalse();
        assertThat(result.skippedProducts())
                .singleElement()
                .satisfies(item -> assertThat(item.productId()).isEqualTo(12L));
        verify(searchEmbeddingIndexer).indexProduct(eligible);
        verify(auditService)
                .record(
                        eq("IMPORT_DRAFTS_ACTIVATE"),
                        eq("PRODUCT"),
                        eq(null),
                        eq("Активировал 1 товаров, созданных импортом цен; пропущено 1"));
    }

    private Product product(UUID importId) {
        Product product = new Product();
        product.id = 11L;
        product.sku = "1405";
        product.nameRu = "Насос";
        product.nameKk = "Сорғы";
        product.price = new BigDecimal("120.00");
        product.wholesalePrice = new BigDecimal("100.00");
        product.bulkWholesalePrice = new BigDecimal("90.00");
        product.categoryId = 7L;
        product.active = false;
        product.createdFromPriceImportId = importId;
        product.createdAt = Instant.parse("2026-07-16T08:00:00Z");
        return product;
    }

    private PriceImportSession session(UUID importId) {
        PriceImportSession session = new PriceImportSession();
        session.id = importId;
        session.fileName = "prices.xlsx";
        session.completedAt = Instant.parse("2026-07-16T09:00:00Z");
        session.createdAt = Instant.parse("2026-07-16T08:00:00Z");
        return session;
    }
}
