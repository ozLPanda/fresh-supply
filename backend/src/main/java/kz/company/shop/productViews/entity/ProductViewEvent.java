package kz.company.shop.productViews.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "product_view_events")
public class ProductViewEvent {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "product_id", nullable = false)
    public Long productId;

    @Column(name = "user_id")
    public Long userId;

    @Column(name = "visitor_key", nullable = false)
    public String visitorKey;

    @Column(name = "viewed_at", nullable = false)
    public Instant viewedAt = Instant.now();
}
