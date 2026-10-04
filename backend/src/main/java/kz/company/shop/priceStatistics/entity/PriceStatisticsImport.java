package kz.company.shop.priceStatistics.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "product_price_statistics_imports")
public class PriceStatisticsImport {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false, unique = true)
    public UUID importSessionId;

    @Column(nullable = false, length = 260)
    public String fileName;

    @Column(nullable = false, length = 160)
    public String createdByName;

    @Column(nullable = false)
    public Instant completedAt;

    @Column(nullable = false)
    public int changedProducts;

    @Column(nullable = false)
    public int changedPricePoints;

    @Column(nullable = false, precision = 14, scale = 6)
    public BigDecimal averageChangePercent = BigDecimal.ZERO;
}
