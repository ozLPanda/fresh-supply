package kz.company.shop.procurement.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "procurement_company_notes")
public class ProcurementCompanyNote {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "company_id", nullable = false)
    public Long companyId;

    @Column(nullable = false, columnDefinition = "text")
    public String content;

    @Column(name = "author_user_id")
    public Long authorUserId;

    @Column(name = "author_name", nullable = false)
    public String authorName;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touchUpdatedAt() {
        updatedAt = Instant.now();
    }
}
