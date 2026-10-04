package kz.company.shop.alibabaSourcing.repository;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingSearch;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingSearchStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AlibabaSourcingSearchRepository
        extends JpaRepository<AlibabaSourcingSearch, UUID> {
    Optional<AlibabaSourcingSearch> findByIdAndProductId(UUID id, Long productId);

    List<AlibabaSourcingSearch> findByProductIdOrderByCreatedAtDesc(Long productId);

    boolean existsByProductIdAndStatus(Long productId, AlibabaSourcingSearchStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select search from AlibabaSourcingSearch search where search.id = :searchId")
    Optional<AlibabaSourcingSearch> findByIdForUpdate(@Param("searchId") UUID searchId);
}
