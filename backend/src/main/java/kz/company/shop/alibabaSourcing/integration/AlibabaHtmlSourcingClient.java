package kz.company.shop.alibabaSourcing.integration;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Year;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Stateless HTML implementation of the Alibaba search port.
 *
 * <p>Alibaba can change its markup or return a challenge page at any time. Missing fields are
 * therefore represented as {@code null}; cards without the required product URL, title, or supplier
 * name are ignored. This client deliberately has no cookie jar and does not log request URLs,
 * headers, or response bodies.
 */
@Component
@ConditionalOnProperty(prefix = "app.alibaba-sourcing", name = "provider", havingValue = "html")
public class AlibabaHtmlSourcingClient implements AlibabaSourcingClient {
    private static final String DEFAULT_SEARCH_URL = "https://www.alibaba.com/trade/search";
    private static final String USER_AGENT =
            "Mozilla/5.0 (compatible; CompanyShopAlibabaSourcing/1.0; +https://example.invalid)";
    private static final String CARD_SELECTOR =
            "[data-testid*='search-card'], [data-testid*='product-card'], "
                    + ".organic-list-offer-outter, .J-offer-wrapper, "
                    + "div[class*='search-card'], div[class*='SearchCard'], "
                    + "div[class*='list-item'], div[class*='ListItem']";
    private static final String PRODUCT_TITLE_SELECTOR =
            "[data-testid*='title'], [class*='title'], [class*='Title'], h2, h3";
    private static final String SUPPLIER_SELECTOR =
            "[data-testid*='supplier'], [data-testid*='company'], "
                    + "[class*='supplier'], [class*='Supplier'], [class*='company'], "
                    + "[class*='Company']";
    private static final String PRICE_SELECTOR =
            "[data-testid*='price'], [class*='price'], [class*='Price']";
    private static final String MOQ_SELECTOR =
            "[data-testid*='moq'], [class*='moq'], [class*='MOQ'], "
                    + "[class*='minimum-order'], [class*='min-order']";
    private static final String COUNTRY_SELECTOR =
            "[data-testid*='country'], [class*='country'], [class*='Country'], "
                    + "[class*='location'], [class*='Location']";
    private static final String DESCRIPTION_SELECTOR =
            "[data-testid*='description'], [class*='description'], [class*='Description'], "
                    + "[class*='subtitle'], [class*='Subtitle']";
    private static final Pattern NUMBER_PATTERN =
            Pattern.compile(
                    "(?<![\\d.])(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(?![\\d.])");
    private static final Pattern MOQ_PATTERN =
            Pattern.compile(
                    "(?i)(?:min(?:imum)?\\.?\\s*order|moq)\\s*[:]?\\s*"
                            + "([\\d,.]+)\\s*(pcs?|pieces?|sets?|units?|pairs?|boxes?|cartons?|"
                            + "kilograms?|kgs?|tons?|bags?|meters?|rolls?)?"
                            + "|([\\d,.]+)\\s*(pcs?|pieces?|sets?|units?|pairs?|boxes?|cartons?|"
                            + "kilograms?|kgs?|tons?|bags?|meters?|rolls?)?\\s*(?:\\(?moq\\)?)");
    private static final Pattern YEARS_PATTERN =
            Pattern.compile("(?i)(\\d{1,3})\\s*(?:years?|yrs?)");
    private static final Pattern SINCE_YEAR_PATTERN =
            Pattern.compile("(?i)since\\s+(19\\d{2}|20\\d{2})");
    private static final Pattern RATING_PATTERN =
            Pattern.compile("(?i)([0-5](?:\\.\\d+)?)\\s*(?:/\\s*5|stars?|rating)");

    private final AlibabaSourcingProperties properties;
    private final DocumentFetcher documentFetcher;

    @Autowired
    public AlibabaHtmlSourcingClient(AlibabaSourcingProperties properties) {
        this(properties, new JsoupDocumentFetcher(properties));
    }

    AlibabaHtmlSourcingClient(
            AlibabaSourcingProperties properties, DocumentFetcher documentFetcher) {
        this.properties = properties;
        this.documentFetcher = documentFetcher;
    }

