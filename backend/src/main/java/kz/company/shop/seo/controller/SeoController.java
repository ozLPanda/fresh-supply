package kz.company.shop.seo.controller;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.products.repository.ProductRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriUtils;

/** Public crawl directives and an up-to-date sitemap for the store catalogue. */
@RestController
public class SeoController {
    private static final CacheControl CACHE_CONTROL =
            CacheControl.maxAge(java.time.Duration.ofHours(1));

    static final int PAGE_SIZE = 5000;

    private final SeoOrigin seoOrigin;

    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;

    public SeoController(
            ProductRepository productRepository,
            CategoryRepository categoryRepository,
            SeoOrigin seoOrigin) {
        this.seoOrigin = seoOrigin;
        this.productRepository = productRepository;
        this.categoryRepository = categoryRepository;
    }

    @GetMapping(value = "/robots.txt", produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> robots(HttpServletRequest request) {
        String origin = seoOrigin.resolve(request);
        String body =
                "User-agent: *\n"
                        + "Allow: /\n"
                        + "Disallow: /admin/\n"
                        + "Disallow: /api/\n"
                        + "Allow: /api/products$\n"
                        + "Allow: /api/products?\n"
                        + "Allow: /api/products/category-counts\n"
                        + "Allow: /api/products/*/storefront\n"
                        + "Allow: /api/products/*/reviews\n"
                        + "Allow: /api/products/*/price-history\n"
                        + "Allow: /api/categories\n"
                        + "Allow: /api/settings/store\n"
                        + "Allow: /api/reviews/latest\n"
                        + "Allow: /api/reviews/summary\n\n"
                        + "Sitemap: "
                        + origin
                        + "/sitemap.xml\n";
        return ResponseEntity.ok().cacheControl(CACHE_CONTROL).body(body);
    }

    @GetMapping(value = "/sitemap.xml", produces = MediaType.APPLICATION_XML_VALUE)
    public ResponseEntity<String> sitemap(HttpServletRequest request) {
        String origin = seoOrigin.resolve(request);
        StringBuilder xml = xmlStart("sitemapindex");
        appendSitemap(xml, origin + "/sitemap-pages.xml");
        appendSitemapPages(
                xml,
                origin,
                "categories",
                categoryRepository.countByActiveTrueAndDeletedAtIsNull());
        appendSitemapPages(
                xml, origin, "products", productRepository.countByActiveTrueAndDeletedAtIsNull());
        return xmlResponse(xml, "sitemapindex");
    }

    @GetMapping(value = "/sitemap-pages.xml", produces = MediaType.APPLICATION_XML_VALUE)
    public ResponseEntity<String> pages(HttpServletRequest request) {
        String origin = seoOrigin.resolve(request);
        StringBuilder xml = xmlStart("urlset");
        appendUrl(xml, origin + "/", null, "weekly", "1.0");
        appendUrl(xml, origin + "/catalog", null, "daily", "0.9");
        appendUrl(xml, origin + "/categories", null, "weekly", "0.8");
        return xmlResponse(xml, "urlset");
    }

    @GetMapping(value = "/sitemap-products-{page}.xml", produces = MediaType.APPLICATION_XML_VALUE)
    public ResponseEntity<String> products(HttpServletRequest request, @PathVariable int page) {
        long count = productRepository.countByActiveTrueAndDeletedAtIsNull();
        if (!validPage(page, count)) return ResponseEntity.notFound().build();
        String origin = seoOrigin.resolve(request);
        StringBuilder xml = xmlStart("urlset");
        productRepository
                .findAll(publicEntries(), pageRequest(page))
                .forEach(
                        product ->
                                appendUrl(
                                        xml,
                                        origin + "/product/" + product.id,
                                        product.updatedAt,
                                        "weekly",
                                        "0.7"));
        return xmlResponse(xml, "urlset");
    }

    @GetMapping(
            value = "/sitemap-categories-{page}.xml",
            produces = MediaType.APPLICATION_XML_VALUE)
    public ResponseEntity<String> categories(HttpServletRequest request, @PathVariable int page) {
        long count = categoryRepository.countByActiveTrueAndDeletedAtIsNull();
        if (!validPage(page, count)) return ResponseEntity.notFound().build();
        String origin = seoOrigin.resolve(request);
        StringBuilder xml = xmlStart("urlset");
        categoryRepository
                .findAll(publicEntries(), pageRequest(page))
                .forEach(
                        category -> {
                            if (category.slug != null && !category.slug.isBlank()) {
                                appendUrl(
                                        xml,
                                        origin
                                                + "/catalog/"
                                                + UriUtils.encodePathSegment(
                                                        category.slug, StandardCharsets.UTF_8),
                                        category.updatedAt,
                                        "weekly",
                                        "0.8");
                            }
                        });
        return xmlResponse(xml, "urlset");
    }

    private static <T> Specification<T> publicEntries() {
        return (root, query, cb) ->
                cb.and(cb.isTrue(root.get("active")), cb.isNull(root.get("deletedAt")));
    }

    private PageRequest pageRequest(int page) {
        return PageRequest.of(page - 1, PAGE_SIZE, Sort.by("id").ascending());
    }

    private boolean validPage(int page, long count) {
        return page > 0 && page <= (count + PAGE_SIZE - 1) / PAGE_SIZE;
    }

    private void appendSitemapPages(StringBuilder xml, String origin, String kind, long count) {
        long pages = (count + PAGE_SIZE - 1) / PAGE_SIZE;
        for (long page = 1; page <= pages; page++) {
            appendSitemap(xml, origin + "/sitemap-" + kind + "-" + page + ".xml");
        }
    }

    private void appendSitemap(StringBuilder xml, String location) {
        xml.append("  <sitemap><loc>").append(escapeXml(location)).append("</loc></sitemap>\n");
    }

    private StringBuilder xmlStart(String root) {
        return new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
                .append("<")
                .append(root)
                .append(" xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");
    }

    private ResponseEntity<String> xmlResponse(StringBuilder xml, String root) {
        xml.append("</").append(root).append(">\n");
        return ResponseEntity.ok().cacheControl(CACHE_CONTROL).body(xml.toString());
    }

    private void appendUrl(
            StringBuilder xml,
            String location,
            Instant updatedAt,
            String changeFrequency,
            String priority) {
        xml.append("  <url><loc>").append(escapeXml(location)).append("</loc>");
        if (updatedAt != null) {
            xml.append("<lastmod>")
                    .append(DateTimeFormatter.ISO_INSTANT.format(updatedAt))
                    .append("</lastmod>");
        }
        xml.append("<changefreq>").append(changeFrequency).append("</changefreq>");
        xml.append("<priority>").append(priority).append("</priority>");
        xml.append("</url>\n");
    }

    private String escapeXml(String value) {
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }
}
