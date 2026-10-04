package kz.company.shop.notifications.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import kz.company.shop.notifications.entity.Notification;
import kz.company.shop.notifications.entity.NotificationType;
import kz.company.shop.notifications.repository.NotificationRepository;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.roles.entity.Role;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;

class NotificationServiceTest {
    private final NotificationRepository repository = mock(NotificationRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final OrderRepository orders = mock(OrderRepository.class);
    private final WebPushNotificationService webPush = mock(WebPushNotificationService.class);
    private final NotificationService service =
            new NotificationService(repository, users, orders, webPush);

    @Test
    void createsNewOrderNotificationForEveryOrderManager() {
        User firstAdmin = user(1L, "Первый администратор");
        User secondAdmin = user(2L, "Второй администратор");
        User customer = user(7L, "Александр");
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000042");
        Order order = order(orderId, customer.id, OrderStatus.NEW);
        when(users.findActiveWithPermission("orders.read"))
                .thenReturn(List.of(firstAdmin, secondAdmin));
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Notification>> captor = ArgumentCaptor.forClass(List.class);

        service.notifyAdminsAboutNewOrder(order, customer);

        verify(repository).saveAll(captor.capture());
        verify(webPush).publishNewOrderPush(order, List.of(firstAdmin, secondAdmin));
        assertThat(captor.getValue())
                .hasSize(2)
                .allSatisfy(
                        notification -> {
                            assertThat(notification.type).isEqualTo(NotificationType.NEW_ORDER);
                            assertThat(notification.orderId).isEqualTo(orderId);
                            assertThat(notification.actionUrl)
                                    .isEqualTo("/admin/orders/" + orderId);
                            assertThat(notification.message).contains("Александр");
                        });
    }

    @Test
    void doesNotCreateNewOrderNotificationsForAdministratorOrder() {
        User administrator = user(7L, "Администратор");
        Role administratorRole = new Role();
        administratorRole.code = "administrator";
        administrator.roles.add(administratorRole);
        Order order = order(UUID.randomUUID(), administrator.id, OrderStatus.NEW);

        service.notifyAdminsAboutNewOrder(order, administrator);

        verify(repository, org.mockito.Mockito.never()).saveAll(org.mockito.Mockito.anyList());
        verify(webPush, org.mockito.Mockito.never())
                .publishNewOrderPush(org.mockito.Mockito.any(), org.mockito.Mockito.anyList());
    }

    @Test
    void createsCustomerNotificationWithHumanReadableStatus() {
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000051");
        Order order = order(orderId, 9L, OrderStatus.COMPLETED);
        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);

        service.notifyCustomerAboutStatus(order);

        verify(repository).save(captor.capture());
        verify(webPush).publishCustomerNotification(captor.getValue());
        assertThat(captor.getValue().userId).isEqualTo(9L);
        assertThat(captor.getValue().type).isEqualTo(NotificationType.ORDER_STATUS_CHANGED);
        assertThat(captor.getValue().message).contains("Завершён");
        assertThat(captor.getValue().actionUrl).isEqualTo("/orders/" + orderId);
    }

    @Test
    void sendsPriceReviewPushOnlyToTheOrderOwner() {
        UUID orderId = UUID.randomUUID();
        Order order = order(orderId, 9L, OrderStatus.PRICE_REVIEW);
        ArgumentCaptor<Notification> captor = ArgumentCaptor.forClass(Notification.class);

        service.notifyCustomerAboutPriceReview(order);

        verify(repository).save(captor.capture());
        verify(webPush).publishCustomerNotification(captor.getValue());
        assertThat(captor.getValue().userId).isEqualTo(9L);
        assertThat(captor.getValue().type).isEqualTo(NotificationType.ORDER_PRICE_REVIEW);
        assertThat(captor.getValue().actionUrl).isEqualTo("/orders/" + orderId);
        org.mockito.Mockito.verifyNoInteractions(users);
    }

    @Test
    void doesNotNotifyCustomersForOrdersWithoutAnOwner() {
        Order order = order(UUID.randomUUID(), null, OrderStatus.NEW);
        service.notifyCustomerAboutStatus(order);
        service.notifyCustomerAboutPriceReview(order);
        org.mockito.Mockito.verifyNoInteractions(repository, webPush);
    }

    @Test
    void returnsAnEmptyListWhenTheUserHasNoNotifications() {
        when(repository.findByUserIdOrderByCreatedAtDesc(7L, PageRequest.of(0, 30)))
                .thenReturn(List.of());

        var result = service.list(7L);

        assertThat(result.items()).isEmpty();
        assertThat(result.unreadCount()).isZero();
    }

    private User user(Long id, String name) {
        User user = new User();
        user.id = id;
        user.name = name;
        return user;
    }

    private Order order(UUID id, Long userId, OrderStatus status) {
        Order order = new Order();
        order.id = id;
        order.orderNumberDate = LocalDate.of(2026, 8, 3);
        order.dailyNumber = 42;
        order.userId = userId;
        order.status = status;
        order.total = new BigDecimal("48500.00");
        return order;
    }
}
