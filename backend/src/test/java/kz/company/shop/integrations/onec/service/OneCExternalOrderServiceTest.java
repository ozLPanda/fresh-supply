package kz.company.shop.integrations.onec.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.integrations.onec.entity.ExternalApiCredential;
import kz.company.shop.integrations.onec.repository.ExternalApiCredentialRepository;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.permissions.entity.Permission;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import org.junit.jupiter.api.Test;

class OneCExternalOrderServiceTest {
    private final ExternalApiCredentialRepository credentials =
            mock(ExternalApiCredentialRepository.class);
    private final OrderRepository orders = mock(OrderRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final ExternalApiRequestLogService requestLogs =
            mock(ExternalApiRequestLogService.class);
    private final OneCExternalOrderService service =
            new OneCExternalOrderService(credentials, orders, users, requestLogs);

    @Test
    void returnsOrderForActiveCredentialWithOrdersReadPermission() {
        when(credentials.findByAccessCode("integration-key"))
                .thenReturn(Optional.of(credentialWithOrdersRead()));

        Order order = order();
        when(orders.findByOrderNumberDateAndDailyNumber(LocalDate.of(2026, 8, 3), 54L))
                .thenReturn(Optional.of(order));
        User customer = new User();
        customer.name = "Customer";
        when(users.findById(7L)).thenReturn(Optional.of(customer));

        var response = service.findOrder("integration-key", "2026080354");

        assertEquals("2026080354", response.code());
        assertEquals("Customer", response.customer());
        assertEquals("+77001234567", response.contactPhone());
        assertEquals(new BigDecimal("1500.00"), response.total());
        assertEquals(2, response.itemCount());
        assertEquals(
                List.of("SKU-1", "SKU-2"),
                response.items().stream().map(item -> item.sku()).toList());
        assertEquals(
                List.of(BigDecimal.ONE, BigDecimal.valueOf(3)),
                response.items().stream().map(item -> item.quantity()).toList());
        verify(requestLogs)
                .record(
                        eq(8L),
                        eq("GET"),
                        eq("/api/integrations/1c/orders/{displayCode}"),
                        any(),
                        eq("SUCCESS"));
    }

    @Test
    void rejectsMissingOrInactiveCredentialWithoutLookingUpOrder() {
        assertThrows(AppExceptions.Unauthorized.class, () -> service.findOrder(null, "2026080354"));
    }

    @Test
    void rejectsCredentialWithoutOrdersReadPermission() {
        ExternalApiCredential credential = new ExternalApiCredential();
        when(credentials.findByAccessCode("limited-key")).thenReturn(Optional.of(credential));

        assertThrows(
                AppExceptions.Forbidden.class,
                () -> service.findOrder("limited-key", "2026080354"));
    }

    private ExternalApiCredential credentialWithOrdersRead() {
        Permission permission = new Permission();
        permission.code = "orders.read";
        ExternalApiCredential credential = new ExternalApiCredential();
        credential.id = 8L;
        credential.permissions = Set.of(permission);
        return credential;
    }

    private Order order() {
        OrderItem first = new OrderItem();
        first.sku = "SKU-1";
        first.quantity = BigDecimal.ONE;
        OrderItem second = new OrderItem();
        second.sku = "SKU-2";
        second.quantity = BigDecimal.valueOf(3);

        Order order = new Order();
        order.orderNumberDate = LocalDate.of(2026, 8, 3);
        order.dailyNumber = 54;
        order.userId = 7L;
        order.contactPhone = "+77001234567";
        order.createdAt = Instant.parse("2026-08-03T09:12:00Z");
        order.total = new BigDecimal("1500.00");
        order.items = List.of(first, second);
        return order;
    }
}
