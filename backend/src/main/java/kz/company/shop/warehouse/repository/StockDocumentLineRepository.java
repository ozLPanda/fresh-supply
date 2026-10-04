package kz.company.shop.warehouse.repository;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import kz.company.shop.warehouse.entity.StockDocumentLine;
import kz.company.shop.warehouse.entity.StockDocumentStatus;
import kz.company.shop.warehouse.entity.StockDocumentType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.query.Param;

public interface StockDocumentLineRepository extends JpaRepository<StockDocumentLine, Long> {
    List<StockDocumentLine> findBySourceOrderItemId(Long sourceOrderItemId);
    List<StockDocumentLine> findByDocumentIdOrderById(UUID documentId);

    @Query("""
            select line, document from StockDocumentLine line
            join StockDocument document on document.id = line.documentId
            where line.productId = :productId and document.priceType = :priceType
              and document.documentType = kz.company.shop.warehouse.entity.StockDocumentType.PRICE_SETTING
              and document.status = kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED
              and document.deletedAt is null
            """)
    List<Object[]> findPostedPriceHistory(
            @Param("productId") Long productId,
            @Param("priceType") kz.company.shop.warehouse.entity.StockDocumentPriceType priceType);

    @Query("""
            select line, document from StockDocumentLine line
            join StockDocument document on document.id = line.documentId
            where line.productId = :productId
              and document.documentType = kz.company.shop.warehouse.entity.StockDocumentType.RECEIPT
              and document.status = kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED
              and document.deletedAt is null and line.unitCost is not null
            """)
    List<Object[]> findPostedReceiptHistory(@Param("productId") Long productId);

    @Query(
            value = """
            select line.* from stock_document_lines line
            join stock_documents document on document.id = line.document_id
            where line.product_id = :productId
              and document.document_type = 'RECEIPT'
              and document.status = 'POSTED'
              and document.deleted_at is null
              and line.unit_cost is not null
            order by coalesce((document.effective_date + coalesce(document.effective_time, time '00:00'))
                              at time zone 'Asia/Almaty', document.posted_at, document.created_at) desc,
                     document.created_at desc, document.id desc, line.id desc
            """, nativeQuery = true)
    List<StockDocumentLine> findLatestPostedReceiptLines(
            @Param("productId") Long productId, Pageable pageable);

    @Query(
            """
            select distinct line.productId
            from StockDocumentLine line
            join StockDocument document on document.id = line.documentId
            where line.productId in :productIds
              and document.documentType = kz.company.shop.warehouse.entity.StockDocumentType.PRICE_SETTING
              and document.status = kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED
              and document.deletedAt is null
            """)
    java.util.Set<Long> findProductIdsInPostedPriceSettings(
            @Param("productIds") Collection<Long> productIds);

    @Query(
            """
            select coalesce(document.postedAt, document.createdAt), line.unitCost, document.id, document.documentNumber
            from StockDocumentLine line
            join StockDocument document on document.id = line.documentId
            where line.productId = :productId
              and document.documentType = kz.company.shop.warehouse.entity.StockDocumentType.RECEIPT
              and document.status = kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED
              and document.deletedAt is null
              and line.unitCost is not null
            order by coalesce(document.postedAt, document.createdAt) asc, line.id asc
            """)
    List<Object[]> postedReceiptCostHistory(@Param("productId") Long productId);

    void deleteByDocumentId(UUID documentId);

    @Query(
            """
            select line.sourceOrderItemId, coalesce(sum(line.quantity), 0)
            from StockDocumentLine line
            join StockDocument document on document.id = line.documentId
            where document.sourceOrderId = :sourceOrderId
              and document.documentType = :documentType
              and document.status = :status
              and document.deletedAt is null
              and line.sourceOrderItemId in :sourceOrderItemIds
            group by line.sourceOrderItemId
            """)
    List<Object[]> postedQuantityBySourceOrderItemIds(
            @Param("sourceOrderId") UUID sourceOrderId,
            @Param("sourceOrderItemIds") Collection<Long> sourceOrderItemIds,
            @Param("documentType") StockDocumentType documentType,
            @Param("status") StockDocumentStatus status);

    @Query(
            """
            select document.sourceOrderId, coalesce(sum(line.quantity), 0),
                   coalesce(sum(line.quantity * line.unitPrice), 0)
            from StockDocumentLine line
            join StockDocument document on document.id = line.documentId
            where document.documentType = kz.company.shop.warehouse.entity.StockDocumentType.CUSTOMER_RETURN
              and document.status = kz.company.shop.warehouse.entity.StockDocumentStatus.POSTED
              and document.deletedAt is null
              and document.sourceOrderId is not null
              and line.sourceOrderItemId is not null
            group by document.sourceOrderId
            """)
    List<Object[]> postedCustomerReturnStatistics();

    @Query(
            """
            select document from StockDocumentLine line
            join StockDocument document on document.id = line.documentId
            where line.productId = :productId
              and not exists (
                select version.id from StockDocumentVersion version
                where version.documentId = document.id
              )
            order by coalesce(document.postedAt, document.createdAt) desc, document.id desc
            """)
    List<kz.company.shop.warehouse.entity.StockDocument> findDocumentsWithoutVersionsByProductId(
            @Param("productId") Long productId);
}
