package kz.company.shop.integrations.onec.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import kz.company.shop.permissions.entity.Permission;

@Entity
@Table(name = "external_api_credentials")
public class ExternalApiCredential {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false, length = 160)
    public String name;

    /**
     * The generated credential intentionally remains retrievable for administrators, as required
     * for third-party software configuration.
     */
    @Column(name = "access_code", nullable = false, unique = true, length = 128)
    public String accessCode;

    @Column(name = "expires_at")
    public Instant expiresAt;

    @Column(name = "revoked_at")
    public Instant revokedAt;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt = Instant.now();

    @ManyToMany
    @JoinTable(
            name = "external_api_credential_permissions",
            joinColumns = @JoinColumn(name = "external_api_credential_id"),
            inverseJoinColumns = @JoinColumn(name = "permission_id"))
    public Set<Permission> permissions = new HashSet<>();
}
