package kz.company.shop.reviews.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "review_images")
public class ReviewImage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "review_id", nullable = false)
    public Review review;

    @Column(name = "file_name", nullable = false)
    public String fileName;

    @Column(name = "file_path", nullable = false)
    public String filePath;

    @Column(name = "original_file_name", nullable = false)
    public String originalFileName;

    @Column(name = "file_size", nullable = false)
    public long fileSize;

    @Column(name = "sort_order", nullable = false)
    public int sortOrder;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
