package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/** Shared rules and explanatory text for a related set of price-setting documents. */
@Entity
@Table(name = "price_setting_groups")
public class PriceSettingGroup {
    @Id public UUID id;

    @Column(nullable = false, length = 160)
    public String name;

    @Column(name = "common_rules", columnDefinition = "text")
    public String commonRules;

    @Column(columnDefinition = "text")
    public String comment;

    @Column(name = "created_by_user_id")
    public Long createdByUserId;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @Column(name = "deleted_at")
    public Instant deletedAt;

    @Column(name = "deleted_by_user_id")
    public Long deletedByUserId;

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
