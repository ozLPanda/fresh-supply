package kz.company.shop.orders.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import kz.company.shop.products.entity.MeasurementUnit;

@Entity
@org.hibernate.annotations.DynamicUpdate
@Table(name = "order_items")
public class OrderItem {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    public Order order;

    @Column(name = "product_id")
    public Long productId;

    /** Snapshot from the product, overridable when the order is released. */
    @Enumerated(EnumType.STRING)
    @Column(name = "measurement_unit", nullable = false)
    public MeasurementUnit measurementUnit = MeasurementUnit.PIECE;

    /** Snapshot of the catalogue availability condition at the time of ordering. */
    @Column(name = "made_to_order", nullable = false)
    public boolean madeToOrder = false;

    @Column(nullable = false)
    public String sku;

    @Column(name = "name_ru", nullable = false)
    public String nameRu;

    @Column(name = "unit_price", nullable = false, precision = 14, scale = 2)
    public BigDecimal unitPrice;

    @Column(name = "confirmed_unit_price", nullable = false, precision = 14, scale = 2)
    public BigDecimal confirmedUnitPrice;

    /** Internal cost snapshot used only for staff sales analytics. */
    @Column(name = "incoming_price", precision = 14, scale = 2)
    public BigDecimal incomingPrice;

    /** A null ledger cost means unknown FIFO cost, not permission to use today's card price. */
    @Column(name = "warehouse_cost_calculated", nullable = false)
    public boolean warehouseCostCalculated;

    @Column(nullable = false)
    public boolean wholesale = false;

    @Enumerated(EnumType.STRING)
    @Column(name = "price_tier", nullable = false)
    public PriceTier priceTier = PriceTier.RETAIL;

    @Column(nullable = false, precision = 6, scale = 3)
    public BigDecimal quantity;

    @Column(nullable = false)
    public boolean assembled = false;

    @Column(nullable = false)
    public boolean checked = false;

    @Column(name = "line_total", nullable = false, precision = 14, scale = 2)
    public BigDecimal lineTotal;

    /** Stable order shared by the order screen and its printed invoice. */
    @Column(name = "sort_order", nullable = false)
    public int sortOrder;

    @Column(name = "confirmed_line_total", nullable = false, precision = 14, scale = 2)
    public BigDecimal confirmedLineTotal;

    /**
     * Quantity released despite a verified warehouse shortage. Kept per line for the audit trail.
     */
    @Column(name = "stock_shortage_quantity", nullable = false, precision = 14, scale = 3)
    public BigDecimal stockShortageQuantity = BigDecimal.ZERO;

    @Column(name = "stock_shortage_released_by_user_id")
    public Long stockShortageReleasedByUserId;

    @Column(name = "stock_shortage_released_at")
    public Instant stockShortageReleasedAt;

    @Column(name = "stock_shortage_comment", length = 2000)
    public String stockShortageComment;
}
