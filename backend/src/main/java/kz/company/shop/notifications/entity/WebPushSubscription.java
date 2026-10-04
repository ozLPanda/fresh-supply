package kz.company.shop.notifications.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "web_push_subscriptions")
public class WebPushSubscription {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "user_id", nullable = false)
    public Long userId;

    @Column(nullable = false, unique = true, columnDefinition = "text")
    public String endpoint;

    @Column(nullable = false, length = 512)
    public String p256dh;

    @Column(nullable = false, length = 512)
    public String auth;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
