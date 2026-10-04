package kz.company.shop.warehouse.repository;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import kz.company.shop.warehouse.entity.StockMovement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockMovementRepository extends JpaRepository<StockMovement, UUID> {
    List<StockMovement> findByDocumentId(UUID documentId);

    @Query("select movement, document from StockMovement movement "
            + "join StockDocument document on document.id = movement.documentId "
            + "where movement.warehouseId = :warehouseId and movement.productId = :productId")
    List<Object[]> findLedgerHistory(@Param("warehouseId") Long warehouseId,
                                    @Param("productId") Long productId);

    @Query(
            "select movement, document from StockMovement movement "
                    + "join StockDocument document on document.id = movement.documentId "
                    + "where movement.warehouseId = :warehouseId and movement.productId = :productId "
                    + "and document.deletedAt is null and document.status = kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED "
                    + "and (document.cancelledAt is null or movement.createdAt > document.cancelledAt) "
                    + "and movement.reversesMovementId is null and movement.movementType not like 'CANCEL_%' "
                    + "and not exists (select reversal.id from StockMovement reversal where reversal.reversesMovementId = movement.id) "
                    + "order by movement.occurredAt asc, movement.createdAt asc, movement.id asc")
    List<Object[]> findActiveWithDocumentByWarehouseIdAndProductIdOrderByOccurredAtAsc(
            @Param("warehouseId") Long warehouseId, @Param("productId") Long productId);

    @Query(value = """
            select movement.product_id, coalesce(sum(movement.quantity),0)
            from stock_movements movement join stock_documents document on document.id=movement.document_id
            where movement.warehouse_id=:warehouseId and document.deleted_at is null and document.status='POSTED'
              and (document.cancelled_at is null or movement.created_at>document.cancelled_at)
              and movement.reverses_movement_id is null and movement.movement_type not like 'CANCEL_%'
              and not exists(select 1 from stock_movements reversal where reversal.reverses_movement_id=movement.id)
              and not exists (
                select 1 from stock_movements opening join stock_documents source on source.id=opening.document_id
                where opening.warehouse_id=movement.warehouse_id and opening.product_id=movement.product_id
                  and opening.movement_type='OPENING_BALANCE' and source.status='POSTED' and source.deleted_at is null
                  and (source.cancelled_at is null or opening.created_at>source.cancelled_at)
                  and not exists(select 1 from stock_movements reversal where reversal.reverses_movement_id=opening.id)
                  and (opening.occurred_at,opening.created_at,opening.id) > (movement.occurred_at,movement.created_at,movement.id)
              )
            and movement.product_id in (:productIds)
            group by movement.product_id
            """, nativeQuery = true)
    List<Object[]> balanceByProductIds(@Param("warehouseId") Long warehouseId,
            @Param("productIds") Collection<Long> productIds);

    @Query(value = """
            select movement.product_id, coalesce(sum(movement.quantity),0)
            from stock_movements movement join stock_documents document on document.id=movement.document_id
            where movement.warehouse_id=:warehouseId and document.deleted_at is null and document.status='POSTED'
              and (document.cancelled_at is null or movement.created_at>document.cancelled_at)
              and movement.reverses_movement_id is null and movement.movement_type not like 'CANCEL_%'
              and not exists(select 1 from stock_movements reversal where reversal.reverses_movement_id=movement.id)
              and not exists (
                select 1 from stock_movements opening join stock_documents source on source.id=opening.document_id
                where opening.warehouse_id=movement.warehouse_id and opening.product_id=movement.product_id
                  and opening.movement_type='OPENING_BALANCE' and source.status='POSTED' and source.deleted_at is null
                  and (source.cancelled_at is null or opening.created_at>source.cancelled_at)
                  and not exists(select 1 from stock_movements reversal where reversal.reverses_movement_id=opening.id)
                  and (opening.occurred_at,opening.created_at,opening.id) > (movement.occurred_at,movement.created_at,movement.id)
              )

            group by movement.product_id
            """, nativeQuery = true)
    List<Object[]> balanceByWarehouseId(@Param("warehouseId") Long warehouseId);

    @Query(value = """
            select coalesce(sum(movement.quantity),0)
            from stock_movements movement join stock_documents document on document.id=movement.document_id
            where movement.warehouse_id=:warehouseId and document.deleted_at is null and document.status='POSTED'
              and (document.cancelled_at is null or movement.created_at>document.cancelled_at)
              and movement.reverses_movement_id is null and movement.movement_type not like 'CANCEL_%'
              and not exists(select 1 from stock_movements reversal where reversal.reverses_movement_id=movement.id)
              and not exists (
                select 1 from stock_movements opening join stock_documents source on source.id=opening.document_id
                where opening.warehouse_id=movement.warehouse_id and opening.product_id=movement.product_id
                  and opening.movement_type='OPENING_BALANCE' and source.status='POSTED' and source.deleted_at is null
                  and (source.cancelled_at is null or opening.created_at>source.cancelled_at)
                  and not exists(select 1 from stock_movements reversal where reversal.reverses_movement_id=opening.id)
                  and (opening.occurred_at,opening.created_at,opening.id) > (movement.occurred_at,movement.created_at,movement.id)
              )
            and movement.product_id=:productId
            """, nativeQuery = true)
    BigDecimal balanceByProductId(@Param("warehouseId") Long warehouseId,
            @Param("productId") Long productId);

    @Query("select count(movement) > 0 from StockMovement movement "
            + "join StockDocument document on document.id=movement.documentId "
            + "where movement.warehouseId=:warehouseId and movement.productId=:productId "
            + "and document.status=kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED and document.deletedAt is null "
            + "and (document.cancelledAt is null or movement.createdAt>document.cancelledAt) "
            + "and movement.reversesMovementId is null and movement.movementType not like 'CANCEL_%' "
            + "and not exists(select reversal.id from StockMovement reversal where reversal.reversesMovementId=movement.id)")
    boolean existsActiveByWarehouseIdAndProductId(
            @Param("warehouseId") Long warehouseId, @Param("productId") Long productId);

    @Query(
            """
            select count(movement) > 0
            from StockMovement movement
            join StockDocument document on document.id = movement.documentId
            where movement.warehouseId = :warehouseId
              and movement.productId = :productId
              and document.documentType = kz.company.shop.warehouse.entity.StockDocumentType.OPENING_BALANCE
              and document.status = kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED
              and (document.cancelledAt is null or movement.createdAt > document.cancelledAt)
              and document.deletedAt is null
              and movement.movementType = 'OPENING_BALANCE'
              and not exists(select reversal.id from StockMovement reversal where reversal.reversesMovementId=movement.id)
            """)
    boolean existsPostedOpeningBalanceByWarehouseIdAndProductId(
            @Param("warehouseId") Long warehouseId, @Param("productId") Long productId);
}
