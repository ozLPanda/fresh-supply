package kz.company.shop.categories.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "categories")
public class Category {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id")
    public Category parent;

    @Column(name = "parent_id", insertable = false, updatable = false)
    public Long parentId;

    @Column(nullable = false)
    public String nameRu;

    @Column(nullable = false)
    public String nameKk;

    public String descriptionRu;
    public String descriptionKk;
    public String imageFileName;
    public String imageOriginalFileName;
    public String imageFilePath;

    @Column(name = "image_content_hash")
    public String imageContentHash;

    @Column(nullable = false, unique = true)
    public String slug;

    @Column(nullable = false)
    public int sortOrder;

    @Column(nullable = false)
    public boolean active = true;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();

    public Instant deletedAt;

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
