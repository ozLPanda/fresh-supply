package kz.company.shop.alibabaSourcing.repository;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import kz.company.shop.alibabaSourcing.entity.ProductAlibabaSourcingConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProductAlibabaSourcingConfigRepository
        extends JpaRepository<ProductAlibabaSourcingConfig, Long> {

    /** Serializes search launches for a product while its configuration row is present. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select config from ProductAlibabaSourcingConfig config where config.productId = :productId")
    Optional<ProductAlibabaSourcingConfig> findByProductIdForUpdate(
            @Param("productId") Long productId);
}
