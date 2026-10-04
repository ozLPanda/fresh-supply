package kz.company.shop.warehouse.ai;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;

public final class AiPriceDto {
    private AiPriceDto() {}
    public record StartRequest(UUID groupId, String message) {}
    public record MessageRequest(String message) {}
    public record RegenerateRequest(String message) {}
    public record EditRequest(List<EditRow> rows) {}
    public record EditRow(Long productId, Map<StockDocumentPriceType, BigDecimal> prices) {}
    public record Message(String role, String content) {}
    public record Price(BigDecimal oldPrice, BigDecimal newPrice, BigDecimal changePercent, String reason) {}
    public record Row(Long productId, String sku, String productName, BigDecimal quantity,
                      BigDecimal unitCost, Map<StockDocumentPriceType, Price> prices, boolean catalogOnly,
                      Map<StockDocumentPriceType, BigDecimal> referencePrices) {
        public Row(Long productId, String sku, String productName, BigDecimal quantity,
                   BigDecimal unitCost, Map<StockDocumentPriceType, Price> prices) {
            this(productId, sku, productName, quantity, unitCost, prices, false, null);
        }
        public Row(Long productId, String sku, String productName, BigDecimal quantity,
                   BigDecimal unitCost, Map<StockDocumentPriceType, Price> prices, boolean catalogOnly) {
            this(productId, sku, productName, quantity, unitCost, prices, catalogOnly, null);
        }
    }
    public record Session(UUID id, UUID receiptId, UUID groupId, String groupName, String status,
                          String assistantMessage, List<String> questions, List<Message> messages,
                          List<Row> rows, List<UUID> createdDocumentIds, boolean canRegenerate,
                          List<UUID> activeGeneratedDocumentIds) {}
}
