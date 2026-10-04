package kz.company.shop.products.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.categories.service.CategoryService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.productImages.entity.ProductImage;
import kz.company.shop.productImages.repository.ProductImageRepository;
import kz.company.shop.products.dto.ProductAvailabilityStatusRequest.Status;
import kz.company.shop.products.dto.ProductDto;
import kz.company.shop.products.dto.ProductListParams;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto.PriceType;
import kz.company.shop.products.dto.ProductPriceAnalyticsFilter;
import kz.company.shop.products.entity.MeasurementUnit;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.search.EmbeddingClient;
import kz.company.shop.search.EmbeddingProperties;
import kz.company.shop.search.HeatingSearchRanker;
import kz.company.shop.search.SearchEmbeddingIndexer;
import kz.company.shop.search.SearchEmbeddingRepository;
import kz.company.shop.settings.service.ProjectSettingsService;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;

class ProductServiceTest {
    private final ProductRepository products = mock(ProductRepository.class);
    private final ProductImageRepository images = mock(ProductImageRepository.class);
    private final FileStorageService files = mock(FileStorageService.class);
    private final CategoryService categories = mock(CategoryService.class);
    private final AuditService audit = mock(AuditService.class);
    private final EmbeddingProperties embeddingProperties = mock(EmbeddingProperties.class);
    private final EmbeddingClient embeddingClient = mock(EmbeddingClient.class);
    private final SearchEmbeddingRepository embeddings = mock(SearchEmbeddingRepository.class);
    private final SearchEmbeddingIndexer embeddingIndexer = mock(SearchEmbeddingIndexer.class);
    private final ProjectSettingsService settings = mock(ProjectSettingsService.class);
    private final HeatingSearchRanker heatingSearchRanker = new HeatingSearchRanker();
    private final PricingService pricing = mock(PricingService.class);
    private final ProductService service =
            new ProductService(
                    products,
                    images,
                    files,
                    categories,
                    audit,
                    embeddingProperties,
                    embeddingClient,
                    embeddings,
                    embeddingIndexer,
                    settings,
                    heatingSearchRanker,
                    pricing);

    @Test
    void productCreationDefaultsToKilogramsAndAllowsPieceOverride() {
        when(products.save(any(Product.class))).thenAnswer(invocation -> invocation.getArgument(0));
        assertThat(service.create(productInput(null)).measurementUnit())
                .isEqualTo(MeasurementUnit.KG);
        assertThat(service.create(productInput(MeasurementUnit.PIECE)).measurementUnit())
                .isEqualTo(MeasurementUnit.PIECE);
    }

    @Test
    void productUpdatePreservesOmittedUnitAndAppliesExplicitUnit() {
        Product product = new Product();
        product.id = 17L;
        product.measurementUnit = MeasurementUnit.PIECE;
        when(products.findByIdAndDeletedAtIsNull(17L)).thenReturn(Optional.of(product));
        when(products.save(any(Product.class))).thenAnswer(invocation -> invocation.getArgument(0));
        assertThat(service.update(17L, productInput(null)).measurementUnit())
                .isEqualTo(MeasurementUnit.PIECE);
        assertThat(service.update(17L, productInput(MeasurementUnit.KG)).measurementUnit())
                .isEqualTo(MeasurementUnit.KG);
    }

    private static ProductDto productInput(MeasurementUnit unit) {
        return new ProductDto(
                null,
                "VEG-1",
                "Картофель",
                "Картоп",
                null,
                null,
                null,
                null,
                new BigDecimal("200"),
                null,
                null,
                null,
                null,
                null,
                null,
                true,
                false,
                null,
                null,
                List.of(),
                null,
                null,
                null,
                unit);
    }

    @Test
    void lexicalOnlySearchBypassesSemanticSearch() {
        when(products.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));

        var result =
                service.list(
                        new ProductListParams(
                                1, 50, "2456", null, null, null, null, null, "sku", "asc", true,
                                true));

