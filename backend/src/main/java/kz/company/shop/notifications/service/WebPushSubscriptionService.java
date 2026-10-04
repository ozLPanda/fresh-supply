package kz.company.shop.notifications.service;

import java.net.URI;
import java.net.URISyntaxException;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.notifications.dto.PushSubscriptionRequest;
import kz.company.shop.notifications.entity.WebPushSubscription;
import kz.company.shop.notifications.repository.WebPushSubscriptionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WebPushSubscriptionService {
    private final WebPushSubscriptionRepository repository;

    public WebPushSubscriptionService(WebPushSubscriptionRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public void save(Long userId, PushSubscriptionRequest request) {
        requireHttpsEndpoint(request.endpoint());
        WebPushSubscription subscription =
                repository.findByEndpoint(request.endpoint()).orElseGet(WebPushSubscription::new);
        subscription.userId = userId;
        subscription.endpoint = request.endpoint();
        subscription.p256dh = request.keys().p256dh();
        subscription.auth = request.keys().auth();
        repository.save(subscription);
    }

    @Transactional
    public void delete(Long userId, PushSubscriptionRequest request) {
        repository.deleteByUserIdAndEndpoint(userId, request.endpoint());
    }

    private void requireHttpsEndpoint(String endpoint) {
        try {
            URI uri = new URI(endpoint);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
                throw new AppExceptions.BadRequest("Некорректный адрес push-подписки");
            }
        } catch (URISyntaxException exception) {
            throw new AppExceptions.BadRequest("Некорректный адрес push-подписки");
        }
    }
}
