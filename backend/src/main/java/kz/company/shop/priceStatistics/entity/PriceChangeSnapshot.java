package kz.company.shop.priceStatistics.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "product_price_change_snapshots")
public class PriceChangeSnapshot {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false)
    public Long statisticsImportId;

    public Long productId;

    @Column(nullable = false)
    public String sku;

    @Column(nullable = false, length = 500)
    public String productName;

    public Long categoryId;

    public String categoryName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    public PriceType priceType;

    @Column(nullable = false, precision = 14, scale = 2)
    public BigDecimal oldPrice;

    @Column(nullable = false, precision = 14, scale = 2)
    public BigDecimal newPrice;

    @Column(nullable = false, precision = 14, scale = 6)
    public BigDecimal changePercent;
}
