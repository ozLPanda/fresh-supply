package kz.company.shop.procurement.repository;

import java.util.Collection;
import java.util.List;
import kz.company.shop.procurement.entity.ProcurementCompanyLink;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcurementCompanyLinkRepository
        extends JpaRepository<ProcurementCompanyLink, Long> {
    List<ProcurementCompanyLink> findByCompanyIdOrderBySortOrderAsc(Long companyId);

    List<ProcurementCompanyLink> findByCompanyIdInOrderBySortOrderAsc(Collection<Long> companyIds);

    void deleteByCompanyId(Long companyId);
}
