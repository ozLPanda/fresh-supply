package kz.company.shop.notifications.repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import kz.company.shop.notifications.entity.WebPushSubscription;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WebPushSubscriptionRepository extends JpaRepository<WebPushSubscription, Long> {
    Optional<WebPushSubscription> findByEndpoint(String endpoint);

    List<WebPushSubscription> findByUserIdIn(Collection<Long> userIds);

    void deleteByUserIdAndEndpoint(Long userId, String endpoint);
}
