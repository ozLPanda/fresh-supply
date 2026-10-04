package kz.company.shop.seo.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import kz.company.shop.categories.dto.CategoryDto;
import kz.company.shop.categories.service.CategoryService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.products.dto.ProductDto;
import kz.company.shop.products.dto.ProductListParams;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.seo.service.StorefrontTemplate;
import org.jsoup.Jsoup;
import org.jsoup.nodes.DataNode;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;
import org.springframework.web.util.UriUtils;

/** Identical initial HTML for visitors and crawlers; React takes over the root on load. */
@RestController
public class StorefrontHtmlController {
    private static final Logger log = LoggerFactory.getLogger(StorefrontHtmlController.class);
    private final ProductService products;
    private final CategoryService categories;
    private final StorefrontTemplate template;
    private final SeoOrigin origin;
    private final ObjectMapper mapper;

    @Value("${app.seo.google-site-verification:}")
    private String googleVerification = "";

    @Value("${app.seo.yandex-verification:}")
    private String yandexVerification = "";

    public StorefrontHtmlController(
            ProductService products,
            CategoryService categories,
            StorefrontTemplate template,
            SeoOrigin origin,
            ObjectMapper mapper) {
        this.products = products;
        this.categories = categories;
        this.template = template;
        this.origin = origin;
        this.mapper = mapper;
    }

