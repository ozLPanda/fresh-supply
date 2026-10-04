package kz.company.shop.products.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import kz.company.shop.categories.entity.Category;

@Entity
@Table(name = "products")
public class Product {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false, unique = true)
    public String sku;

    @Enumerated(EnumType.STRING)
    @Column(name = "measurement_unit", nullable = false)
    public MeasurementUnit measurementUnit = MeasurementUnit.KG;

    @Column(nullable = false)
    public String nameRu;

    @Column(nullable = false)
    public String nameKk;

    public String shortDescriptionRu;
    public String shortDescriptionKk;

    @Column(columnDefinition = "text")
    public String descriptionRu;

    @Column(columnDefinition = "text")
    public String descriptionKk;

    @Column(nullable = false, precision = 14, scale = 2)
    public BigDecimal price;

    @Column(precision = 14, scale = 2)
    public BigDecimal wholesalePrice;

    @Column(precision = 14, scale = 2)
    public BigDecimal bulkWholesalePrice;

    @Column(precision = 14, scale = 2)
    public BigDecimal skoPrice;

    /** Internal GSKO price. It is never a customer price tier. */
    @Column(precision = 14, scale = 2)
    public BigDecimal gskoPrice;

    @Column(name = "incoming_price", precision = 14, scale = 2)
    public BigDecimal incomingPrice;

    @Column(name = "category_id")
    public Long categoryId;

    @Column(name = "created_from_price_import_id")
    public UUID createdFromPriceImportId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "category_id", insertable = false, updatable = false)
    public Category category;

    @Column(nullable = false)
    public boolean active = true;

    @Column(nullable = false)
    public boolean madeToOrder = false;

    public Integer deliveryDaysFrom;

    public Integer deliveryDaysTo;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();

    public Instant deletedAt;

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
