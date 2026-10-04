package kz.company.shop.orders.ai;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

public interface OrderAssistantSessionRepository
        extends JpaRepository<OrderAssistantSession, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from OrderAssistantSession s where s.id=:id and s.ownerId=:owner")
    Optional<OrderAssistantSession> lockOwned(@Param("id") UUID id, @Param("owner") Long owner);

    Optional<OrderAssistantSession> findByIdAndOwnerId(UUID id, Long ownerId);
}
