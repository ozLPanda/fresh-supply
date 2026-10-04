package kz.company.shop.procurement.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "procurement_companies")
public class ProcurementCompany {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "project_id", nullable = false)
    public Long projectId;

    @Column(nullable = false)
    public String name;

    @Column(precision = 14, scale = 2)
    public BigDecimal price;

    @Column(name = "price_currency", length = 3)
    public String priceCurrency;

    @Column(columnDefinition = "text")
    public String market;

    @Column(name = "market_since_year")
    public Integer marketSinceYear;

    @Column(name = "reviews_from_year")
    public Integer reviewsFromYear;

    @Column(name = "reviews_to_year")
    public Integer reviewsToYear;

    @Column(columnDefinition = "text")
    public String comment;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    public ProcurementCompanyStatus status = ProcurementCompanyStatus.FOUND;

    @Column(name = "decision_comment", columnDefinition = "text")
    public String decisionComment;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
