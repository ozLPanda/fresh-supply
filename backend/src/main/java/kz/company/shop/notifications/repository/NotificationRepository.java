package kz.company.shop.notifications.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import kz.company.shop.notifications.entity.Notification;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NotificationRepository extends JpaRepository<Notification, Long> {
    List<Notification> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    long countByUserIdAndReadAtIsNull(Long userId);

    Optional<Notification> findByIdAndUserId(Long id, Long userId);

    @Modifying
    @Query(
            "update Notification n set n.readAt = :readAt "
                    + "where n.userId = :userId and n.readAt is null")
    int markAllRead(@Param("userId") Long userId, @Param("readAt") Instant readAt);
}
