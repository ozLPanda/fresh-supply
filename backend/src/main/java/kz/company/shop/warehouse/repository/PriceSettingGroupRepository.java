package kz.company.shop.warehouse.repository;

import java.util.List;
import java.util.UUID;
import java.util.Optional;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import kz.company.shop.warehouse.entity.PriceSettingGroup;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PriceSettingGroupRepository extends JpaRepository<PriceSettingGroup, UUID> {
    List<PriceSettingGroup> findAllByOrderByUpdatedAtDesc();

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from PriceSettingGroup g where g.id = :id and g.deletedAt is null")
    Optional<PriceSettingGroup> findActiveForUpdate(@Param("id") UUID id);
}
