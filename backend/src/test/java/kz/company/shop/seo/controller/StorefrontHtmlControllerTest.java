package kz.company.shop.seo.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.categories.dto.CategoryDto;
import kz.company.shop.categories.service.CategoryService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.products.dto.ProductDto;
import kz.company.shop.products.dto.ProductImageDto;
import kz.company.shop.products.dto.ProductListParams;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.seo.service.StorefrontTemplate;
import org.jsoup.Jsoup;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;

class StorefrontHtmlControllerTest {
    private final ProductService products = mock(ProductService.class);
    private final CategoryService categories = mock(CategoryService.class);
    private final StorefrontTemplate template = mock(StorefrontTemplate.class);
    private final StorefrontHtmlController controller =
            new StorefrontHtmlController(
                    products,
                    categories,
                    template,
                    new SeoOrigin("https://shop.example"),
                    new ObjectMapper());

    private MockHttpServletRequest request(String path) {
        when(template.get())
                .thenReturn(
                        "<!doctype html><html><head><title>Old</title><meta name=description content=old></head><body><div id=\"root\"></div><script type=module src=/assets/app-hash.js></script></body></html>");
        return new MockHttpServletRequest("GET", path);
    }

    @Test
    void productContainsPublicContentStructuredDataAndRealAppAssets() throws Exception {
        var request = request("/product/7");
        String name = "Кран </script><script>alert(1)</script>";
        when(products.getPublic(7L))
                .thenReturn(
                        new ProductDto(
                                7L,
                                "SKU-7",
                                name,
                                name,
                                "Описание",
                                null,
                                "<p>Латунный кран</p>",
                                null,
                                new BigDecimal("1200.00"),
                                new BigDecimal("900"),
                                null,
                                null,
                                null,
                                null,
                                null,
                                true,
                                true,
                                null,
                                null,
                                List.of(
                                        new ProductImageDto(
                                                1L,
                                                "a.jpg",
                                                "a.jpg",
                                                "/uploads/a.jpg",
                                                null,
                                                0,
                                                true)),
                                null,
                                null,
                                new BigDecimal("600")));
        var response = controller.page(request);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        var doc = Jsoup.parse(response.getBody());
        assertThat(doc.selectFirst("h1").text()).isEqualTo(name);
        assertThat(doc.selectFirst("link[rel=canonical]").attr("href"))
                .isEqualTo("https://shop.example/product/7");
        assertThat(doc.select("script[src=/assets/app-hash.js]")).hasSize(1);
        assertThat(doc.select("script")).hasSize(2);
        var schema = new ObjectMapper().readTree(doc.selectFirst("script[data-seo]").data()).get(0);
        assertThat(schema.get("name").asText()).isEqualTo(name);
        assertThat(schema.get("offers").get("availability").asText()).endsWith("BackOrder");
        assertThat(schema.get("image").get(0).asText())
                .isEqualTo("https://shop.example/uploads/a.jpg");
        assertThat(response.getBody()).doesNotContain("wholesalePrice", "incomingPrice");
        verify(products).getPublic(7L);
    }

    @Test
    void hiddenProductIs404ButInfrastructureFailureIs503() {
        var request = request("/product/7");
        when(products.getPublic(7L)).thenThrow(new AppExceptions.NotFound("hidden"));
        var missing = controller.page(request);
        assertThat(missing.getStatusCode().value()).isEqualTo(404);
        assertThat(missing.getHeaders().getFirst("X-Robots-Tag")).isEqualTo("noindex,follow");
        doThrow(new IllegalStateException("database unavailable")).when(products).getPublic(7L);
        assertThat(controller.page(request).getStatusCode().value()).isEqualTo(503);
        when(template.get()).thenThrow(new IllegalStateException("frontend unavailable"));
        assertThat(controller.page(request).getStatusCode().value()).isEqualTo(503);
    }

    @Test
    void filtersAndPaginationUseAnonymousPublicPricesAndCrawlableLinks() {
        var request = request("/catalog");
        request.addParameter("page", "2");
        request.addParameter("category", "heating");
        request.addParameter("minPrice", "200");
        request.addParameter("sort", "price-desc");
        when(categories.tree()).thenReturn(List.of());
        when(products.list(any(ProductListParams.class)))
                .thenReturn(new PageResult<>(List.of(), 2, 12, 40, 4));
        var response = controller.page(request);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        var params = ArgumentCaptor.forClass(ProductListParams.class);
        verify(products).list(params.capture());
        assertThat(params.getValue().active()).isTrue();
        assertThat(params.getValue().includeInternalPrices()).isFalse();
        assertThat(params.getValue().category()).isEqualTo("heating");
        assertThat(params.getValue().minPrice()).isEqualByComparingTo("200");
        assertThat(params.getValue().direction()).isEqualTo("desc");
        var doc = Jsoup.parse(response.getBody());
        assertThat(doc.selectFirst("meta[name=robots]").attr("content"))
                .isEqualTo("noindex,follow");
        assertThat(doc.select("a[href*=page=3]")).hasSize(1);
        assertThat(doc.selectFirst("a[href*=page=3]").attr("href"))
                .contains("category=heating", "minPrice=200", "sort=price-desc");
    }

    @Test
    void activeChildOfInactiveParentStillHasWorkingPublicUrl() {
        var request = request("/catalog/child");
        CategoryDto child =
                new CategoryDto(
                        2L,
                        1L,
                        "Дочерняя",
                        "Дочерняя",
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        "child",
                        0,
                        true,
                        List.of());
        CategoryDto parent =
                new CategoryDto(
                        1L,
                        null,
                        "Родитель",
                        "Родитель",
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        "parent",
                        0,
                        false,
                        List.of(child));
        when(categories.tree()).thenReturn(List.of(parent));
        when(products.list(any(ProductListParams.class)))
                .thenReturn(new PageResult<>(List.of(), 1, 12, 0, 0));
        var response = controller.page(request);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        var document = Jsoup.parse(response.getBody());
        assertThat(document.selectFirst("h1").text()).isEqualTo("Дочерняя");
        assertThat(document.select("a[href=/catalog/parent]")).isEmpty();
    }
}
