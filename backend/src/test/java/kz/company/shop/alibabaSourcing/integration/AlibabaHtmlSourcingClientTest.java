package kz.company.shop.alibabaSourcing.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.junit.jupiter.api.Test;

class AlibabaHtmlSourcingClientTest {
    @Test
    void parsesSearchCardsAndKeepsOnlyCompleteOffers() throws Exception {
        Document document =
                Jsoup.parse(
                        new String(
                                getClass()
                                        .getResourceAsStream(
                                                "/alibaba-sourcing/search-results.html")
                                        .readAllBytes(),
                                StandardCharsets.UTF_8),
                        "https://www.alibaba.com/trade/search");
        AlibabaSourcingProperties properties = new AlibabaSourcingProperties();
        AlibabaHtmlSourcingClient client =
                new AlibabaHtmlSourcingClient(properties, ignored -> document);

        AlibabaSourcingSearchResponse response =
                client.search(new AlibabaSourcingSearchRequest("solar pump", null, null, 10));

        assertThat(response.offers()).hasSize(2);
        AlibabaSourcingOffer first = response.offers().getFirst();
        assertThat(first.productName()).isEqualTo("Solar water pump");
        assertThat(first.sourceProductUrl())
                .isEqualTo("https://www.alibaba.com/product-detail/solar-pump_1001.html");
        assertThat(first.priceFrom()).isEqualByComparingTo("1.20");
        assertThat(first.priceTo()).isEqualByComparingTo("2.50");
        assertThat(first.currency()).isEqualTo("USD");
        assertThat(first.minimumOrderQuantity()).isEqualByComparingTo("100");
        assertThat(first.minimumOrderUnit()).isEqualTo("Pieces");
        assertThat(first.supplierName()).isEqualTo("Acme Manufacturing");
        assertThat(first.supplierUrl())
                .isEqualTo("https://www.alibaba.com/company_profile/acme.html");
        assertThat(first.supplierCountry()).isEqualTo("China");
        assertThat(first.supplierCompanyAgeYears()).isEqualTo(8);
        assertThat(first.supplierVerified()).isTrue();
        assertThat(first.supplierRating()).isEqualByComparingTo("4.8");
        assertThat(first.description()).isEqualTo("Stainless steel solar pump");

        AlibabaSourcingOffer second = response.offers().get(1);
        assertThat(second.currency()).isEqualTo("EUR");
        assertThat(second.minimumOrderQuantity()).isEqualByComparingTo("20");
        assertThat(second.minimumOrderUnit()).isEqualTo("Sets");
        assertThat(second.supplierCompanyAgeYears()).isGreaterThanOrEqualTo(10);
        assertThat(second.supplierVerified()).isNull();
    }

    @Test
    void usesEncodedSearchTextAndHonoursRequestedLimit() {
        AlibabaSourcingProperties properties = new AlibabaSourcingProperties();
        properties.setBaseUrl("https://www.alibaba.com/trade/search?foo=bar");
        String[] requestedUrl = new String[1];
        Document document =
                Jsoup.parse(
                        "<div data-testid='search-card'>"
                                + "<a class='product-title' href='/product-detail/a'>Pump</a>"
                                + "<a class='supplier' href='/company_profile/a'>Factory</a>"
                                + "</div>",
                        "https://www.alibaba.com/");
        AlibabaHtmlSourcingClient client =
                new AlibabaHtmlSourcingClient(
                        properties,
                        url -> {
                            requestedUrl[0] = url;
                            return document;
                        });

        AlibabaSourcingSearchResponse response =
                client.search(
                        new AlibabaSourcingSearchRequest("water pump & valve", null, null, 1));

        assertThat(requestedUrl[0])
                .isEqualTo(
                        "https://www.alibaba.com/trade/search?foo=bar&SearchText=water+pump+%26+valve");
        assertThat(response.offers()).hasSize(1);
    }

    @Test
    void convertsTransportErrorsToControlledIntegrationFailure() {
        AlibabaHtmlSourcingClient client =
                new AlibabaHtmlSourcingClient(
                        new AlibabaSourcingProperties(),
                        ignored -> {
                            throw new java.io.IOException("network unavailable");
                        });

        assertThatThrownBy(
                        () ->
                                client.search(
                                        new AlibabaSourcingSearchRequest(
                                                "pump", BigDecimal.ONE, 1, 1)))
                .isInstanceOfSatisfying(
                        AlibabaSourcingIntegrationException.class,
                        exception ->
                                assertThat(exception.getMessage())
                                        .isEqualTo(
                                                "Alibaba HTML search could not be completed. Try again later."));
    }

    @Test
    void reportsAlibabaVerificationPageInsteadOfEmptySearchResult() {
        Document document =
                Jsoup.parse(
                        "<html><head><title>Security verification</title></head>"
                                + "<body><div class='captcha'>Verify you are human</div></body></html>",
                        "https://www.alibaba.com/trade/search");
        AlibabaHtmlSourcingClient client =
                new AlibabaHtmlSourcingClient(new AlibabaSourcingProperties(), ignored -> document);

        assertThatThrownBy(
                        () ->
                                client.search(
                                        new AlibabaSourcingSearchRequest("pump", null, null, 10)))
                .isInstanceOfSatisfying(
                        AlibabaSourcingIntegrationException.class,
                        exception ->
                                assertThat(exception.getMessage())
                                        .isEqualTo(
                                                "Alibaba requested a verification page. Try the search again later."));
    }
}
