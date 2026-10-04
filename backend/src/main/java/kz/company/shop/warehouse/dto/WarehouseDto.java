package kz.company.shop.warehouse.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.warehouse.entity.StockDocumentStatus;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.entity.PriceSettingOperation;
import kz.company.shop.warehouse.entity.PriceSettingSourceType;

public final class WarehouseDto {
    private WarehouseDto() {}

    public record ProductPickerItem(Long id, String sku, String nameRu, boolean active) {}

    public record Counterparty(
            UUID id,
            String name,
            String contactName,
            String phone,
            String email,
            String comment,
            boolean archived,
            Instant createdAt,
            Instant updatedAt) {}

    public record CounterpartyRequest(
            @NotBlank String name,
            String contactName,
            String phone,
            String email,
            String comment,
            Boolean archived) {}

    /** A replacement supplier order must receive an explicitly chosen counterparty. */
    public record RemainingPurchaseOrderRequest(@NotNull UUID counterpartyId) {}

    public record Balance(
            Long productId,
            String sku,
            String productName,
            BigDecimal onHand,
            BigDecimal reserved,
            BigDecimal available,
            BigDecimal inventoryCost) {}

    public record ReservationOrder(
            UUID reservationId,
            UUID orderId,
            String orderCode,
            OrderStatus orderStatus,
            BigDecimal quantity,
            Instant reservedAt) {}

    public record ProductReservations(
            Long productId, String sku, String productName, List<ReservationOrder> orders) {}

    public record ProductMovement(
            UUID id,
            UUID documentId,
            String documentNumber,
            StockDocumentType documentType,
            StockDocumentStatus documentStatus,
            UUID sourceOrderId,
            String reference,
            String movementType,
            BigDecimal quantity,
            BigDecimal balanceAfter,
            Instant occurredAt) {}

    public record ProductMovements(
            Long productId, String sku, String productName, List<ProductMovement> movements) {}

    /** Posted receipts that form the clean incoming-price history for one product. */
    public record CleanIncomingPriceHistoryPoint(
            Instant occurredAt, BigDecimal unitCost, UUID documentId, String documentNumber) {}

    /** One product line released despite a verified shortage, kept separately from normal sales. */
    public record StockShortageRelease(
            Long orderItemId,
            Long productId,
            String sku,
            String productName,
            BigDecimal shortageQuantity,
            UUID orderId,
            String orderCode,
            OrderStatus orderStatus,
            Long releasedByUserId,
            String releasedByUserName,
            Instant releasedAt,
            String comment) {}

    public record DocumentLine(
            Long id,
            Long productId,
            String sku,
            String productName,
            BigDecimal quantity,
            BigDecimal unitCost,
            BigDecimal suggestedUnitCost,
            Long sourceOrderItemId,
            UUID sourceDocumentId,
            BigDecimal unitPrice,
            String comment,
            BigDecimal sourcePrice,
            String sourceDescription,
            PriceSettingOperation priceOperation,
            BigDecimal priceOperationValue,
            boolean manualPrice,
            String productGroupName) {}

    /** A non-persistent result of applying one price rule to a document line. */
    public record PriceSettingPreviewLine(
            Long productId,
            BigDecimal unitPrice,
            BigDecimal sourcePrice,
            String sourceDescription,
            PriceSettingOperation priceOperation,
            BigDecimal priceOperationValue) {}

    public record Document(
            UUID id,
            String documentNumber,
            StockDocumentType type,
            StockDocumentStatus status,
            StockDocumentPriceType priceType,
            Long warehouseId,
            UUID sourceOrderId,
            String reference,
            String comment,
            String priceRuleComment,
            LocalDate effectiveDate,
            LocalTime effectiveTime,
            Long createdByUserId,
            Instant createdAt,
            Instant postedAt,
            Instant cancelledAt,
            List<DocumentLine> lines,
            UUID priceSettingGroupId,
            String priceSettingGroupName,
            String priceSettingGroupRules,
            String priceSettingGroupComment,
            PriceSettingSourceType priceSourceType,
            StockDocumentPriceType priceSourcePriceType,
            UUID priceSourceDocumentId,
            PriceSettingOperation priceOperation,
            BigDecimal priceOperationValue,
            Instant deletedAt,
            UUID purchaseOrderId,
            List<PurchaseAllocation> purchaseAllocations,
            UUID counterpartyId,
            String counterpartyName) {}

    public record PurchaseAllocation(@NotNull UUID sourceDocumentId, @NotNull Long productId,
            @NotNull @DecimalMin("0.001") BigDecimal quantity) {}

    public record PurchaseOrderRemainder(DocumentSummary document, List<PurchaseOrderRemainderLine> lines) {}
    public record PurchaseOrderRemainderLine(Long productId, String sku, String productName,
            BigDecimal quantity, BigDecimal unitCost) {}

