package kz.company.shop.notifications.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "notifications")
public class Notification {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "user_id", nullable = false)
    public Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public NotificationType type;

    @Column(nullable = false)
    public String title;

    @Column(nullable = false, length = 600)
    public String message;

    @Column(name = "order_id")
    public UUID orderId;

    @Column(name = "action_url")
    public String actionUrl;

    @Column(name = "read_at")
    public Instant readAt;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
