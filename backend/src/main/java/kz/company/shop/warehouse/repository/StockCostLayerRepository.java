package kz.company.shop.warehouse.repository;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.UUID;
import kz.company.shop.warehouse.entity.StockCostLayer;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface StockCostLayerRepository extends JpaRepository<StockCostLayer, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    List<StockCostLayer> findByWarehouseIdAndProductIdOrderByCreatedAtAsc(
            Long warehouseId, Long productId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select layer from StockCostLayer layer where layer.warehouseId = :warehouseId "
                    + "and layer.productId = :productId and layer.remainingQuantity > 0 "
                    + "and layer.sourceDocumentId in "
                    + "(select document.id from StockDocument document where document.deletedAt is null) "
                    + "order by layer.receivedAt asc, layer.createdAt asc")
    List<StockCostLayer> findAvailableFifoForUpdate(
            @Param("warehouseId") Long warehouseId, @Param("productId") Long productId);

    List<StockCostLayer> findByWarehouseIdAndProductId(Long warehouseId, Long productId);

    List<StockCostLayer> findBySourceDocumentId(UUID sourceDocumentId);

    @Query(
            "select layer from StockCostLayer layer where layer.warehouseId = :warehouseId "
                    + "and layer.productId = :productId and layer.remainingQuantity > :remainingQuantity "
                    + "and layer.sourceDocumentId in "
                    + "(select document.id from StockDocument document where document.deletedAt is null) "
                    + "order by layer.receivedAt asc, layer.createdAt asc")
    List<StockCostLayer>
            findActiveByWarehouseIdAndProductIdAndRemainingQuantityGreaterThanOrderByReceivedAtAscCreatedAtAsc(
                    @Param("warehouseId") Long warehouseId,
                    @Param("productId") Long productId,
                    @Param("remainingQuantity") java.math.BigDecimal remainingQuantity);
}
