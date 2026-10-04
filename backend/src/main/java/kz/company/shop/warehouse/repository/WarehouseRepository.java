package kz.company.shop.warehouse.repository;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import kz.company.shop.warehouse.entity.Warehouse;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface WarehouseRepository extends JpaRepository<Warehouse, Long> {
    Optional<Warehouse> findByCodeAndActiveTrue(String code);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select warehouse from Warehouse warehouse where warehouse.id = :id and warehouse.active = true")
    Optional<Warehouse> findActiveForUpdateById(@Param("id") Long id);
}
