package kz.company.shop.procurement.repository;

import java.util.List;
import kz.company.shop.procurement.entity.ProcurementCompanyNote;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcurementCompanyNoteRepository
        extends JpaRepository<ProcurementCompanyNote, Long> {
    List<ProcurementCompanyNote> findByCompanyIdOrderByCreatedAtAsc(Long companyId);
}
