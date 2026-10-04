package kz.company.shop.orders.ai;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "order_assistant_memories",
        uniqueConstraints = @UniqueConstraint(columnNames = {"owner_id", "kind", "source"}))
public class OrderAssistantMemory {
    @Id public UUID id;

    @Column(nullable = false)
    public Long ownerId;

    @Column(nullable = false, length = 20)
    public String kind;

    @Column(nullable = false, length = 240)
    public String source;

    @Column(nullable = false, length = 80)
    public String targetId;

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();
}
