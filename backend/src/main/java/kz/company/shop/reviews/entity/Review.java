package kz.company.shop.reviews.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "reviews")
public class Review {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "product_id", nullable = false)
    public Long productId;

    @Column(name = "user_id", nullable = false)
    public Long userId;

    @Column(name = "author_name", nullable = false)
    public String authorName;

    @Column(nullable = false)
    public int rating;

    @Column(nullable = false, columnDefinition = "text")
    public String content;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public ReviewStatus status = ReviewStatus.PENDING;

    @Column(nullable = false)
    public boolean verified;

    @Column(name = "verified_order_id")
    public UUID verifiedOrderId;

    @OneToMany(mappedBy = "review", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("sortOrder asc")
    public List<ReviewImage> images = new ArrayList<>();

    @OneToMany(mappedBy = "review", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("createdAt asc")
    public List<ReviewMessage> messages = new ArrayList<>();

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
