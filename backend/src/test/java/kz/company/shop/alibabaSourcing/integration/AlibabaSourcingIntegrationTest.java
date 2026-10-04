package kz.company.shop.alibabaSourcing.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

class AlibabaSourcingIntegrationTest {
    @Test
    void normalizesAnOfferFromAnOfficialClient() {
        AlibabaSourcingOffer offer =
                new AlibabaSourcingOffer(
                        " https://example.alibaba.com/product/1 ",
                        "  Water pump  ",
                        new BigDecimal("12.50"),
                        new BigDecimal("20.00"),
                        " USD ",
                        new BigDecimal("100"),
                        " pieces ",
                        "  Factory Ltd  ",
                        " https://example.alibaba.com/supplier/1 ",
                        " China ",
                        8,
                        true,
                        new BigDecimal("4.8"),
                        "  Supplier description ",
                        " https://example.com/pump.jpg ");

        AlibabaSourcingSearchResponse response = new AlibabaSourcingSearchResponse(List.of(offer));

        assertThat(offer.productName()).isEqualTo("Water pump");
        assertThat(offer.currency()).isEqualTo("USD");
        assertThat(offer.supplierName()).isEqualTo("Factory Ltd");
        assertThat(offer.supplierUrl()).isEqualTo("https://example.alibaba.com/supplier/1");
        assertThat(response.offers()).containsExactly(offer);
    }

    @Test
    void rejectsInvalidSearchCriteriaAndOfferPriceRange() {
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new AlibabaSourcingSearchRequest(" ", null, null, 10));
        assertThatIllegalArgumentException()
                .isThrownBy(() -> new AlibabaSourcingSearchRequest("pump", null, null, 11));
        assertThatIllegalArgumentException()
                .isThrownBy(
                        () ->
                                new AlibabaSourcingOffer(
                                        "https://example.com/product",
                                        "Pump",
                                        new BigDecimal("20"),
                                        new BigDecimal("10"),
                                        "USD",
                                        null,
                                        null,
                                        "Factory",
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null,
                                        null));
    }

    @Test
    void defaultClientFailsWithoutMakingAnExternalRequest() {
        UnavailableAlibabaSourcingClient client = new UnavailableAlibabaSourcingClient();

        assertThatThrownBy(
                        () ->
                                client.search(
                                        new AlibabaSourcingSearchRequest(
                                                "water pump", new BigDecimal("100"), 5, 10)))
                .isInstanceOfSatisfying(
                        AlibabaSourcingIntegrationException.class,
                        error ->
                                assertThat(error.getErrorCode())
                                        .isEqualTo(
                                                AlibabaSourcingIntegrationException
                                                        .INTEGRATION_UNAVAILABLE));
    }
}
