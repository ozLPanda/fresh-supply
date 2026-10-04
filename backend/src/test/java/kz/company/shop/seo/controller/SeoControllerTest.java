package kz.company.shop.seo.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Root;
import java.time.Instant;
import java.util.List;
import kz.company.shop.categories.entity.Category;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.mock.web.MockHttpServletRequest;

class SeoControllerTest {
    private final ProductRepository products = mock(ProductRepository.class);
    private final CategoryRepository categories = mock(CategoryRepository.class);
    private final SeoController controller =
            new SeoController(products, categories, new SeoOrigin("https://shop.example/"));
    private final MockHttpServletRequest request = new MockHttpServletRequest();

    @Test
    void indexPartitionsLargeCatalogWithoutLoadingEntities() {
        when(products.countByActiveTrueAndDeletedAtIsNull()).thenReturn(50001L);
        when(categories.countByActiveTrueAndDeletedAtIsNull()).thenReturn(1L);
        String xml = controller.sitemap(request).getBody();
        assertThat(xml)
                .contains(
                        "<sitemapindex",
                        "https://shop.example/sitemap-pages.xml",
                        "categories-1.xml",
                        "products-11.xml")
                .doesNotContain("products-12.xml", "<url>");
        verify(products, never()).findByActiveTrueAndDeletedAtIsNullOrderByUpdatedAtDesc();
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void productSitemapIsBoundedAndOnlySelectsVisibleProducts() {
        when(products.countByActiveTrueAndDeletedAtIsNull()).thenReturn(6000L);
        Product product = new Product();
        product.id = 42L;
        product.updatedAt = Instant.parse("2026-09-01T12:00:00Z");
        when(products.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(product)));
        String xml = controller.products(request, 2).getBody();
        assertThat(xml)
                .contains(
                        "https://shop.example/product/42",
                        "<lastmod>2026-09-01T12:00:00Z</lastmod>");
        ArgumentCaptor<Pageable> paging = ArgumentCaptor.forClass(Pageable.class);
        ArgumentCaptor<Specification<Product>> spec = ArgumentCaptor.forClass(Specification.class);
        verify(products).findAll(spec.capture(), paging.capture());
        assertThat(paging.getValue().getPageNumber()).isEqualTo(1);
        assertThat(paging.getValue().getPageSize()).isEqualTo(5000);
        assertThat(paging.getValue().getSort().getOrderFor("id").isAscending()).isTrue();
        Root<Product> root = mock(Root.class);
        CriteriaBuilder cb = mock(CriteriaBuilder.class);
        spec.getValue().toPredicate(root, mock(CriteriaQuery.class), cb);
        verify(root).get("active");
        verify(root).get("deletedAt");
        verify(cb).isTrue(any());
        verify(cb).isNull(any());
    }

    @Test
    void nonexistentPartitionsReturn404() {
        when(products.countByActiveTrueAndDeletedAtIsNull()).thenReturn(5000L);
        assertThat(controller.products(request, 0).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.products(request, 2).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.categories(request, 1).getStatusCode().value()).isEqualTo(404);
    }

    @Test
    @SuppressWarnings("unchecked")
    void categorySlugIsEncodedAsOnePathSegment() {
        when(categories.countByActiveTrueAndDeletedAtIsNull()).thenReturn(1L);
        Category category = new Category();
        category.slug = "тепло/газ & вода";
        when(categories.findAll(any(Specification.class), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(category)));
        assertThat(controller.categories(request, 1).getBody())
                .contains("%D1%82", "%2F", "%20&amp;%20");
    }

    @Test
    void robotsAllowsStorefrontResourcesAndUsesCanonicalDomain() {
        request.addHeader("X-Forwarded-Host", "other.example");
        assertThat(controller.robots(request).getBody())
                .contains(
                        "User-agent: *",
                        "Disallow: /api/",
                        "Allow: /api/products?",
                        "Allow: /api/products/*/storefront",
                        "Allow: /api/categories",
                        "Sitemap: https://shop.example/sitemap.xml");
    }

    @Test
    void originSupportsProxyFallbackAndRejectsInvalidConfiguredUrl() {
        request.addHeader("X-Forwarded-Host", "shop.example, internal:8080");
        request.addHeader("X-Forwarded-Proto", "https, http");
        assertThat(new SeoOrigin("").resolve(request)).isEqualTo("https://shop.example");
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> new SeoOrigin("https://shop.example/path").resolve(request))
                .isInstanceOf(IllegalStateException.class);
    }
}
