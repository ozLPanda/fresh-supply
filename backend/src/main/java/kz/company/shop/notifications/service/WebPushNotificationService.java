package kz.company.shop.notifications.service;

import java.util.List;
import java.util.Locale;
import java.util.UUID;
import kz.company.shop.notifications.entity.Notification;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.users.entity.User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class WebPushNotificationService {
    private final WebPushDeliveryService deliveryService;

    public WebPushNotificationService(WebPushDeliveryService deliveryService) {
        this.deliveryService = deliveryService;
    }

    /**
     * Schedules a new-order push after the transaction which created the order commits
     * successfully. Call this from the checkout transaction, after the internal notifications have
     * been created.
     */
    public void publishNewOrderPush(Order order, List<User> recipients) {
        List<Long> recipientIds = recipients.stream().map(user -> user.id).distinct().toList();
        String displayCode = order.displayCode();
        UUID orderId = order.id;
        afterCommit(() -> deliveryService.deliverNewOrder(orderId, displayCode, recipientIds));
    }

    public void publishCustomerNotification(Notification notification) {
        Long userId = notification.userId;
        if (userId == null) return;
        String title = notification.title;
        String message = notification.message;
        String actionUrl = notification.actionUrl;
        String tag = notification.type.name().toLowerCase(Locale.ROOT) + "-" + notification.orderId;
        afterCommit(
                () ->
                        deliveryService.deliverCustomerNotification(
                                userId, title, message, actionUrl, tag));
    }

    private void afterCommit(Runnable delivery) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            delivery.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        delivery.run();
                    }
                });
    }
}
