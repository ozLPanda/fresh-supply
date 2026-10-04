package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "stock_movements")
public class StockMovement {
    @Id public UUID id;

    @Column(name = "warehouse_id", nullable = false)
    public Long warehouseId;

    @Column(name = "document_id", nullable = false)
    public UUID documentId;

    @Column(name = "product_id", nullable = false)
    public Long productId;

    @Column(nullable = false, precision = 14, scale = 3)
    public BigDecimal quantity;

    @Column(name = "unit_cost", precision = 18, scale = 6)
    public BigDecimal unitCost;

    /** Exact cancellation link; original posting records are retained for audit. */
    @Column(name = "reverses_movement_id")
    public UUID reversesMovementId;

    @Column(name = "source_line_id")
    public Long sourceLineId;

    /** Frozen user-entered inventory fact, independent of the calculated adjustment. */
    @Column(name = "inventory_quantity", precision = 14, scale = 3)
    public BigDecimal inventoryQuantity;

    @Column(name = "original_quantity", precision = 14, scale = 3)
    public BigDecimal originalQuantity;

    @Column(name = "original_unit_cost", precision = 18, scale = 6)
    public BigDecimal originalUnitCost;

    /** Previously accepted FIFO shortage; later unrelated operations cannot increase it. */
    @Column(name = "reconciled_shortage_quantity", nullable = false, precision = 14, scale = 3)
    public BigDecimal reconciledShortageQuantity = BigDecimal.ZERO;

    @Column(name = "allow_stock_shortage", nullable = false)
    public boolean allowStockShortage;

    @Column(name = "movement_type", nullable = false)
    public String movementType;

    @Column(name = "occurred_at", nullable = false)
    public Instant occurredAt = Instant.now();

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
