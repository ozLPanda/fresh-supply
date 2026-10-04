package kz.company.shop.users.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import kz.company.shop.permissions.entity.Permission;
import kz.company.shop.roles.entity.Role;

@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(nullable = false)
    public String name;

    @Column(unique = true)
    public String email;

    public String phone;

    @Column(nullable = false)
    public String passwordHash;

    @Column(nullable = false)
    public boolean active = true;

    @Column(nullable = false, precision = 5, scale = 2)
    public BigDecimal personalDiscountPercent = BigDecimal.ZERO;

    @Column(name = "order_invoice_template", columnDefinition = "text", nullable = false)
    public String orderInvoiceTemplate = "";

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
            name = "user_roles",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "role_id"))
    public Set<Role> roles = new HashSet<>();

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(
            name = "user_permissions",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "permission_id"))
    public Set<Permission> permissions = new HashSet<>();

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
