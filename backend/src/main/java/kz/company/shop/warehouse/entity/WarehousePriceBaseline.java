package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Price before the first warehouse price setting; survives cancellations and draft edits. */
@Entity
@Table(name = "warehouse_price_baselines", uniqueConstraints =
        @UniqueConstraint(columnNames = {"product_id", "price_type"}))
public class WarehousePriceBaseline {
    @Id public UUID id;
    @Column(name = "product_id", nullable = false) public Long productId;
    @Enumerated(EnumType.STRING)
    @Column(name = "price_type", nullable = false) public StockDocumentPriceType priceType;
    @Column(name = "baseline_price", precision = 14, scale = 2) public BigDecimal baselinePrice;
    @Column(name = "source_document_id") public UUID sourceDocumentId;
    @Column(name = "review_reason") public String reviewReason;
    @Column(name = "created_at", nullable = false) public Instant createdAt = Instant.now();
}
