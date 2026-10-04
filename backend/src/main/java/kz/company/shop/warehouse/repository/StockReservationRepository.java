package kz.company.shop.warehouse.repository;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import kz.company.shop.warehouse.entity.StockReservation;
import kz.company.shop.warehouse.entity.StockReservationStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockReservationRepository extends JpaRepository<StockReservation, UUID> {
    List<StockReservation> findByOrderIdAndStatus(UUID orderId, StockReservationStatus status);

    List<StockReservation> findByWarehouseIdAndProductIdAndStatusOrderByCreatedAtDesc(
            Long warehouseId, Long productId, StockReservationStatus status);

    @Query(
            "select reservation.productId, coalesce(sum(reservation.quantity), 0) "
                    + "from StockReservation reservation where reservation.warehouseId = :warehouseId "
                    + "and reservation.status = kz.company.shop.warehouse.entity.StockReservationStatus.ACTIVE "
                    + "and reservation.productId in :productIds "
                    + "group by reservation.productId")
    List<Object[]> activeQuantityByProductIds(
            @Param("warehouseId") Long warehouseId,
            @Param("productIds") Collection<Long> productIds);

    @Query(
            "select reservation.productId, coalesce(sum(reservation.quantity), 0) "
                    + "from StockReservation reservation where reservation.warehouseId = :warehouseId "
                    + "and reservation.status = kz.company.shop.warehouse.entity.StockReservationStatus.ACTIVE "
                    + "group by reservation.productId")
    List<Object[]> activeQuantityByWarehouseId(@Param("warehouseId") Long warehouseId);

    @Query(
            "select coalesce(sum(reservation.quantity), 0) from StockReservation reservation "
                    + "where reservation.warehouseId = :warehouseId and reservation.productId = :productId "
                    + "and reservation.status = kz.company.shop.warehouse.entity.StockReservationStatus.ACTIVE")
    BigDecimal activeQuantityByProductId(
            @Param("warehouseId") Long warehouseId, @Param("productId") Long productId);
}
