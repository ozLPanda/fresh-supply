package kz.company.shop.warehouse.repository;

import java.util.Optional;
import java.util.UUID;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.entity.WarehousePriceBaseline;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WarehousePriceBaselineRepository extends JpaRepository<WarehousePriceBaseline, UUID> {
    Optional<WarehousePriceBaseline> findByProductIdAndPriceType(
            Long productId, StockDocumentPriceType priceType);
}
