package kz.company.shop.procurement.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "procurement_status_history")
public class ProcurementStatusHistory {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "project_id", nullable = false)
    public Long projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "old_status")
    public ProcurementStatus oldStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "new_status", nullable = false)
    public ProcurementStatus newStatus;

    @Column(columnDefinition = "text")
    public String comment;

    @Column(name = "actor_user_id")
    public Long actorUserId;

    @Column(name = "actor_name", nullable = false)
    public String actorName;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
