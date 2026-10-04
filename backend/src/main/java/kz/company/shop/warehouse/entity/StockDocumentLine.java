package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "stock_document_lines")
public class StockDocumentLine {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "document_id", nullable = false)
    public java.util.UUID documentId;

    @Column(name = "product_id", nullable = false)
    public Long productId;

    @Column(nullable = false, precision = 14, scale = 3)
    public BigDecimal quantity;

    @Column(name = "unit_cost", precision = 18, scale = 6)
    public BigDecimal unitCost;

    /** System-proposed incoming cost, frozen for supplier-order analytics. */
    @Column(name = "suggested_unit_cost", precision = 14, scale = 2)
    public BigDecimal suggestedUnitCost;

    /** Source sale line for a customer return. Null for ordinary internal documents. */
    @Column(name = "source_order_item_id")
    public Long sourceOrderItemId;

    /** Posted receipt from which this price-setting line was populated. */
    @Column(name = "source_document_id")
    public java.util.UUID sourceDocumentId;

    /** Sale price copied from the source order. It is never supplied as an authoritative client value. */
    @Column(name = "unit_price", precision = 14, scale = 2)
    public BigDecimal unitPrice;

    /** Product-card price immediately before this price setting was posted. */
    @Column(name = "previous_unit_price", precision = 14, scale = 2)
    public BigDecimal previousUnitPrice;

    /** External card price displaced by this posting, distinct from the ledger predecessor. */
    @Column(name = "card_price_before_posting", precision = 14, scale = 2)
    public BigDecimal cardPriceBeforePosting;

    @Column(name = "restore_card_price_on_cancel", nullable = false)
    public boolean restoreCardPriceOnCancel;

    /** Frozen calculation base used by a price-setting line. */
    @Column(name = "source_price", precision = 14, scale = 2)
    public BigDecimal sourcePrice;

    @Column(name = "source_description", length = 500)
    public String sourceDescription;

    @Enumerated(EnumType.STRING)
    @Column(name = "price_operation")
    public PriceSettingOperation priceOperation;

    @Column(name = "price_operation_value", precision = 14, scale = 2)
    public BigDecimal priceOperationValue;

    @Column(name = "manual_price", nullable = false)
    public boolean manualPrice;

    @Column(length = 500)
    public String comment;

    /** Optional visual group of products inside a price-setting document. */
    @Column(name = "product_group_name", length = 160)
    public String productGroupName;
}
