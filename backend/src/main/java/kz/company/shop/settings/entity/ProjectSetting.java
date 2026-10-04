package kz.company.shop.settings.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "project_settings")
public class ProjectSetting {
    @Id
    @Column(name = "key", nullable = false, length = 120)
    public String key;

    @Column(nullable = false, columnDefinition = "text")
    public String value;

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();

    @PreUpdate
    void touch() {
        updatedAt = Instant.now();
    }
}
