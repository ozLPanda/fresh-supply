package kz.company.shop.warehouse.ai;

import java.math.BigDecimal;
import java.util.List;

public final class InventoryAiDto {
    private InventoryAiDto() {}

    public record Row(
            Integer pageNumber,
            Integer sourceNumber,
            String sourceName,
            BigDecimal quantity,
            Long productId,
            String productName,
            String sku,
            String question,
            Long suggestedProductId,
            String suggestedProductName,
            String suggestedSku) {
        public Row(
                Integer pageNumber,
                Integer sourceNumber,
                String sourceName,
                BigDecimal quantity,
                Long productId,
                String productName,
                String sku,
                String question) {
            this(
                    pageNumber,
                    sourceNumber,
                    sourceName,
                    quantity,
                    productId,
                    productName,
                    sku,
                    question,
                    null,
                    null,
                    null);
        }
    }

    public record Result(String assistantMessage, List<Row> rows, List<String> questions) {}

    public record ClarifyRequest(List<Row> rows, String message) {}
}
