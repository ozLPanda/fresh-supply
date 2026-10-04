package kz.company.shop.warehouse.ai;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AiPriceSessionRepository extends JpaRepository<AiPriceSession, UUID> {
    boolean existsByGroupId(UUID groupId);

    Optional<AiPriceSession> findFirstByReceiptIdAndGroupIdOrderByCreatedAtDesc(UUID receiptId, UUID groupId);

    Optional<AiPriceSession> findByParentSessionId(UUID parentSessionId);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from AiPriceSession s where s.id = :id")
    Optional<AiPriceSession> findLocked(@Param("id") UUID id);
}
