package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Audit of derived inventory deltas and FIFO costs; source posting data remains immutable. */
@Entity
@Table(name = "stock_ledger_revisions")
public class StockLedgerRevision {
    @Id public UUID id;
    @Column(name = "replay_id", nullable = false) public UUID replayId;
    @Column(name = "movement_id", nullable = false) public UUID movementId;
    @Column(name = "before_quantity", precision = 14, scale = 3) public BigDecimal beforeQuantity;
    @Column(name = "after_quantity", precision = 14, scale = 3) public BigDecimal afterQuantity;
    @Column(name = "before_unit_cost", precision = 18, scale = 6) public BigDecimal beforeUnitCost;
    @Column(name = "after_unit_cost", precision = 18, scale = 6) public BigDecimal afterUnitCost;
    @Column(name = "before_shortage", precision = 14, scale = 3) public BigDecimal beforeShortage;
    @Column(name = "after_shortage", precision = 14, scale = 3) public BigDecimal afterShortage;
    @Column(name = "created_at", nullable = false) public Instant createdAt = Instant.now();
}
