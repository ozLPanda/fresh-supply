package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "stock_reservations")
public class StockReservation {
    @Id public UUID id;

    @Column(name = "warehouse_id", nullable = false)
    public Long warehouseId;

    @Column(name = "order_id", nullable = false)
    public UUID orderId;

    @Column(name = "product_id", nullable = false)
    public Long productId;

    @Column(nullable = false, precision = 14, scale = 3)
    public BigDecimal quantity;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public StockReservationStatus status = StockReservationStatus.ACTIVE;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "released_at")
    public Instant releasedAt;
}
