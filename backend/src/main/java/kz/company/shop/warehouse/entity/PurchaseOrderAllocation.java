package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.UUID;

/** Quantity of a source order carried forward into this order. */
@Embeddable
public class PurchaseOrderAllocation {
    @Column(name = "source_document_id", nullable = false)
    public UUID sourceDocumentId;
    @Column(name = "product_id", nullable = false)
    public Long productId;
    @Column(nullable = false, precision = 14, scale = 3)
    public BigDecimal quantity;

    public PurchaseOrderAllocation() {}

    public PurchaseOrderAllocation(UUID sourceDocumentId, Long productId, BigDecimal quantity) {
        this.sourceDocumentId = sourceDocumentId;
        this.productId = productId;
        this.quantity = quantity;
    }
}
