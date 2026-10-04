package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/** A supplier or another business counterparty used only by warehouse documents. */
@Entity
@Table(name = "warehouse_counterparties")
public class WarehouseCounterparty {
    @Id public UUID id;

    @Column(nullable = false, length = 240)
    public String name;

    @Column(name = "contact_name", length = 160)
    public String contactName;

    @Column(length = 64)
    public String phone;

    @Column(length = 254)
    public String email;

    @Column(columnDefinition = "text")
    public String comment;

    @Column(nullable = false)
    public boolean archived;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
