package kz.company.shop.audit.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "audit_logs")
public class AuditLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "actor_user_id")
    public Long actorUserId;

    @Column(name = "actor_name", nullable = false)
    public String actorName;

    @Column(nullable = false)
    public String action;

    @Column(name = "entity_type", nullable = false)
    public String entityType;

    @Column(name = "entity_id")
    public String entityId;

    @Column(nullable = false, length = 500)
    public String description;

    /** Optional structured details for rich, field-by-field activity rendering. */
    @Column(columnDefinition = "text")
    public String details;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
