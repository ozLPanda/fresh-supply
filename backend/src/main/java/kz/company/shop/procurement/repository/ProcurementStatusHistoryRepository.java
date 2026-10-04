package kz.company.shop.procurement.repository;

import java.util.List;
import kz.company.shop.procurement.entity.ProcurementStatusHistory;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcurementStatusHistoryRepository
        extends JpaRepository<ProcurementStatusHistory, Long> {
    List<ProcurementStatusHistory> findByProjectIdOrderByCreatedAtDesc(Long projectId);
}
