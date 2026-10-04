package kz.company.shop.warehouse.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.warehouse.entity.StockDocumentVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StockDocumentVersionRepository
        extends JpaRepository<StockDocumentVersion, Long> {
    List<StockDocumentVersion> findByDocumentIdOrderByVersionNumberDesc(UUID documentId);

    Optional<StockDocumentVersion> findTopByDocumentIdOrderByVersionNumberDesc(UUID documentId);

    @Query(
            """
            select version, document from StockDocumentVersion version
            join StockDocument document on document.id = version.documentId
            where exists (
                select line.id from StockDocumentLine line
                where line.documentId = document.id and line.productId = :productId
            )
            order by version.createdAt desc, version.id desc
            """)
    List<Object[]> findHistoryByProductId(@Param("productId") Long productId);
}
