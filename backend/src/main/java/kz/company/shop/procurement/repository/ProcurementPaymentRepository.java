package kz.company.shop.procurement.repository;

import java.util.List;
import java.util.Optional;
import kz.company.shop.procurement.entity.ProcurementPayment;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcurementPaymentRepository extends JpaRepository<ProcurementPayment, Long> {
    List<ProcurementPayment> findByProjectIdOrderByPaidAtDescCreatedAtDesc(Long projectId);

    Optional<ProcurementPayment> findByIdAndProjectId(Long id, Long projectId);
}
