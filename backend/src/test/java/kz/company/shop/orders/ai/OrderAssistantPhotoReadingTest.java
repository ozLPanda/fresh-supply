package kz.company.shop.orders.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class OrderAssistantPhotoReadingTest {
    final ObjectMapper json = new ObjectMapper();

    @Test
    void compoundQuantityAlwaysRequiresConfirmationEvenWhenBothReadingsAgree() throws Exception {
        for (String raw : new String[] {"2 кг + 1 кг", "2 кг 1 кг", "2кг +", "3 кг / кг"}) {
            var line =
                    json.createObjectNode()
                            .put("rawQuantity", raw)
                            .put("quantity", 3)
                            .put("unit", "KG");
            assertThat(OrderAssistantPhotoReading.discrepancy(line, new BigDecimal("3"), "KG"))
                    .contains("Подтвердите итоговое");
        }
        var acrossCells =
                json.createObjectNode()
                        .put("rawName", "Апельсин 2 шт +")
                        .put("rawQuantity", "1 кг")
                        .put("quantity", 3)
                        .put("unit", "KG");
        assertThat(OrderAssistantPhotoReading.discrepancy(acrossCells, new BigDecimal("3"), "KG"))
                .contains("Подтвердите итоговое");
        var decimal =
                json.createObjectNode()
                        .put("rawName", "Укроп")
                        .put("rawQuantity", "0,500 кг")
                        .put("quantity", 0.5)
                        .put("unit", "KG");
        assertThat(OrderAssistantPhotoReading.discrepancy(decimal, new BigDecimal("0.5"), "KG"))
                .isNull();
    }

    @Test
    void quantityAndUnitDisagreementIsBlockingAndGramsConvertExactly() throws Exception {
        var pieces = json.readTree("{\"quantity\":2,\"unit\":\"PIECE\",\"rawQuantity\":\"2 шт\"}");
        assertThat(OrderAssistantPhotoReading.discrepancy(pieces, new BigDecimal("2"), "KG"))
                .contains("расходятся");
        var grams =
                json.readTree("{\"quantity\":300,\"unit\":\"GRAM\",\"rawQuantity\":\"300 гр\"}");
        assertThat(OrderAssistantPhotoReading.discrepancy(grams, new BigDecimal("0.3"), "KG"))
                .isNull();
        assertThat(OrderAssistantPhotoReading.discrepancy(grams, new BigDecimal("300"), "KG"))
                .contains("расходятся");
    }

    @Test
    void ambiguityCannotBeSilentlyClearedByCatalogMatching() throws Exception {
        var unclear =
                json.readTree(
                        "{\"uncertainty\":\"2 шт + 1 кг: подтвердите\",\"quantity\":null,\"unit\":\"UNKNOWN\"}");
        assertThat(OrderAssistantPhotoReading.discrepancy(unclear, null, null))
                .contains("2 шт + 1 кг");
    }
}
