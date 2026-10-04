package kz.company.shop.warehouse.repository;

import java.util.UUID;
import kz.company.shop.warehouse.entity.StockLedgerRevision;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StockLedgerRevisionRepository extends JpaRepository<StockLedgerRevision, UUID> {}
