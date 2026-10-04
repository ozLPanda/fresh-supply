package kz.company.shop.notifications.service;

import java.text.NumberFormat;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.notifications.dto.NotificationDto;
import kz.company.shop.notifications.dto.NotificationListDto;
import kz.company.shop.notifications.entity.Notification;
import kz.company.shop.notifications.entity.NotificationType;
import kz.company.shop.notifications.repository.NotificationRepository;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {
    private static final int MAX_ITEMS = 30;

    private final NotificationRepository repository;
    private final UserRepository userRepository;
    private final OrderRepository orderRepository;
    private final WebPushNotificationService webPushNotificationService;

    public NotificationService(
            NotificationRepository repository,
            UserRepository userRepository,
            OrderRepository orderRepository,
            WebPushNotificationService webPushNotificationService) {
        this.repository = repository;
        this.userRepository = userRepository;
        this.orderRepository = orderRepository;
        this.webPushNotificationService = webPushNotificationService;
    }

    @Transactional
    public void notifyAdminsAboutNewOrder(Order order, User customer) {
        if (customer == null
                || customer.roles.stream().anyMatch(role -> "administrator".equals(role.code))) {
            return;
        }
        String customerName = customer.name;
        List<User> recipients = userRepository.findActiveWithPermission("orders.read");
        List<Notification> notifications =
                recipients.stream()
                        .map(
                                admin ->
                                        create(
                                                admin.id,
                                                NotificationType.NEW_ORDER,
                                                "Новый заказ #" + order.displayCode(),
                                                customerName
                                                        + " оформил заказ на сумму "
                                                        + formatAmount(order)
                                                        + " ₸",
                                                order.id,
                                                "/admin/orders/" + order.id))
                        .toList();
        repository.saveAll(notifications);
        webPushNotificationService.publishNewOrderPush(order, recipients);
    }

    @Transactional
    public void notifyCustomerAboutStatus(Order order) {
        if (order.userId == null) return;
        Notification notification =
                create(
                        order.userId,
                        NotificationType.ORDER_STATUS_CHANGED,
                        "Статус заказа #" + order.displayCode() + " изменён",
                        "Новый статус: " + statusLabel(order.status),
                        order.id,
                        "/orders/" + order.id);
        repository.save(notification);
        webPushNotificationService.publishCustomerNotification(notification);
    }

    @Transactional
    public void notifyCustomerAboutPriceReview(Order order) {
        if (order.userId == null) return;
        Notification notification =
                create(
                        order.userId,
                        NotificationType.ORDER_PRICE_REVIEW,
                        "Цены заказа #" + order.displayCode() + " изменены",
                        "Проверьте актуальные цены и подтвердите заказ.",
                        order.id,
                        "/orders/" + order.id);
        repository.save(notification);
        webPushNotificationService.publishCustomerNotification(notification);
    }

    @Transactional
    public void notifyAdminsAboutPriceConfirmation(Order order, User customer) {
        String customerName = customer != null ? customer.name : "Клиент";
        List<Notification> notifications =
                userRepository.findActiveWithPermission("orders.read").stream()
                        .map(
                                admin ->
                                        create(
                                                admin.id,
                                                NotificationType.ORDER_PRICE_CONFIRMED,
                                                "Цены заказа #"
                                                        + order.displayCode()
                                                        + " подтверждены",
                                                customerName
                                                        + " подтвердил актуальные цены заказа.",
                                                order.id,
                                                "/admin/orders/" + order.id))
                        .toList();
        repository.saveAll(notifications);
    }

    @Transactional(readOnly = true)
    public NotificationListDto list(Long userId) {
        List<Notification> notifications =
                repository.findByUserIdOrderByCreatedAtDesc(userId, PageRequest.of(0, MAX_ITEMS));
        if (notifications.isEmpty()) {
            return new NotificationListDto(List.of(), 0);
        }
        List<NotificationDto> items = notifications.stream().map(this::toDto).toList();
        return new NotificationListDto(items, repository.countByUserIdAndReadAtIsNull(userId));
    }

    @Transactional
    public NotificationDto markRead(Long userId, Long id) {
        Notification notification =
                repository
                        .findByIdAndUserId(id, userId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Уведомление не найдено"));
        if (notification.readAt == null) {
            notification.readAt = Instant.now();
            repository.save(notification);
        }
        return toDto(notification);
    }

    @Transactional
    public void markAllRead(Long userId) {
        repository.markAllRead(userId, Instant.now());
    }

    private Notification create(
            Long userId,
            NotificationType type,
            String title,
            String message,
            UUID orderId,
            String actionUrl) {
        Notification notification = new Notification();
        notification.userId = userId;
        notification.type = type;
        notification.title = title;
        notification.message = message;
        notification.orderId = orderId;
        notification.actionUrl = actionUrl;
        return notification;
    }

    private String statusLabel(OrderStatus status) {
        return switch (status) {
            case NEW -> "Новый";
            case PRICE_REVIEW -> "Уточнение цен";
            case PROCESSING -> "В работе";
            case READY_FOR_PICKUP -> "Готов к выдаче";
            case COMPLETED -> "Завершён";
            case CANCELLED -> "Отменён";
        };
    }

    private String formatAmount(Order order) {
        NumberFormat formatter = NumberFormat.getNumberInstance(Locale.forLanguageTag("ru-KZ"));
        formatter.setMinimumFractionDigits(0);
        formatter.setMaximumFractionDigits(2);
        return formatter.format(order.total);
    }

    private NotificationDto toDto(Notification notification) {
        return new NotificationDto(
                notification.id,
                notification.type,
                notification.title,
                notification.message,
                notification.orderId,
                orderDisplayCode(notification.orderId),
                notification.actionUrl,
                notification.readAt != null,
                notification.createdAt);
    }

    private String orderDisplayCode(UUID orderId) {
        if (orderId == null) return null;
        return orderRepository
                .findByIdAndDeletedAtIsNull(orderId)
                .map(Order::displayCode)
                .orElse(null);
    }
}
