package kz.company.shop.warehouse.repository;

import java.util.List;
import java.util.UUID;
import kz.company.shop.warehouse.entity.WarehouseCounterparty;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WarehouseCounterpartyRepository extends JpaRepository<WarehouseCounterparty, UUID> {
    List<WarehouseCounterparty> findAllByOrderByArchivedAscNameAsc();
}