        assertThat(result.items()).isEmpty();
        verify(products).findAll(any(Specification.class), any(Pageable.class));
        verifyNoInteractions(embeddingProperties, embeddingClient, embeddings, settings);
    }

    @Test
    void keyboardMashFallsBackToLexicalSearch() {
        when(products.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of()));

        var result =
                service.list(
                        new ProductListParams(
                                1, 12, "фываыва", null, null, null, null, null, null, null, false,
                                false));

        assertThat(result.items()).isEmpty();
        verify(products).findAll(any(Specification.class), any(Pageable.class));
        verifyNoInteractions(embeddingProperties, embeddingClient, embeddings, settings);
    }

    @Test
    void returnsPersonalDiscountedRetailPriceForStorefront() {
        Product product = new Product();
        product.id = 7L;
        product.sku = "1421";
        product.nameRu = "Товар";
        product.nameKk = "Тауар";
        product.price = new BigDecimal("1000.00");
        product.incomingPrice = new BigDecimal("600.00");
        product.active = true;
        BigDecimal discount = new BigDecimal("15");
        when(products.findByIdAndDeletedAtIsNull(7L)).thenReturn(Optional.of(product));
        when(images.findByProductIdOrderBySortOrderAsc(7L)).thenReturn(List.of());
        when(pricing.discountedRetailPrice(product.price, discount))
                .thenReturn(new BigDecimal("850"));

        var result = service.getPublic(7L, discount);

        assertThat(result.price()).isEqualByComparingTo("850");
        assertThat(result.regularPrice()).isEqualByComparingTo("1000");
        assertThat(result.personalDiscountPercent()).isEqualByComparingTo("15");
        assertThat(result.incomingPrice()).isNull();
    }

    @Test
    void doesNotReturnInactiveProductToStorefrontEvenWhenItIsMadeToOrder() {
        Product product = new Product();
        product.id = 7L;
        product.sku = "1421";
        product.nameRu = "Скрытый товар";
        product.active = false;
        product.madeToOrder = true;

        when(products.findByIdAndDeletedAtIsNull(7L)).thenReturn(Optional.of(product));

        assertThatThrownBy(() -> service.getPublic(7L, BigDecimal.ZERO))
                .isInstanceOf(AppExceptions.NotFound.class);
        verifyNoInteractions(images);
    }

    @Test
    void changesAvailabilityBetweenHiddenMadeToOrderAndAvailable() {
        Product product = new Product();
        product.id = 7L;
        product.sku = "1421";
        product.nameRu = "Товар";
        product.nameKk = "Тауар";
        product.price = new BigDecimal("1000.00");
        product.active = true;
        product.madeToOrder = false;
        product.deliveryDaysFrom = 3;
        product.deliveryDaysTo = 5;
        when(products.findByIdAndDeletedAtIsNull(7L)).thenReturn(Optional.of(product));
        when(products.save(product)).thenReturn(product);
        when(images.findByProductIdOrderBySortOrderAsc(7L)).thenReturn(List.of());

        service.updateAvailabilityStatus(7L, Status.HIDDEN);

        assertThat(product.active).isFalse();
        assertThat(product.madeToOrder).isFalse();
        assertThat(product.deliveryDaysFrom).isNull();
        assertThat(product.deliveryDaysTo).isNull();

        service.updateAvailabilityStatus(7L, Status.MADE_TO_ORDER);

        assertThat(product.active).isTrue();
        assertThat(product.madeToOrder).isTrue();

        service.updateAvailabilityStatus(7L, Status.AVAILABLE);

        assertThat(product.active).isTrue();
        assertThat(product.madeToOrder).isFalse();
        assertThat(product.deliveryDaysFrom).isNull();
        assertThat(product.deliveryDaysTo).isNull();
        verify(products, org.mockito.Mockito.times(3)).save(product);
    }

    @Test
    void excludesAndCleansUpImageWhoseLegacyFileIsMissing() {
        Product product = new Product();
        product.id = 7L;
        product.sku = "1421";
        product.nameRu = "Товар";
        product.nameKk = "Тауар";
        product.price = new BigDecimal("1000.00");

        ProductImage image = new ProductImage();
        image.id = 17L;
        image.fileName = "missing.webp";
        image.filePath = "/uploads/missing.webp";
        image.originalFileName = "missing.webp";
        image.sortOrder = 1;
        image.mainImage = true;

        when(products.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(product)));
        when(images.findByProductIdOrderBySortOrderAsc(7L)).thenReturn(List.of(image));
        when(files.contentHash("missing.webp"))
                .thenThrow(new AppExceptions.NotFound("Файл не найден"));

        var result =
                service.list(
                        new ProductListParams(
                                1, 12, null, null, null, null, null, null, "nameRu", "asc", true,
                                true));

        assertThat(result.items())
                .singleElement()
                .satisfies(item -> assertThat(item.images()).isEmpty());
        verify(images).deleteAll(List.of(image));
    }

    @Test
    void priceAnalyticsMarksAndPlacesBelowIncomingPricesInTheResult() {
        Product product = new Product();
        product.id = 12L;
        product.sku = "P-12";
        product.nameRu = "Насос";
        product.nameKk = "Сорғы";
        product.categoryId = 3L;
        product.incomingPrice = new BigDecimal("100.00");
        product.price = new BigDecimal("130.00");
        product.wholesalePrice = new BigDecimal("95.00");
        product.active = true;
        when(products.findPriceAnalytics(
                        any(), any(), any(ProductPriceAnalyticsFilter.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(product)));
        when(categories.nameRu(3L)).thenReturn("Насосы");

        var result = service.priceAnalytics(1, 20, null, null, null, null, null, false);

        assertThat(result.items())
                .singleElement()
                .satisfies(
                        row -> {
                            assertThat(row.hasPriceBelowIncoming()).isTrue();
                            assertThat(row.categoryNameRu()).isEqualTo("Насосы");
                            assertThat(row.priceLevels())
                                    .anySatisfy(
                                            level -> {
                                                assertThat(level.type())
                                                        .isEqualTo(PriceType.RETAIL);
                                                assertThat(level.markupPercent())
                                                        .isEqualByComparingTo("30.00");
                                                assertThat(level.belowIncoming()).isFalse();
                                            })
                                    .anySatisfy(
                                            level -> {
                                                assertThat(level.type())
                                                        .isEqualTo(PriceType.WHOLESALE);
                                                assertThat(level.markupPercent())
                                                        .isEqualByComparingTo("-5.00");
                                                assertThat(level.belowIncoming()).isTrue();
                                            });
                        });
    }

    @Test
    void priceAnalyticsByCategoryMapsAverageMinimumAndMaximumMarkup() {
        when(products.priceAnalyticsByCategory())
                .thenReturn(
                        List.<Object[]>of(
                                new Object[] {
                                    3L,
                                    "Насосы",
                                    4L,
                                    4L,
                                    new BigDecimal("35.5"),
                                    new BigDecimal("10"),
                                    new BigDecimal("70"),
                                    3L,
                                    new BigDecimal("20"),
                                    new BigDecimal("5"),
                                    new BigDecimal("40"),
                                    2L,
                                    new BigDecimal("12"),
                                    new BigDecimal("2"),
                                    new BigDecimal("25"),
                                    1L,
                                    new BigDecimal("8"),
                                    new BigDecimal("8"),
                                    new BigDecimal("8")
                                }));

        var result = service.priceAnalyticsByCategory();

        assertThat(result)
                .singleElement()
                .satisfies(
                        category -> {
                            assertThat(category.categoryNameRu()).isEqualTo("Насосы");
                            assertThat(category.productCount()).isEqualTo(4);
                            assertThat(category.priceLevels())
                                    .anySatisfy(
                                            level -> {
                                                assertThat(level.type())
                                                        .isEqualTo(PriceType.RETAIL);
                                                assertThat(level.averageMarkupPercent())
                                                        .isEqualByComparingTo("35.5");
                                                assertThat(level.minimumMarkupPercent())
                                                        .isEqualByComparingTo("10");
                                                assertThat(level.maximumMarkupPercent())
                                                        .isEqualByComparingTo("70");
                                            });
                        });
    }
}
