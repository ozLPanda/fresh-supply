package kz.company.shop.reviews.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "review_messages")
public class ReviewMessage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "review_id", nullable = false)
    public Review review;

    @Column(name = "user_id")
    public Long userId;

    @Column(name = "author_name", nullable = false)
    public String authorName;

    @Enumerated(EnumType.STRING)
    @Column(name = "author_type", nullable = false)
    public ReviewMessageAuthorType authorType;

    @Column(nullable = false, columnDefinition = "text")
    public String content;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
