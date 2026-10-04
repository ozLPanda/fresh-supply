package kz.company.shop.procurement.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "procurement_files")
public class ProcurementFile {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "project_id", nullable = false)
    public Long projectId;

    @Column(name = "company_id")
    public Long companyId;

    @Column(name = "display_name", nullable = false)
    public String displayName;

    @Column(name = "file_name", nullable = false)
    public String fileName;

    @Column(name = "file_path", nullable = false, columnDefinition = "text")
    public String filePath;

    @Column(name = "original_file_name", nullable = false)
    public String originalFileName;

    @Column(name = "content_type")
    public String contentType;

    @Column(name = "file_size", nullable = false)
    public long fileSize;

    @Column(name = "uploaded_by_user_id")
    public Long uploadedByUserId;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