    @Override
    public AlibabaSourcingSearchResponse search(AlibabaSourcingSearchRequest request) {
        try {
            Document document = documentFetcher.fetch(buildSearchUrl(request.searchTerm()));
            if (isVerificationPage(document)) {
                throw new AlibabaSourcingIntegrationException(
                        AlibabaSourcingIntegrationException.INTEGRATION_UNAVAILABLE,
                        "Alibaba requested a verification page. Try the search again later.");
            }
            return new AlibabaSourcingSearchResponse(parseOffers(document, request.resultLimit()));
        } catch (AlibabaSourcingIntegrationException exception) {
            throw exception;
        } catch (IOException exception) {
            throw new AlibabaSourcingIntegrationException(
                    AlibabaSourcingIntegrationException.INTEGRATION_UNAVAILABLE,
                    "Alibaba HTML search could not be completed. Try again later.",
                    exception);
        } catch (RuntimeException exception) {
            throw new AlibabaSourcingIntegrationException(
                    AlibabaSourcingIntegrationException.INTEGRATION_UNAVAILABLE,
                    "Alibaba HTML search returned an unreadable response.",
                    exception);
        }
    }

    List<AlibabaSourcingOffer> parseOffers(Document document, int limit) {
        Set<Element> cards = new LinkedHashSet<>(document.select(CARD_SELECTOR));
        if (cards.isEmpty()) {
            for (Element productLink :
                    document.select("a[href*='product-detail'], a[href*='productgrouplist']")) {
                cards.add(productLink.closest("article, li, div"));
            }
        }

        List<AlibabaSourcingOffer> offers = new ArrayList<>();
        for (Element card : cards) {
            if (card == null) continue;
            toOffer(card)
                    .ifPresent(
                            offer -> {
                                if (offers.size() < limit) offers.add(offer);
                            });
            if (offers.size() == limit) break;
        }
        return offers;
    }

    private static boolean isVerificationPage(Document document) {
        String title = normalize(document.title());
        String body = normalize(document.body() == null ? null : document.body().text());
        String pageText = (title == null ? "" : title + " ") + (body == null ? "" : body);
        String normalized = pageText.toLowerCase(Locale.ROOT);
        return document.selectFirst(
                                "[id*='captcha' i], [class*='captcha' i], iframe[src*='captcha' i]")
                        != null
                || normalized.contains("verify you are human")
                || normalized.contains("security verification")
                || normalized.contains("captcha");
    }

    private java.util.Optional<AlibabaSourcingOffer> toOffer(Element card) {
        Element productLink = firstProductLink(card);
        Element titleElement = card.selectFirst(PRODUCT_TITLE_SELECTOR);
        String productUrl = absoluteUrl(productLink, "href");
        String productName = firstText(titleElement, productLink);
        Element supplierElement = card.selectFirst(SUPPLIER_SELECTOR);
        Element supplierLink = firstSupplierLink(card, supplierElement);
        String supplierName = firstText(supplierElement, supplierLink);

        if (isBlank(productUrl) || isBlank(productName) || isBlank(supplierName)) {
            return java.util.Optional.empty();
        }

        String priceText = selectedText(card, PRICE_SELECTOR);
        List<BigDecimal> prices = numbers(priceText, 2);
        String cardText = normalizedText(card);
        String moqText = selectedText(card, MOQ_SELECTOR);
        BigDecimal minimumOrderQuantity = parseMoq(isBlank(moqText) ? cardText : moqText);
        String minimumOrderUnit = parseMoqUnit(isBlank(moqText) ? cardText : moqText);
        String supplierText = cardText;

        return java.util.Optional.of(
                new AlibabaSourcingOffer(
                        productUrl,
                        productName,
                        prices.isEmpty() ? null : prices.getFirst(),
                        prices.size() < 2 ? null : prices.get(1),
                        currency(priceText),
                        minimumOrderQuantity,
                        minimumOrderUnit,
                        supplierName,
                        absoluteUrl(supplierLink, "href"),
                        selectedText(card, COUNTRY_SELECTOR),
                        companyAgeYears(supplierText),
                        verified(supplierText),
                        rating(supplierText),
                        selectedText(card, DESCRIPTION_SELECTOR),
                        imageUrl(card)));
    }

    private Element firstProductLink(Element card) {
        Element link = card.selectFirst("a[href*='product-detail'], a[href*='productgrouplist']");
        return link == null ? card.selectFirst("a[href]") : link;
    }

    private Element firstSupplierLink(Element card, Element supplierElement) {
        if (supplierElement != null) {
            Element nested = supplierElement.closest("a[href]");
            if (nested != null) return nested;
            nested = supplierElement.selectFirst("a[href]");
            if (nested != null) return nested;
        }
        return card.selectFirst(
                "a[href*='company_profile'], a[href*='companyprofile'], a[href*='supplier']");
    }

    private String buildSearchUrl(String searchTerm) {
        String baseUrl =
                isBlank(properties.getBaseUrl())
                        ? DEFAULT_SEARCH_URL
                        : properties.getBaseUrl().trim();
        String separator = baseUrl.contains("?") ? "&" : "?";
        return baseUrl
                + separator
                + "SearchText="
                + URLEncoder.encode(searchTerm, StandardCharsets.UTF_8);
    }

