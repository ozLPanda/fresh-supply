package kz.company.shop.procurement.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "procurement_projects")
public class ProcurementProject {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false)
    public String name;

    @Column(name = "purchase_information", columnDefinition = "text")
    public String purchaseInformation;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public ProcurementStatus status = ProcurementStatus.DRAFT;

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
