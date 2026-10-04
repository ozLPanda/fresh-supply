package kz.company.shop.alibabaSourcing.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "product_alibaba_sourcing_configs")
public class ProductAlibabaSourcingConfig {
    @Id
    @Column(name = "product_id")
    public Long productId;

    @Column(nullable = false)
    public boolean enabled;

    @Column(name = "search_query")
    public String searchQuery;

    @Column(name = "min_order_quantity", precision = 14, scale = 2)
    public BigDecimal minOrderQuantity;

    @Column(name = "min_company_age_years")
    public Integer minCompanyAgeYears;

    @Column(name = "selected_offer_id")
    public Long selectedOfferId;

    @Column(name = "selected_at")
    public Instant selectedAt;

    @Column(name = "selected_by_user_id")
    public Long selectedByUserId;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
