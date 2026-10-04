package kz.company.shop.integrations.onec.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "integration_logs")
public class IntegrationLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false)
    public String sourceSystem;

    @Column(nullable = false)
    public String operation;

    @Column(nullable = false)
    public String status;

    @Column(columnDefinition = "text")
    public String message;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();
}
