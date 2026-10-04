package kz.company.shop.priceImports.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "product_price_import_sessions")
public class PriceImportSession {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    public UUID id;

    @Column(nullable = false, length = 260)
    public String fileName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    public PriceImportStatus status = PriceImportStatus.ANALYZED;

    @Column(nullable = false)
    public int totalRows;

    @Column(nullable = false)
    public int changedRows;

    @Column(nullable = false)
    public int unchangedRows;

    @Column(nullable = false)
    public int notFoundRows;

    @Column(nullable = false)
    public int invalidRows;

    @Column(nullable = false)
    public int duplicateRows;

    @Column(nullable = false, columnDefinition = "text")
    public String analysisJson;

    @Column(nullable = false, columnDefinition = "text")
    public String previewJson;

    public Long createdByUserId;

    @Column(nullable = false, length = 160)
    public String createdByName;

    public Integer committedUpdated;
    public Integer committedCreated;
    public Integer committedUnchanged;
    public Integer committedSkipped;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();

    public Instant completedAt;

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
