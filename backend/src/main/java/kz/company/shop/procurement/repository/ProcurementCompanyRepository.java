package kz.company.shop.procurement.repository;

import java.util.List;
import java.util.Optional;
import kz.company.shop.procurement.entity.ProcurementCompany;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcurementCompanyRepository extends JpaRepository<ProcurementCompany, Long> {
    List<ProcurementCompany> findByProjectIdOrderByCreatedAtAsc(Long projectId);

    Optional<ProcurementCompany> findByIdAndProjectId(Long id, Long projectId);

    long countByProjectId(Long projectId);
}
