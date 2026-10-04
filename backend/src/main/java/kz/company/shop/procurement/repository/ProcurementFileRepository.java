package kz.company.shop.procurement.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import kz.company.shop.procurement.entity.ProcurementFile;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcurementFileRepository extends JpaRepository<ProcurementFile, Long> {
    List<ProcurementFile> findByProjectIdAndCompanyIdIsNullOrderByCreatedAtDesc(Long projectId);

    List<ProcurementFile> findByCompanyIdInOrderByCreatedAtDesc(Collection<Long> companyIds);

    Optional<ProcurementFile> findByIdAndProjectId(Long id, Long projectId);
}
