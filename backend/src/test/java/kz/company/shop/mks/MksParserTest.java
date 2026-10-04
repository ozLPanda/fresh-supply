package kz.company.shop.mks;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;

class MksParserTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final MksParser parser = new MksParser();

    @Test
    void parsesSyntheticGroupedProductsAndNativeRangeFilters() throws Exception {
        // Synthetic fixture, not a captured/verified authenticated MKS response.
        var init =
                mapper.readTree(
                        """
                {"catalog_tree":[{"id":4,"header":"Инструмент"}]}
                """);
        var response =
                mapper.readTree(
                        """
                {"products":{"tools":{"21":{"id":21,"articul":"ART-21","header":"Дрель",
                  "model":"X21","brand":"Fixture","price":"1 234,50"}}},
                 "brands":{"data":{"5":"Fixture"}},"params":{"maxmin":{"power":{"minp":1,"maxp":20,"header":"Мощность"}}}}
                """);
        var result = parser.parse(init, response, new MksDto.SearchRequest("", 1, 20, Map.of()));
        assertThat(result.items()).hasSize(1);
        assertThat(result.items().getFirst().sku()).isEqualTo("ART-21");
        assertThat(result.items().getFirst().price()).isEqualByComparingTo("1234.50");
        assertThat(result.items().getFirst().availability()).isNull();
        assertThat(result.filters())
                .extracting(MksDto.Filter::id)
                .contains("catalog", "brand", "search_range.power.from", "search_range.power.to");
        assertThat(result.totalItems()).isNull();
        assertThat(result.hasMore()).isFalse();
        assertThat(result.warnings()).isNotEmpty();
    }

    @Test
    void neverConvertsUnknownOrMissingProductsIntoSuccessfulEmptyResults() throws Exception {
        var init = mapper.readTree("{\"catalog_tree\":[]}");
        for (String fixture :
                new String[] {
                    "{}",
                    "{\"products\":[{\"id\":1,\"unexpected_name\":\"x\"}]}",
                    "{\"products\":{\"unexpected\":{}}}"
                }) {
            var response = mapper.readTree(fixture);
            assertThatThrownBy(
                            () ->
                                    parser.parse(
                                            init,
                                            response,
                                            new MksDto.SearchRequest("", 1, 20, Map.of())))
                    .isInstanceOf(MksTransport.Failure.class)
                    .hasMessageContaining("Формат каталога");
        }
    }

    @Test
    void acceptsExplicitEmptyCatalogAndRejectsInvalidInit() throws Exception {
        var init = mapper.readTree("{\"catalog_tree\":[]}");
        assertThat(
                        parser.parse(
                                        init,
                                        mapper.readTree("{\"products\":[]}"),
                                        new MksDto.SearchRequest("", 1, 20, Map.of()))
                                .items())
                .isEmpty();
        assertThatThrownBy(() -> parser.validateInit(mapper.createObjectNode()))
                .isInstanceOf(MksTransport.Failure.class);
    }

    @Test
    void readsAuthenticatedEnvelopeCountsAndSupplierAvailabilityWithoutExposingPrivateFields()
            throws Exception {
        // Synthetic values using the field structure verified in the authenticated catalog.
        var init =
                mapper.readTree(
                        """
            {"catalog_tree":[{"id":"66","header":"Дрели"}],
             "contragents":{"example":{"login":"private-fixture","phone":"private-fixture"}}}
            """);
        var response =
                mapper.readTree(
                        """
            {"products":{"data":[{"id":"1","articul":"A-1","header":"Тестовый товар",
             "price":"125.50","remains":"5","picture":"123","picturetype":"jpg","url":"item_1.html"}],
             "count":83,"pagination":{"page":"2","total":83,"perpage":10,"chunks":9,"next":3,"prev":1}},
             "params":{"params_vars":[{"id":"diameter","header":"Диаметр"}],
              "params_vals":{"diameter":{"10":"10 мм","20":"20 мм"}},
              "simple_params":[{"id":"power","header":"Мощность"}],
              "maxmin":{"power":{"minp":10,"maxp":100}}}}
            """);
        var result = parser.parse(init, response, new MksDto.SearchRequest("", 2, 10, Map.of()));
        assertThat(result.totalItems()).isEqualTo(83);
        assertThat(result.totalPages()).isEqualTo(9);
        assertThat(result.hasMore()).isTrue();
        assertThat(result.items().getFirst().availability()).isEqualTo("В наличии: 5");
        assertThat(result.items().getFirst().imageUrl())
                .isEqualTo("https://mkskz.master.pro/dbpics/123-50.jpg");
        assertThat(result.items().getFirst().productUrl())
                .isNull();
        assertThat(result.filters())
                .extracting(MksDto.Filter::id)
                .contains("filter.diameter", "search_range.power.from", "search_range.power.to");
        assertThat(mapper.writeValueAsString(result))
                .doesNotContain("private-fixture", "contragents");
    }

    @Test
    void respectsExplicitLastPageAndEmptyEnvelope() throws Exception {
        var init = mapper.readTree("{\"catalog_tree\":[]}");
        var response =
                mapper.readTree(
                        """
            {"products":{"data":[],"count":0,"pagination":{"total":0,"next":false}}}
            """);
        var result = parser.parse(init, response, new MksDto.SearchRequest("", 1, 10, Map.of()));
        assertThat(result.items()).isEmpty();
        assertThat(result.totalItems()).isZero();
        assertThat(result.hasMore()).isFalse();
    }

    @Test
    void ignoresSupplierZeroCountWhenProductsExistAndKeepsNextPageAvailable() throws Exception {
        var init = mapper.readTree("{\"catalog_tree\":[]}");
        var response = mapper.createObjectNode();
        var products = response.putObject("products");
        products.put("count", 0);
        products.putObject("pagination").put("total", 0).put("next", false);
        var rows = products.putArray("data");
        for (int index = 0; index < 10; index++) {
            rows.addObject().put("id", index + 1).put("header", "Fixture " + index);
        }
        var result = parser.parse(init, response, new MksDto.SearchRequest("", 1, 10, Map.of()));
        assertThat(result.totalItems()).isNull();
        assertThat(result.totalPages()).isNull();
        assertThat(result.hasMore()).isTrue();
        assertThat(result.warnings()).anyMatch(value -> value.contains("неточное"));
    }

    @Test
    void parsesModalProductDetailsUsingSupplierIdAndOnlyCatalogFields() throws Exception {
        var node = mapper.readTree("""
                {"id":"21","articul":"A-21","header":"Аккумулятор","brand":"Бренд",
                 "price":"15214.84","price_rrc":"23620.00","price_mrc":"23620.00",
                 "barcode":"4600000000000","batch":"Профессионал","min_count":"1",
                 "inner_count":"5","outer_count":"20","picture":"123","picturetype":"jpg",
                 "url":"broken_product.html","remains":"10",
                 "images":[{"image_id":"123","type":"jpg"},{"image_id":"124","type":"png"},
                           {"image_id":"../private","type":"html"}],
                 "params":{"1":{"header":"Напряжение, В","value":"12"},
                           "2":{"header":"Емкость","value":"4.0"}},
                 "descript":"<p>Описание &amp; детали</p><script>private-script</script><p>Продолжение</p>",
                 "advantages":"<ul><li>Первое</li><li>Второе</li></ul>",
                 "wish":"private-fixture","contracts":{"secret":"private-fixture"}}
                """);
        var details = parser.parseProduct(node, "21");
        assertThat(details.product().sku()).isEqualTo("A-21");
        assertThat(details.product().productUrl()).isNull();
        assertThat(details.images()).containsExactly(
                "https://mkskz.master.pro/dbpics/123.jpg",
                "https://mkskz.master.pro/dbpics/124.png");
        assertThat(details.retailPrice()).isEqualByComparingTo("23620.00");
        assertThat(details.barcode()).isEqualTo("4600000000000");
        assertThat(details.characteristics()).containsExactly(
                new MksDto.Characteristic("Напряжение, В", "12"),
                new MksDto.Characteristic("Емкость", "4.0"));
        assertThat(details.description()).isEqualTo("Описание & детали\nПродолжение");
        assertThat(details.advantages()).isEqualTo("Первое\nВторое");
        assertThat(mapper.writeValueAsString(details))
                .doesNotContain("private-fixture", "private-script", "broken_product.html");
        assertThatThrownBy(() -> parser.parseProduct(node, "22"))
                .isInstanceOf(MksTransport.Failure.class);
        assertThatThrownBy(() -> parser.parseProduct(mapper.createObjectNode(), "21"))
                .isInstanceOf(MksTransport.Failure.class);
    }
}
