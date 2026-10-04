package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

@Entity
@Table(name = "stock_documents")
public class StockDocument {
    @Id public UUID id;

    @Column(name = "document_number", unique = true)
    public String documentNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "document_type", nullable = false)
    public StockDocumentType documentType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public StockDocumentStatus status = StockDocumentStatus.DRAFT;

    @Column(name = "warehouse_id", nullable = false)
    public Long warehouseId;

    @Column(name = "source_order_id")
    public UUID sourceOrderId;

    @Column(name = "counterparty_id")
    public UUID counterpartyId;

    @Column(name = "purchase_order_id")
    public UUID purchaseOrderId;

    @ElementCollection
    @CollectionTable(name = "purchase_order_allocations", joinColumns = @JoinColumn(name = "document_id"))
    @OrderColumn(name = "position")
    public java.util.List<PurchaseOrderAllocation> purchaseAllocations = new java.util.ArrayList<>();

    @Enumerated(EnumType.STRING)
    @Column(name = "price_type")
    public StockDocumentPriceType priceType;

    @Column(name = "price_setting_group_id")
    public UUID priceSettingGroupId;

    /** The group currently selected in the AI assistant, independent of document membership. */
    @Column(name = "ai_price_setting_group_id")
    public UUID aiPriceSettingGroupId;

    @Enumerated(EnumType.STRING)
    @Column(name = "price_source_type")
    public PriceSettingSourceType priceSourceType;

    @Enumerated(EnumType.STRING)
    @Column(name = "price_source_price_type")
    public StockDocumentPriceType priceSourcePriceType;

    @Column(name = "price_source_document_id")
    public UUID priceSourceDocumentId;

    @Enumerated(EnumType.STRING)
    @Column(name = "price_operation")
    public PriceSettingOperation priceOperation;

    @Column(name = "price_operation_value", precision = 14, scale = 2)
    public java.math.BigDecimal priceOperationValue;

    public String reference;

    @Column(columnDefinition = "text")
    public String comment;

    /**
     * Rich-text explanation of the price rule for this exact price-setting document.
     * Unlike the group rules, it is not shared with other documents in the group.
     */
    @Column(name = "price_rule_comment", columnDefinition = "text")
    public String priceRuleComment;

    @Column(name = "created_by_user_id")
    public Long createdByUserId;

    @Column(name = "posted_by_user_id")
    public Long postedByUserId;

    @Column(name = "cancelled_by_user_id")
    public Long cancelledByUserId;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @Column(name = "posted_at")
    public Instant postedAt;

    @Column(name = "cancelled_at")
    public Instant cancelledAt;

    /** Business date chosen for a manual document; it may differ from creation and posting time. */
    @Column(name = "effective_date")
    public LocalDate effectiveDate;

    /** Business time in Almaty for every manual document, independent of the posting audit time. */
    @Column(name = "effective_time")
    public LocalTime effectiveTime;

    @Column(name = "deleted_at")
    public Instant deletedAt;

    @Column(name = "deleted_by_user_id")
    public Long deletedByUserId;

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
