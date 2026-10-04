package kz.company.shop.productImages.entity;

import jakarta.persistence.*;
import java.time.Instant;
import kz.company.shop.products.entity.Product;

@Entity
@Table(name = "product_images")
public class ProductImage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(nullable = false)
    public Product product;

    @Column(nullable = false)
    public String fileName;

    @Column(nullable = false)
    public String originalFileName;

    @Column(nullable = false)
    public String filePath;

    @Column(name = "content_hash")
    public String contentHash;

    @Column(nullable = false)
    public int sortOrder;

    @Column(nullable = false)
    public boolean mainImage;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