    private static String absoluteUrl(Element element, String attribute) {
        if (element == null) return null;
        String absolute = element.absUrl(attribute);
        return isBlank(absolute) ? null : absolute;
    }

    private static String firstText(Element... elements) {
        for (Element element : elements) {
            String text = normalizedText(element);
            if (!isBlank(text)) return text;
        }
        return null;
    }

    private static String selectedText(Element element, String selector) {
        return normalizedText(element == null ? null : element.selectFirst(selector));
    }

    private static List<BigDecimal> numbers(String text, int limit) {
        if (isBlank(text)) return List.of();
        List<BigDecimal> values = new ArrayList<>();
        Matcher matcher = NUMBER_PATTERN.matcher(text);
        while (matcher.find() && values.size() < limit) {
            try {
                values.add(new BigDecimal(matcher.group(1).replace(",", "")));
            } catch (NumberFormatException ignored) {
                // Skip malformed individual values while preserving the remaining card data.
            }
        }
        return values;
    }

    private static BigDecimal parseMoq(String text) {
        Matcher matcher = MOQ_PATTERN.matcher(text == null ? "" : text);
        if (!matcher.find()) return null;
        String value = firstNonBlank(matcher.group(1), matcher.group(3));
        try {
            return new BigDecimal(value.replace(",", ""));
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private static String parseMoqUnit(String text) {
        Matcher matcher = MOQ_PATTERN.matcher(text == null ? "" : text);
        if (!matcher.find()) return null;
        String unit = firstNonBlank(matcher.group(2), matcher.group(4));
        if (isBlank(unit)) return null;
        return unit.replaceAll("(?i)\\s*\\(?moq\\)?\\s*$", "").trim();
    }

    private static String currency(String priceText) {
        if (isBlank(priceText)) return null;
        String value = priceText.toUpperCase(Locale.ROOT);
        if (value.contains("US$") || value.contains("USD") || value.contains("$")) return "USD";
        if (value.contains("EUR") || value.contains("€")) return "EUR";
        if (value.contains("CNY") || value.contains("RMB") || value.contains("¥")) return "CNY";
        if (value.contains("GBP") || value.contains("£")) return "GBP";
        return null;
    }

    private static Integer companyAgeYears(String text) {
        if (isBlank(text)) return null;
        Matcher years = YEARS_PATTERN.matcher(text);
        if (years.find()) return Integer.valueOf(years.group(1));
        Matcher since = SINCE_YEAR_PATTERN.matcher(text);
        if (!since.find()) return null;
        int age = Year.now().getValue() - Integer.parseInt(since.group(1));
        return age >= 0 ? age : null;
    }

    private static Boolean verified(String text) {
        if (isBlank(text)) return null;
        String value = text.toLowerCase(Locale.ROOT);
        if (value.contains("not verified") || value.contains("unverified")) return false;
        return value.contains("verified supplier") || value.contains("verified")
                ? Boolean.TRUE
                : null;
    }

    private static BigDecimal rating(String text) {
        if (isBlank(text)) return null;
        Matcher matcher = RATING_PATTERN.matcher(text);
        if (!matcher.find()) return null;
        return new BigDecimal(matcher.group(1));
    }

    private static String imageUrl(Element card) {
        Element image = card.selectFirst("img[src], img[data-src]");
        if (image == null) return null;
        String url = absoluteUrl(image, "src");
        return isBlank(url) ? absoluteUrl(image, "data-src") : url;
    }

    private static String normalizedText(Element element) {
        return element == null ? null : normalize(element.text());
    }

    private static String firstNonBlank(String first, String second) {
        return isBlank(first) ? second : first;
    }

    private static String normalize(String value) {
        if (value == null) return null;
        String normalized = value.replaceAll("\\s+", " ").trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    @FunctionalInterface
    interface DocumentFetcher {
        Document fetch(String url) throws IOException;
    }

    private static final class JsoupDocumentFetcher implements DocumentFetcher {
        private final AlibabaSourcingProperties properties;

        private JsoupDocumentFetcher(AlibabaSourcingProperties properties) {
            this.properties = properties;
        }

        @Override
        public Document fetch(String url) throws IOException {
            int timeoutMillis =
                    Math.toIntExact(
                            Math.max(
                                    properties.getConnectTimeout().toMillis(),
                                    properties.getReadTimeout().toMillis()));
            return Jsoup.connect(url)
                    .userAgent(USER_AGENT)
                    .referrer("https://www.alibaba.com/")
                    .header("Accept-Language", "en-US,en;q=0.8")
                    // Jsoup applies this timeout to both socket connection and response reads.
                    .timeout(timeoutMillis)
                    .followRedirects(true)
                    .get();
        }
    }
}
