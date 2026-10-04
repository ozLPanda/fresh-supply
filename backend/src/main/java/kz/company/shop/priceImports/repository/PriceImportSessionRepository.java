package kz.company.shop.priceImports.repository;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.priceImports.entity.PriceImportSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PriceImportSessionRepository extends JpaRepository<PriceImportSession, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from PriceImportSession session where session.id = :id")
    Optional<PriceImportSession> findByIdForUpdate(@Param("id") UUID id);

    @Query(
            "select session from PriceImportSession session "
                    + "where exists (select product.id from Product product "
                    + "where product.createdFromPriceImportId = session.id "
                    + "and product.deletedAt is null) "
                    + "order by session.completedAt desc, session.createdAt desc")
    java.util.List<PriceImportSession> findAllWithCreatedProducts();
}
