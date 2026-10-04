package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "stock_cost_layers")
public class StockCostLayer {
    @Id public UUID id;

    @Column(name = "warehouse_id", nullable = false)
    public Long warehouseId;

    @Column(name = "product_id", nullable = false)
    public Long productId;

    @Column(name = "source_document_id", nullable = false)
    public UUID sourceDocumentId;

    @Column(name = "source_movement_id")
    public UUID sourceMovementId;

    @Column(name = "original_quantity", nullable = false, precision = 14, scale = 3)
    public BigDecimal originalQuantity;

    @Column(name = "remaining_quantity", nullable = false, precision = 14, scale = 3)
    public BigDecimal remainingQuantity;

    @Column(name = "unit_cost", precision = 18, scale = 6)
    public BigDecimal unitCost;

    @Column(name = "received_at", nullable = false)
    public Instant receivedAt = Instant.now();

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
