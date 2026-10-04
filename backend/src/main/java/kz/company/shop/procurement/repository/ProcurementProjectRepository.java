package kz.company.shop.procurement.repository;

import kz.company.shop.procurement.entity.ProcurementProject;
import kz.company.shop.procurement.entity.ProcurementStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProcurementProjectRepository extends JpaRepository<ProcurementProject, Long> {
    Page<ProcurementProject> findAllByOrderByUpdatedAtDesc(Pageable pageable);

    @Query(
            "select p from ProcurementProject p where lower(p.name) like lower(concat('%', :search, '%')) "
                    + "order by p.updatedAt desc")
    Page<ProcurementProject> findByNameContainingIgnoreCaseOrderByUpdatedAtDesc(
            @Param("search") String search, Pageable pageable);

    Page<ProcurementProject> findByStatusOrderByUpdatedAtDesc(
            ProcurementStatus status, Pageable pageable);

    @Query(
            "select p from ProcurementProject p where p.status = :status "
                    + "and lower(p.name) like lower(concat('%', :search, '%')) "
                    + "order by p.updatedAt desc")
    Page<ProcurementProject> findByStatusAndNameContainingIgnoreCaseOrderByUpdatedAtDesc(
            @Param("status") ProcurementStatus status,
            @Param("search") String search,
            Pageable pageable);
}
