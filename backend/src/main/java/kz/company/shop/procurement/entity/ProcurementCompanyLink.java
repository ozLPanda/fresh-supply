package kz.company.shop.procurement.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "procurement_company_links")
public class ProcurementCompanyLink {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "company_id", nullable = false)
    public Long companyId;

    @Column(nullable = false)
    public String name;

    @Column(nullable = false, columnDefinition = "text")
    public String url;

    @Column(name = "sort_order", nullable = false)
    public int sortOrder;
}
