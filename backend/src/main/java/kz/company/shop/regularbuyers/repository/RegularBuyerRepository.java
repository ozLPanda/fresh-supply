package kz.company.shop.regularbuyers.repository;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RegularBuyerRepository extends JpaRepository<RegularBuyer, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from RegularBuyer b where b.archived = false order by b.id")
    List<RegularBuyer> findActiveForUpdateOrdered();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from RegularBuyer b where b.id = :id")
    Optional<RegularBuyer> findForUpdateById(@Param("id") UUID id);

    List<RegularBuyer> findAllByOrderByNameAsc();

    List<RegularBuyer> findByArchivedFalseOrderByNameAsc();
}