    public record PurchaseOrderProgress(boolean hasReceipts, List<DocumentSummary> receipts,
            List<PurchaseOrderProgressLine> lines) {}

    public record PurchaseOrderProgressLine(Long productId, String sku, String productName,
            BigDecimal ordered, BigDecimal received, BigDecimal remaining,
            BigDecimal transferred, BigDecimal available) {
        public PurchaseOrderProgressLine(Long productId, String sku, String productName,
                BigDecimal ordered, BigDecimal received, BigDecimal remaining) {
            this(productId, sku, productName, ordered, received, remaining, BigDecimal.ZERO, remaining);
        }
    }

    public record PriceSettingDocumentReference(
            UUID id,
            String documentNumber,
            StockDocumentPriceType priceType,
            Instant deletedAt) {}

    public record DocumentSummary(
            UUID id,
            String documentNumber,
            StockDocumentType type,
            StockDocumentStatus status,
            StockDocumentPriceType priceType,
            String reference,
            LocalDate effectiveDate,
            LocalTime effectiveTime,
            Instant createdAt,
            Instant postedAt,
            UUID priceSettingGroupId,
            PriceSettingSourceType priceSourceType,
            StockDocumentPriceType priceSourcePriceType,
            UUID priceSourceDocumentId,
            PriceSettingOperation priceOperation,
            BigDecimal priceOperationValue,
            UUID counterpartyId,
            String counterpartyName) {}

    public record DocumentVersionSnapshot(
            StockDocumentType type,
            StockDocumentStatus status,
            StockDocumentPriceType priceType,
            Long warehouseId,
            String reference,
            String comment,
            String priceRuleComment,
            LocalDate effectiveDate,
            LocalTime effectiveTime,
            List<DocumentLine> lines,
            UUID priceSettingGroupId,
            PriceSettingSourceType priceSourceType,
            StockDocumentPriceType priceSourcePriceType,
            UUID priceSourceDocumentId,
            PriceSettingOperation priceOperation,
            BigDecimal priceOperationValue,
            UUID counterpartyId,
            String counterpartyName) {}

    public record DocumentVersion(
            Long id,
            int versionNumber,
            String action,
            String changeSummary,
            Long changedByUserId,
            String changedByUserName,
            Instant createdAt,
            DocumentVersionSnapshot snapshot) {}

    public record DocumentLineRequest(
            @NotNull Long productId,
            @NotNull @DecimalMin(value = "0.00") BigDecimal quantity,
            @DecimalMin(value = "0.00") BigDecimal unitCost,
            Long sourceOrderItemId,
            UUID sourceDocumentId,
            @DecimalMin(value = "0.00") BigDecimal unitPrice,
            String comment,
            Boolean manualPrice,
            String productGroupName,
            @DecimalMin(value = "0.00") BigDecimal suggestedUnitCost) {
        /** Keeps server-side callers compiled while manual exceptions remain optional in JSON. */
        public DocumentLineRequest(
                Long productId,
                BigDecimal quantity,
                BigDecimal unitCost,
                Long sourceOrderItemId,
                UUID sourceDocumentId,
                BigDecimal unitPrice,
                String comment) {
            this(
                    productId,
                    quantity,
                    unitCost,
                    sourceOrderItemId,
                    sourceDocumentId,
                    unitPrice,
                    comment,
                    null,
                    null,
                    null);
        }

        /** Backward-compatible constructor for existing server-side callers. */
        public DocumentLineRequest(
                Long productId,
                BigDecimal quantity,
                BigDecimal unitCost,
                Long sourceOrderItemId,
                UUID sourceDocumentId,
                BigDecimal unitPrice,
                String comment,
                Boolean manualPrice,
                String productGroupName) {
            this(
                    productId,
                    quantity,
                    unitCost,
                    sourceOrderItemId,
                    sourceDocumentId,
                    unitPrice,
                    comment,
                    manualPrice,
                    productGroupName,
                    null);
        }
    }

