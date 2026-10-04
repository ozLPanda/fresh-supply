package kz.company.shop.regularbuyers.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/** Recipient directory, independent of customer accounts and warehouse counterparties. */
@Entity
@Table(name = "regular_buyers")
public class RegularBuyer {
    @Id public UUID id;
    @Column(nullable = false, length = 240) public String name;
    @Column(name = "contact_name", length = 160) public String contactName;
    @Column(length = 64) public String phone;
    @Column(length = 254) public String email;
    @Column(name = "tax_id", length = 12) public String taxId;
    @Column(name = "legal_address", length = 1000) public String legalAddress;
    @Column(columnDefinition = "text") public String comment;
    @Column(nullable = false) public boolean archived;
    @Column(name = "created_at", nullable = false) public Instant createdAt = Instant.now();
    @Column(name = "updated_at", nullable = false) public Instant updatedAt = Instant.now();
    @PreUpdate void touch() { updatedAt = Instant.now(); }
}