    @GetMapping(
            value = {
                "/",
                "/catalog",
                "/categories",
                "/catalog/{slug}",
                "/product/{id}",
                "/catalog/",
                "/categories/",
                "/catalog/{slug}/",
                "/product/{id}/"
            },
            produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<String> page(HttpServletRequest request) {
        try {
            String path = request.getRequestURI();
            String base = origin.resolve(request);
            if (path.length() > 1 && path.endsWith("/")) {
                return ResponseEntity.status(301)
                        .header(
                                "Location",
                                base
                                        + path.substring(0, path.length() - 1)
                                        + (request.getQueryString() == null
                                                ? ""
                                                : "?" + request.getQueryString()))
                        .cacheControl(CacheControl.noStore())
                        .build();
            }
            Document doc = Jsoup.parse(template.get());
            Element root = doc.getElementById("root");
            if (root == null) throw new IllegalStateException("Missing storefront root");
            root.empty();
            Element nav = root.appendElement("nav").attr("aria-label", "Основная навигация");
            link(nav, "/", "GastroFlow");
            link(nav, "/catalog", "Каталог товаров");
            link(nav, "/categories", "Категории");
            Element main = root.appendElement("main");
            if (path.startsWith("/product/")) return product(doc, main, path, base);
            return catalog(doc, main, path, base, request);
        } catch (AppExceptions.NotFound e) {
            return error(404, "Страница не найдена", "Товар или категория недоступны.");
        } catch (RuntimeException e) {
            log.warn("Unable to render storefront HTML", e);
            return error(503, "Сайт временно недоступен", "Пожалуйста, повторите попытку позже.");
        }
    }

    private ResponseEntity<String> product(Document doc, Element main, String path, String base) {
        long id;
        try {
            id = Long.parseLong(path.substring("/product/".length()));
        } catch (NumberFormatException e) {
            throw new AppExceptions.NotFound("Товар не найден");
        }
        ProductDto product = products.getPublic(id);
        main.appendElement("h1").text(product.nameRu());
        main.appendElement("p").text("Артикул: " + product.sku());
        String description = plain(product.descriptionRu());
        if (description.isBlank()) description = plain(product.shortDescriptionRu());
        if (description.isBlank())
            description = product.nameRu() + " — цена и заказ в GastroFlow, Павлодар.";
        main.appendElement("p").text(description);
        main.appendElement("p").text(product.madeToOrder() ? "Под заказ" : "В наличии");
        if (product.price() != null)
            main.appendElement("p").text(product.price().toPlainString() + " ₸");
        var schema = new LinkedHashMap<String, Object>();
        schema.put("@context", "https://schema.org");
        schema.put("@type", "Product");
        schema.put("name", product.nameRu());
        schema.put("sku", product.sku());
        schema.put("description", description);
        schema.put("url", base + "/product/" + id);
        List<String> images = new ArrayList<>();
        if (product.images() != null)
            for (var image :
                    product.images().stream()
                            .sorted(
                                    java.util.Comparator.comparing(
                                                    (kz.company.shop.products.dto.ProductImageDto
                                                                    image) -> !image.mainImage())
                                            .thenComparingInt(
                                                    kz.company.shop.products.dto.ProductImageDto
                                                            ::sortOrder))
                            .toList()) {
                String url = publicImage(base, image.filePath());
                if (url == null) continue;
                images.add(url);
                main.appendElement("img").attr("src", url).attr("alt", product.nameRu());
            }
        if (!images.isEmpty()) schema.put("image", images);
        if (product.price() != null && product.price().signum() > 0)
            schema.put(
                    "offers",
                    Map.of(
                            "@type",
                            "Offer",
                            "url",
                            base + "/product/" + id,
                            "priceCurrency",
                            "KZT",
                            "price",
                            product.price(),
                            "availability",
                            product.madeToOrder()
                                    ? "https://schema.org/BackOrder"
                                    : "https://schema.org/InStock",
                            "itemCondition",
                            "https://schema.org/NewCondition"));
        List<Map<String, Object>> crumbs = new ArrayList<>();
        crumbs.add(crumb(1, "Главная", base + "/"));
        crumbs.add(crumb(2, "Каталог", base + "/catalog"));
        crumbs.add(crumb(3, product.nameRu(), base + "/product/" + id));
        metadata(
                doc,
                product.nameRu() + " — купить в GastroFlow",
                description,
                base + "/product/" + id,
                false,
                images.isEmpty() ? null : images.get(0),
                List.of(
                        schema,
                        Map.of(
                                "@context",
                                "https://schema.org",
                                "@type",
                                "BreadcrumbList",
                                "itemListElement",
                                crumbs)));
        return response(200, doc.outerHtml());
    }

    private ResponseEntity<String> catalog(
            Document doc, Element main, String path, String base, HttpServletRequest request) {
        List<CategoryDto> visible = new ArrayList<>();
        flatten(categories.tree(), visible);
        String slug =
                path.startsWith("/catalog/")
                        ? UriUtils.decode(path.substring(9), StandardCharsets.UTF_8)
                        : null;
        CategoryDto category =
                slug == null
                        ? null
                        : visible.stream()
                                .filter(c -> c.slug().equals(slug))
                                .findFirst()
                                .orElseThrow(
                                        () -> new AppExceptions.NotFound("Категория не найдена"));
        String title =
                category != null
                        ? category.nameRu()
                        : path.equals("/categories")
                                ? "Категории товаров"
                                : path.equals("/")
                                        ? "GastroFlow — паназиатские продукты"
                                        : "Каталог товаров";
        String description =
                category != null && category.descriptionRu() != null
                        ? plain(category.descriptionRu())
                        : "Овощи, фрукты, бакалея и паназиатские продукты. Цены, наличие и заказ онлайн в GastroFlow.";
        main.appendElement("h1").text(title);
        main.appendElement("p").text(description);
        Element categoryList = main.appendElement("ul");
        for (CategoryDto item : visible)
            link(categoryList.appendElement("li"), categoryPath(item.slug()), item.nameRu());
        int page = positiveInt(request.getParameter("page"), 1, Integer.MAX_VALUE);
        int size =
                path.equals("/")
                        ? 6
                        : slug != null ? 12 : positiveInt(request.getParameter("size"), 12, 200);
        String query = request.getParameter("query");
        String sortParam = slug != null ? "popular" : request.getParameter("sort");
        String sort =
                "price-asc".equals(sortParam) || "price-desc".equals(sortParam)
                        ? "price"
                        : "name".equals(sortParam)
                                ? "nameRu"
                                : "newest".equals(sortParam) ? "createdAt" : "popular";
        if (path.equals("/")) sort = null;
        String direction =
                "price-desc".equals(sortParam) || "newest".equals(sortParam) ? "desc" : "asc";
        if (!path.equals("/categories")) {
            var result =
                    products.list(
                            new ProductListParams(
                                    page,
                                    size,
                                    query,
                                    slug != null ? slug : request.getParameter("category"),
                                    slug == null ? decimal(request.getParameter("minPrice")) : null,
                                    slug == null ? decimal(request.getParameter("maxPrice")) : null,
                                    slug == null
                                                    && ("true"
                                                                    .equals(
                                                                            request.getParameter(
                                                                                    "inStock"))
                                                            || "1"
                                                                    .equals(
                                                                            request.getParameter(
                                                                                    "inStock")))
                                            ? true
                                            : null,
                                    true,
                                    sort,
                                    direction,
                                    false,
                                    false));
            if (page > Math.max(result.totalPages(), 1))
                throw new AppExceptions.NotFound("Страница каталога не найдена");
            Element list = main.appendElement("ul");
            for (ProductDto product : result.items()) {
                Element item = list.appendElement("li");
                link(item, "/product/" + product.id(), product.nameRu());
                if (product.price() != null)
                    item.appendElement("span").text(" — " + product.price().toPlainString() + " ₸");
            }
            Element pagination = main.appendElement("nav").attr("aria-label", "Страницы каталога");
            if (page > 1) link(pagination, pageUrl(request, path, page - 1), "Предыдущая страница");
            if (page < result.totalPages())
                link(pagination, pageUrl(request, path, page + 1), "Следующая страница");
        }
        boolean filtered = query != null && !query.isBlank();
        if (slug == null)
            for (String key :
                    List.of("category", "minPrice", "maxPrice", "inStock", "sort", "size"))
                filtered |= request.getParameter(key) != null;
        String canonical =
                base
                        + (category != null ? categoryPath(category.slug()) : path)
                        + (page > 1 ? "?page=" + page : "");
        metadata(
                doc,
                title,
                description,
                canonical,
                filtered,
                null,
                Map.of(
                        "@context",
                        "https://schema.org",
                        "@type",
                        "CollectionPage",
                        "name",
                        title,
                        "url",
                        canonical));
        return response(200, doc.outerHtml());
    }

    private void metadata(
            Document doc,
            String title,
            String description,
            String canonical,
            boolean noindex,
            String image,
            Object schema) {
        doc.title(title);
        doc.select(
                        "meta[name=description],meta[name=robots],meta[property^=og:],meta[name^=twitter:],link[rel=canonical],script[data-seo]")
                .remove();
        Element head = doc.head();
        if (!googleVerification.isBlank())
            head.appendElement("meta")
                    .attr("name", "google-site-verification")
                    .attr("content", googleVerification);
        if (!yandexVerification.isBlank())
            head.appendElement("meta")
                    .attr("name", "yandex-verification")
                    .attr("content", yandexVerification);
        head.appendElement("meta")
                .attr("name", "description")
                .attr(
                        "content",
                        description.length() > 300 ? description.substring(0, 300) : description);
        head.appendElement("meta")
                .attr("name", "robots")
                .attr("content", noindex ? "noindex,follow" : "index,follow");
        head.appendElement("link").attr("rel", "canonical").attr("href", canonical);
        for (var item :
                Map.of(
                                "og:title",
                                title,
                                "og:description",
                                description,
                                "og:url",
                                canonical,
                                "og:type",
                                canonical.contains("/product/") ? "product" : "website",
                                "og:site_name",
                                "GastroFlow",
                                "og:locale",
                                "ru_RU")
                        .entrySet())
            head.appendElement("meta")
                    .attr("property", item.getKey())
                    .attr("content", item.getValue());
        if (image != null)
            head.appendElement("meta").attr("property", "og:image").attr("content", image);
        try {
            head.appendElement("script")
                    .attr("type", "application/ld+json")
                    .attr("data-seo", "structured-data")
                    .appendChild(
                            new DataNode(
                                    mapper.writeValueAsString(schema).replace("<", "\\u003c")));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static void flatten(List<CategoryDto> source, List<CategoryDto> target) {
        for (CategoryDto category : source) {
            if (category.active()) target.add(category);
            if (category.children() != null) flatten(category.children(), target);
        }
    }

    private static String plain(String value) {
        return value == null ? "" : Jsoup.parse(value).text();
    }

    private static String categoryPath(String slug) {
        return "/catalog/" + UriUtils.encodePathSegment(slug, StandardCharsets.UTF_8);
    }

    private static void link(Element parent, String href, String text) {
        parent.appendElement("a").attr("href", href).text(text);
    }

    private static Map<String, Object> crumb(int position, String name, String url) {
        return Map.of("@type", "ListItem", "position", position, "name", name, "item", url);
    }

    private static int positiveInt(String value, int fallback, int max) {
        try {
            return Math.min(Math.max(Integer.parseInt(value), 1), max);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static BigDecimal decimal(String value) {
        try {
            return value == null || value.isBlank() ? null : new BigDecimal(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String publicImage(String base, String path) {
        if (path == null || path.isBlank()) return null;
        if (path.startsWith("/api/files/") || path.startsWith("/uploads/")) return base + path;
        if (path.matches("https?://.+")) return path;
        return null;
    }

    private static String pageUrl(HttpServletRequest request, String path, int page) {
        var builder = UriComponentsBuilder.fromPath(path);
        for (String key :
                List.of("query", "category", "minPrice", "maxPrice", "inStock", "sort", "size"))
            if (request.getParameter(key) != null)
                builder.queryParam(key, request.getParameter(key));
        if (page > 1) builder.queryParam("page", page);
        return builder.build().encode().toUriString();
    }

    private static ResponseEntity<String> response(int status, String html) {
        return ResponseEntity.status(status)
                .contentType(MediaType.parseMediaType("text/html;charset=UTF-8"))
                .cacheControl(CacheControl.noStore())
                .body(html);
    }

    private static ResponseEntity<String> error(int status, String title, String message) {
        Document doc =
                Jsoup.parse(
                        "<!doctype html><html lang=ru><head><meta charset=UTF-8><meta name=robots content=\"noindex,follow\"></head><body></body></html>");
        doc.title(title);
        doc.body().appendElement("h1").text(title);
        doc.body().appendElement("p").text(message);
        link(doc.body(), "/catalog", "Каталог товаров");
        return ResponseEntity.status(status)
                .contentType(MediaType.parseMediaType("text/html;charset=UTF-8"))
                .header("X-Robots-Tag", "noindex,follow")
                .cacheControl(CacheControl.noStore())
                .body(doc.outerHtml());
    }
}
