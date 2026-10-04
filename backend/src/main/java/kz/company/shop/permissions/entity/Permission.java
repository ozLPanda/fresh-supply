package kz.company.shop.permissions.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "permissions")
public class Permission {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false, unique = true)
    public String code;

    @Column(nullable = false)
    public String entityName;

    @Column(nullable = false)
    public String actionName;

    @Column(nullable = false)
    public String nameRu;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();
}
