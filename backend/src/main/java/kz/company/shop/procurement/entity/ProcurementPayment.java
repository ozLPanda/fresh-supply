package kz.company.shop.procurement.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

@Entity
@Table(name = "procurement_payments")
public class ProcurementPayment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "project_id", nullable = false)
    public Long projectId;

    @Column(nullable = false, precision = 14, scale = 2)
    public BigDecimal amount;

    @Column(nullable = false)
    public String currency;

    @Column(name = "paid_at", nullable = false)
    public LocalDate paidAt;

    @Column(columnDefinition = "text")
    public String comment;

    @Column(name = "created_by_user_id")
    public Long createdByUserId;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
