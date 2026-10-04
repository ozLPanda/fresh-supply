package kz.company.shop.alibabaSourcing.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "alibaba_sourcing_offers")
public class AlibabaSourcingOffer {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "search_id", nullable = false)
    public UUID searchId;

    @Column(nullable = false)
    public int position;

    @Column(name = "product_title")
    public String productTitle;

    @Column(name = "product_url", columnDefinition = "text")
    public String productUrl;

    @Column(name = "supplier_name", nullable = false)
    public String supplierName;

    @Column(name = "supplier_url", columnDefinition = "text")
    public String supplierUrl;

    public String country;

    @Column(name = "company_age_years")
    public Integer companyAgeYears;

    @Column(name = "verified_supplier")
    public Boolean verifiedSupplier;

    @Column(precision = 4, scale = 2)
    public BigDecimal rating;

    @Column(name = "review_count")
    public Integer reviewCount;

    @Column(name = "price_from", precision = 14, scale = 2)
    public BigDecimal priceFrom;

    @Column(name = "price_to", precision = 14, scale = 2)
    public BigDecimal priceTo;

    public String currency;

    @Column(name = "minimum_order_quantity", precision = 14, scale = 2)
    public BigDecimal minimumOrderQuantity;

    @Column(name = "minimum_order_unit")
    public String minimumOrderUnit;

    @Column(columnDefinition = "text")
    public String description;
}
