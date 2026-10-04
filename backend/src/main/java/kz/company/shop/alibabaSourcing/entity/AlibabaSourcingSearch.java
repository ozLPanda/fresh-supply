package kz.company.shop.alibabaSourcing.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "alibaba_sourcing_searches")
public class AlibabaSourcingSearch {
    @Id public UUID id;

    @Column(name = "product_id", nullable = false)
    public Long productId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public AlibabaSourcingSearchStatus status;

    @Column(name = "search_query", nullable = false)
    public String searchQuery;

    @Column(name = "min_order_quantity", precision = 14, scale = 2)
    public BigDecimal minOrderQuantity;

    @Column(name = "min_company_age_years")
    public Integer minCompanyAgeYears;

    @Column(name = "error_message", columnDefinition = "text")
    public String errorMessage;

    @Column(name = "created_by_user_id")
    public Long createdByUserId;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "completed_at")
    public Instant completedAt;
}
