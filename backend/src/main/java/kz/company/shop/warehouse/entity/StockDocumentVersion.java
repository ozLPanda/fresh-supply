package kz.company.shop.warehouse.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/** Immutable audit snapshot of a warehouse document after a meaningful lifecycle change. */
@Entity
@Table(name = "stock_document_versions")
public class StockDocumentVersion {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "document_id", nullable = false)
    public UUID documentId;

    @Column(name = "version_number", nullable = false)
    public int versionNumber;

    @Column(nullable = false, length = 24)
    public String action;

    @Column(name = "change_summary", nullable = false, columnDefinition = "text")
    public String changeSummary;

    @Column(name = "snapshot_json", nullable = false, columnDefinition = "text")
    public String snapshotJson;

    @Column(name = "changed_by_user_id")
    public Long changedByUserId;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
