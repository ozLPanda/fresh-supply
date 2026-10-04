package kz.company.shop.notifications.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.security.GeneralSecurityException;
import java.security.Security;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import kz.company.shop.notifications.config.WebPushProperties;
import kz.company.shop.notifications.entity.WebPushSubscription;
import kz.company.shop.notifications.repository.WebPushSubscriptionRepository;
import nl.martijndwars.webpush.Encoding;
import nl.martijndwars.webpush.Notification;
import nl.martijndwars.webpush.PushService;
import nl.martijndwars.webpush.Subscription;
import org.apache.http.HttpResponse;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class WebPushDeliveryService {
    private static final Logger log = LoggerFactory.getLogger(WebPushDeliveryService.class);

    private final WebPushSubscriptionRepository subscriptionRepository;
    private final WebPushProperties properties;
    private final ObjectMapper objectMapper;

    public WebPushDeliveryService(
            WebPushSubscriptionRepository subscriptionRepository,
            WebPushProperties properties,
            ObjectMapper objectMapper) {
        this.subscriptionRepository = subscriptionRepository;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    public void deliverNewOrder(UUID orderId, String displayCode, List<Long> recipientIds) {
        deliver(
                recipientIds,
                "Новый заказ #" + displayCode,
                "Поступил новый заказ.",
                "/admin/orders/" + orderId,
                "new-order-" + orderId);
    }

    public void deliverCustomerNotification(
            Long userId, String title, String message, String actionUrl, String tag) {
        if (userId == null) return;
        deliver(List.of(userId), title, message, actionUrl, tag);
    }

    private void deliver(
            List<Long> recipientIds, String title, String body, String actionUrl, String tag) {
        if (!properties.isConfigured() || recipientIds.isEmpty()) return;

        String payload = notificationPayload(title, body, actionUrl, tag);
        if (payload == null) return;

        PushService pushService;
        try {
            pushService = createPushService();
        } catch (GeneralSecurityException exception) {
            log.error("Web Push VAPID configuration is invalid", exception);
            return;
        }

        for (WebPushSubscription subscription :
                subscriptionRepository.findByUserIdIn(recipientIds)) {
            send(pushService, subscription, payload);
        }
    }

    PushService createPushService() throws GeneralSecurityException {
        addBouncyCastleProvider();
        return new PushService(
                properties.getPublicKey(), properties.getPrivateKey(), properties.getSubject());
    }

    private void addBouncyCastleProvider() {
        if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
            Security.addProvider(new BouncyCastleProvider());
        }
    }

    private void send(PushService pushService, WebPushSubscription subscription, String payload) {
        try {
            Subscription target =
                    new Subscription(
                            subscription.endpoint,
                            new Subscription.Keys(subscription.p256dh, subscription.auth));
            // The synchronous default in web-push 5.1.2 uses legacy aesgcm, rejected by FCM.
            HttpResponse response =
                    pushService.send(new Notification(target, payload), Encoding.AES128GCM);
            int status = response.getStatusLine().getStatusCode();
            if (status == 404 || status == 410) {
                subscriptionRepository.deleteById(subscription.id);
            } else if (status >= 300) {
                log.warn(
                        "Web Push delivery returned status {} for subscription {}",
                        status,
                        subscription.id);
            }
        } catch (Exception exception) {
            log.warn(
                    "Web Push delivery failed for subscription {} ({})",
                    subscription.id,
                    exception.getClass().getSimpleName());
        }
    }

    private String notificationPayload(String title, String body, String actionUrl, String tag) {
        Map<String, String> payload = new LinkedHashMap<>();
        payload.put("title", title);
        payload.put("body", body);
        payload.put("actionUrl", actionUrl);
        payload.put("tag", tag);
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            log.error("Could not create Web Push payload", exception);
            return null;
        }
    }
}
