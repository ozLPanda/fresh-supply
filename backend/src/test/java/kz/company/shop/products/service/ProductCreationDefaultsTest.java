package kz.company.shop.products.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import jakarta.validation.Validation;
import java.math.BigDecimal;
import java.util.Optional;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.categories.service.CategoryService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.productImages.repository.ProductImageRepository;
import kz.company.shop.products.dto.ProductDto;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.search.*;
import kz.company.shop.settings.service.ProjectSettingsService;
import org.junit.jupiter.api.Test;

class ProductCreationDefaultsTest {
    private final ProductRepository products = mock(ProductRepository.class);
    private final ProductService service =
            new ProductService(
                    products,
                    mock(ProductImageRepository.class),
                    mock(FileStorageService.class),
                    mock(CategoryService.class),
                    mock(AuditService.class),
                    mock(EmbeddingProperties.class),
                    mock(EmbeddingClient.class),
                    mock(SearchEmbeddingRepository.class),
                    mock(SearchEmbeddingIndexer.class),
                    mock(ProjectSettingsService.class),
                    mock(HeatingSearchRanker.class),
                    mock(PricingService.class));

    @Test
    void generatesMissingArticlesAndStoresMissingKazakhNamesAsEmptyStrings() {
        when(products.nextSkuNumber()).thenReturn(124L, 125L);
        when(products.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ProductDto first = service.create(input(null, null));
        ProductDto second = service.create(input("  ", "  "));
        assertThat(first.sku()).isEqualTo("124");
        assertThat(second.sku()).isEqualTo("125");
        assertThat(first.nameKk()).isEmpty();
        assertThat(second.nameKk()).isEmpty();
    }

    @Test
    void skipsArticlesAlreadyUsedIncludingDeletedProducts() {
        when(products.nextSkuNumber()).thenReturn(124L, 125L);
        when(products.existsBySku("124")).thenReturn(true);
        assertThat(service.nextSku()).isEqualTo("125");
    }

    @Test
    void preservesManualArticleCaseAndLeadingZeros() {
        when(products.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        assertThat(service.create(input(" AB-001 ", "Картоп")).sku()).isEqualTo("AB-001");
        verify(products, never()).nextSkuNumber();
    }

    @Test
    void rejectsDuplicateManualArticle() {
        when(products.existsBySku("AB-001")).thenReturn(true);
        assertThatThrownBy(() -> service.create(input(" AB-001 ", "")))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessage("Артикул уже используется");
        verify(products, never()).save(any());
    }

    @Test
    void editingWithoutArticlePreservesExistingAndAllowsClearingKazakhName() {
        Product product = new Product();
        product.id = 1L;
        product.sku = "00123";
        product.nameRu = "Картофель";
        product.nameKk = "Картоп";
        when(products.findByIdAndDeletedAtIsNull(1L)).thenReturn(Optional.of(product));
        when(products.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ProductDto result = service.update(1L, input(null, null));
        assertThat(result.sku()).isEqualTo("00123");
        assertThat(result.nameKk()).isEmpty();
        verify(products, never()).nextSkuNumber();
    }

    @Test
    void requestValidationAllowsMissingArticleAndKazakhName() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertThat(factory.getValidator().validate(input(null, null))).isEmpty();
            assertThat(factory.getValidator().validate(input("", ""))).isEmpty();
        }
    }

    private ProductDto input(String sku, String nameKk) {
        return new ProductDto(
                null,
                sku,
                "Картофель",
                nameKk,
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
                null,
                null,
                null,
                null);
    }
}
