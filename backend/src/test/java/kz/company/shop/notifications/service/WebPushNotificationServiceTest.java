package kz.company.shop.notifications.service;

import static org.mockito.Mockito.*;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import kz.company.shop.notifications.entity.Notification;
import kz.company.shop.notifications.entity.NotificationType;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.users.entity.User;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class WebPushNotificationServiceTest {
    private final WebPushDeliveryService delivery = mock(WebPushDeliveryService.class);
    private final WebPushNotificationService service = new WebPushNotificationService(delivery);

    @AfterEach
    void clearTransaction() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @ParameterizedTest
    @EnumSource(
            value = NotificationType.class,
            names = {"ORDER_STATUS_CHANGED", "ORDER_PRICE_REVIEW"})
    void sendsCustomerNotificationOnlyAfterCommitWithCapturedOwnerAndPayload(
            NotificationType type) {
        TransactionSynchronizationManager.initSynchronization();
        Notification notification = notification(type);
        String expectedTag =
                type.name().toLowerCase(java.util.Locale.ROOT) + "-" + notification.orderId;
        String expectedUrl = notification.actionUrl;

        service.publishCustomerNotification(notification);
        verifyNoInteractions(delivery);
        notification.userId = 999L;
        notification.message = "other content";
        var callbacks = TransactionSynchronizationManager.getSynchronizations();
        callbacks.forEach(TransactionSynchronization::afterCommit);
        callbacks.forEach(
                callback -> callback.afterCompletion(TransactionSynchronization.STATUS_COMMITTED));

        verify(delivery)
                .deliverCustomerNotification(
                        7L, "Заказ обновлён", "Новый статус", expectedUrl, expectedTag);
        verifyNoMoreInteractions(delivery);
    }

    @Test
    void preservesNewOrderRecipientsAndDeliversOnlyAfterCommit() {
        TransactionSynchronizationManager.initSynchronization();
        Order order = new Order();
        order.id = UUID.randomUUID();
        order.orderNumberDate = LocalDate.of(2026, 9, 29);
        order.dailyNumber = 5;
        User admin = new User();
        admin.id = 4L;

        service.publishNewOrderPush(order, List.of(admin, admin));
        verifyNoInteractions(delivery);
        TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);
        verify(delivery).deliverNewOrder(order.id, order.displayCode(), List.of(4L));
        verifyNoMoreInteractions(delivery);
    }

    @Test
    void doesNotSendCustomerNotificationWhenTransactionRollsBack() {
        TransactionSynchronizationManager.initSynchronization();
        service.publishCustomerNotification(notification(NotificationType.ORDER_STATUS_CHANGED));
        TransactionSynchronizationManager.getSynchronizations()
                .forEach(
                        callback ->
                                callback.afterCompletion(
                                        TransactionSynchronization.STATUS_ROLLED_BACK));
        verifyNoInteractions(delivery);
    }

    @Test
    void skipsCustomerNotificationWithoutAnOwner() {
        Notification notification = notification(NotificationType.ORDER_STATUS_CHANGED);
        notification.userId = null;
        service.publishCustomerNotification(notification);
        verifyNoInteractions(delivery);
    }

    private Notification notification(NotificationType type) {
        Notification notification = new Notification();
        notification.userId = 7L;
        notification.type = type;
        notification.orderId = UUID.randomUUID();
        notification.title = "Заказ обновлён";
        notification.message = "Новый статус";
        notification.actionUrl = "/orders/" + notification.orderId;
        return notification;
    }
}