    public record DocumentRequest(
            @NotNull StockDocumentType type,
            StockDocumentPriceType priceType,
            Long warehouseId,
            UUID sourceOrderId,
            String reference,
            String comment,
            LocalDate effectiveDate,
            LocalTime effectiveTime,
            @NotEmpty List<@Valid DocumentLineRequest> lines,
            UUID priceSettingGroupId,
            PriceSettingSourceType priceSourceType,
            StockDocumentPriceType priceSourcePriceType,
            UUID priceSourceDocumentId,
            PriceSettingOperation priceOperation,
            BigDecimal priceOperationValue,
            List<@Valid PurchaseAllocation> purchaseAllocations,
            UUID counterpartyId,
            UUID purchaseOrderId,
            String priceRuleComment) {
        /** Keeps existing server-side callers compatible while the document rule is optional. */
        public DocumentRequest(
                StockDocumentType type,
                StockDocumentPriceType priceType,
                Long warehouseId,
                UUID sourceOrderId,
                String reference,
                String comment,
                LocalDate effectiveDate,
                LocalTime effectiveTime,
                List<@Valid DocumentLineRequest> lines,
                UUID priceSettingGroupId,
                PriceSettingSourceType priceSourceType,
                StockDocumentPriceType priceSourcePriceType,
                UUID priceSourceDocumentId,
                PriceSettingOperation priceOperation,
                BigDecimal priceOperationValue,
                List<@Valid PurchaseAllocation> purchaseAllocations,
                UUID counterpartyId,
                UUID purchaseOrderId) {
            this(type, priceType, warehouseId, sourceOrderId, reference, comment, effectiveDate,
                    effectiveTime, lines, priceSettingGroupId, priceSourceType, priceSourcePriceType,
                    priceSourceDocumentId, priceOperation, priceOperationValue, purchaseAllocations,
                    counterpartyId, purchaseOrderId, null);
        }
        /** Backward-compatible form for callers that do not link a receipt to a supplier order. */
        public DocumentRequest(
                StockDocumentType type,
                StockDocumentPriceType priceType,
                Long warehouseId,
                UUID sourceOrderId,
                String reference,
                String comment,
                LocalDate effectiveDate,
                LocalTime effectiveTime,
                List<@Valid DocumentLineRequest> lines,
                UUID priceSettingGroupId,
                PriceSettingSourceType priceSourceType,
                StockDocumentPriceType priceSourcePriceType,
                UUID priceSourceDocumentId,
                PriceSettingOperation priceOperation,
                BigDecimal priceOperationValue,
                List<@Valid PurchaseAllocation> purchaseAllocations,
                UUID counterpartyId) {
            this(type, priceType, warehouseId, sourceOrderId, reference, comment, effectiveDate,
                    effectiveTime, lines, priceSettingGroupId, priceSourceType, priceSourcePriceType,
                    priceSourceDocumentId, priceOperation, priceOperationValue, purchaseAllocations,
                    counterpartyId, null, null);
        }
        public DocumentRequest(StockDocumentType type, StockDocumentPriceType priceType, Long warehouseId,
                UUID sourceOrderId, String reference, String comment, LocalDate effectiveDate,
                LocalTime effectiveTime, List<DocumentLineRequest> lines, UUID priceSettingGroupId,
                PriceSettingSourceType priceSourceType, StockDocumentPriceType priceSourcePriceType,
                UUID priceSourceDocumentId, PriceSettingOperation priceOperation, BigDecimal priceOperationValue) {
            this(type, priceType, warehouseId, sourceOrderId, reference, comment, effectiveDate,
                    effectiveTime, lines, priceSettingGroupId, priceSourceType, priceSourcePriceType,
                    priceSourceDocumentId, priceOperation, priceOperationValue, null, null, null);
        }
        /** Backward-compatible form for supplier-order remainder allocations. */
        public DocumentRequest(StockDocumentType type, StockDocumentPriceType priceType, Long warehouseId,
                UUID sourceOrderId, String reference, String comment, LocalDate effectiveDate,
                LocalTime effectiveTime, List<DocumentLineRequest> lines, UUID priceSettingGroupId,
                PriceSettingSourceType priceSourceType, StockDocumentPriceType priceSourcePriceType,
                UUID priceSourceDocumentId, PriceSettingOperation priceOperation, BigDecimal priceOperationValue,
                List<PurchaseAllocation> purchaseAllocations) {
            this(type, priceType, warehouseId, sourceOrderId, reference, comment, effectiveDate,
                    effectiveTime, lines, priceSettingGroupId, priceSourceType, priceSourcePriceType,
                    priceSourceDocumentId, priceOperation, priceOperationValue, purchaseAllocations, null,
                    null);
        }
        /** Existing callers may omit price-group metadata for ordinary warehouse documents. */
        public DocumentRequest(
                StockDocumentType type,
                StockDocumentPriceType priceType,
                Long warehouseId,
                UUID sourceOrderId,
                String reference,
                String comment,
                LocalDate effectiveDate,
                LocalTime effectiveTime,
                List<DocumentLineRequest> lines) {
            this(
                    type,
                    priceType,
                    warehouseId,
                    sourceOrderId,
                    reference,
                    comment,
                    effectiveDate,
                    effectiveTime,
                    lines,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null);
        }
    }

    public record AiPriceGroupSelection(UUID groupId, UUID sessionId) {}

    public record AiPriceGroupSelectionRequest(UUID groupId) {}

    public record PriceSettingGroupRequest(
            @NotNull @NotEmpty String name, String commonRules, String comment) {}

    public record PriceSettingGroup(
            UUID id,
            String name,
            String commonRules,
            String comment,
            Long createdByUserId,
            Instant createdAt,
            Instant updatedAt,
            List<DocumentSummary> documents) {}
}
