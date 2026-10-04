package kz.company.shop.orders.ai;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import kz.company.shop.orders.entity.PriceTier;

@Entity
@Table(name = "order_assistant_sessions")
public class OrderAssistantSession {
    @Id public UUID id;

    @Column(nullable = false)
    public Long ownerId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public OrderAssistantDto.Mode mode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public PriceTier priceTier;

    @Column(nullable = false)
    public LocalDate orderDate;

    @Column(nullable = false)
    public long revision;

    @Column(nullable = false)
    public long appliedRevision = -1;

    public UUID orderId;

    @Column(columnDefinition = "text")
    public String orderSnapshot;

    @Column(nullable = false, columnDefinition = "text")
    public String messagesJson = "[]";

    @Column(nullable = false, columnDefinition = "text")
    public String attachmentsJson = "[]";

    @Column(nullable = false, columnDefinition = "text")
    public String pendingRemovalsJson = "[]";

    @Column(nullable = false, columnDefinition = "text")
    public String proposalJson;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
