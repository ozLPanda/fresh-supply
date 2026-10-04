package kz.company.shop.warehouse.repository;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.warehouse.entity.StockDocument;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface StockDocumentRepository extends JpaRepository<StockDocument, UUID> {
    @Query("select allocation.productId, sum(allocation.quantity) from StockDocument document "
            + "join document.purchaseAllocations allocation where allocation.sourceDocumentId = :sourceId "
            + "and document.deletedAt is null and document.status <> kz.company.shop.warehouse.entity.StockDocumentStatus.CANCELLED "
            + "and document.id <> :excludedId group by allocation.productId")
    List<Object[]> allocatedQuantities(@Param("sourceId") UUID sourceId, @Param("excludedId") UUID excludedId);
    List<StockDocument> findByPurchaseOrderIdAndDeletedAtIsNullOrderByCreatedAtDesc(UUID purchaseOrderId);
    List<StockDocument> findByWarehouseIdAndDeletedAtIsNullOrderByCreatedAtDesc(Long warehouseId);

    List<StockDocument> findByPriceSettingGroupIdAndDeletedAtIsNullOrderByCreatedAtDesc(
            UUID priceSettingGroupId);

    /** Lock the complete active group in a stable order for an atomic bulk action. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select document from StockDocument document where document.priceSettingGroupId = :groupId "
            + "and document.deletedAt is null order by document.id")
    List<StockDocument> findActiveForUpdateByPriceSettingGroupId(@Param("groupId") UUID groupId);

    boolean existsByPriceSettingGroupIdAndDeletedAtIsNull(UUID priceSettingGroupId);

    boolean existsByAiPriceSettingGroupIdAndDeletedAtIsNull(UUID groupId);

    Optional<StockDocument> findByIdAndDeletedAtIsNull(UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select document from StockDocument document where document.id = :id "
                    + "and document.deletedAt is null")
    Optional<StockDocument> findForUpdateById(@Param("id") UUID id);

    Optional<StockDocument> findBySourceOrderIdAndDocumentType(
            UUID sourceOrderId, kz.company.shop.warehouse.entity.StockDocumentType documentType);

    /** Locks every active system document created from an order before that order is hidden. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select document from StockDocument document where document.sourceOrderId = :sourceOrderId "
                    + "and document.deletedAt is null")
    List<StockDocument> findActiveForUpdateBySourceOrderId(@Param("sourceOrderId") UUID sourceOrderId);

    @Query(
            """
            select document from StockDocument document
            where document.sourceOrderId = :sourceOrderId
              and document.documentType = kz.company.shop.warehouse.entity.StockDocumentType.CUSTOMER_RETURN
              and document.status = kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED
              and document.deletedAt is null
            order by document.postedAt desc, document.createdAt desc
            """)
    List<StockDocument> findPostedCustomerReturnsBySourceOrderId(
            @Param("sourceOrderId") UUID sourceOrderId);

    @Query(value = "select nextval('stock_document_number_seq')", nativeQuery = true)
    long nextDocumentNumber();
}
