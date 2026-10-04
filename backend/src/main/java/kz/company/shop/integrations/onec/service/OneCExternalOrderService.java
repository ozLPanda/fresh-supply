package kz.company.shop.integrations.onec.service;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashMap;
import java.util.Map;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.integrations.onec.dto.OneCOrderDto;
import kz.company.shop.integrations.onec.dto.OneCOrderItemDto;
import kz.company.shop.integrations.onec.entity.ExternalApiCredential;
import kz.company.shop.integrations.onec.repository.ExternalApiCredentialRepository;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.users.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OneCExternalOrderService {
    private static final String ORDERS_READ_PERMISSION = "orders.read";
    private static final String EXTERNAL_ORDER_ROUTE = "/api/integrations/1c/orders/{displayCode}";
    private static final DateTimeFormatter DISPLAY_DATE = DateTimeFormatter.BASIC_ISO_DATE;
    private static final String INVALID_API_KEY_MESSAGE = "Invalid external API key";

    private final ExternalApiCredentialRepository credentials;
    private final OrderRepository orders;
    private final UserRepository users;
    private final ExternalApiRequestLogService requestLogs;

    public OneCExternalOrderService(
            ExternalApiCredentialRepository credentials,
            OrderRepository orders,
            UserRepository users,
            ExternalApiRequestLogService requestLogs) {
        this.credentials = credentials;
        this.orders = orders;
        this.users = users;
        this.requestLogs = requestLogs;
    }

    @Transactional(readOnly = true)
    public OneCOrderDto findOrder(String accessCode, String displayCode) {
        ExternalApiCredential credential = null;
        try {
            credential = requireActiveCredential(accessCode);
            requireOrdersReadPermission(credential);
            Order order = findByDisplayCode(displayCode);
            OneCOrderDto response =
                    new OneCOrderDto(
                            order.displayCode(),
                            customerName(order),
                            order.contactPhone,
                            order.createdAt,
                            order.total,
                            order.items.size(),
                            order.items.stream()
                                    .map(item -> new OneCOrderItemDto(item.sku, item.quantity))
                                    .toList());
            logRequest(credential.id, displayCode, "SUCCESS");
            return response;
        } catch (RuntimeException exception) {
            logRequest(credential == null ? null : credential.id, displayCode, "FAILURE");
            throw exception;
        }
    }

    private ExternalApiCredential requireActiveCredential(String accessCode) {
        if (accessCode == null || accessCode.isBlank()) {
            throw new AppExceptions.Unauthorized(INVALID_API_KEY_MESSAGE);
        }
        ExternalApiCredential credential =
                credentials
                        .findByAccessCode(accessCode)
                        .orElseThrow(() -> new AppExceptions.Unauthorized(INVALID_API_KEY_MESSAGE));
        if (credential.revokedAt != null
                || (credential.expiresAt != null && !credential.expiresAt.isAfter(Instant.now()))) {
            throw new AppExceptions.Unauthorized(INVALID_API_KEY_MESSAGE);
        }
        return credential;
    }

    private void requireOrdersReadPermission(ExternalApiCredential credential) {
        boolean canReadOrders =
                credential.permissions.stream()
                        .anyMatch(permission -> ORDERS_READ_PERMISSION.equals(permission.code));
        if (!canReadOrders) {
            throw new AppExceptions.Forbidden(ORDERS_READ_PERMISSION);
        }
    }

    private void logRequest(Long credentialId, String displayCode, String status) {
        Map<String, Object> parameters = new LinkedHashMap<>();
        parameters.put("displayCode", displayCode);
        requestLogs.record(credentialId, "GET", EXTERNAL_ORDER_ROUTE, parameters, status);
    }

    private Order findByDisplayCode(String displayCode) {
        try {
            if (displayCode == null || !displayCode.matches("\\d{8}[1-9]\\d*")) {
                throw orderNotFound();
            }
            LocalDate orderDate = LocalDate.parse(displayCode.substring(0, 8), DISPLAY_DATE);
            long dailyNumber = Long.parseLong(displayCode.substring(8));
            return orders.findByOrderNumberDateAndDailyNumber(orderDate, dailyNumber)
                    .filter(order -> displayCode.equals(order.displayCode()))
                    .orElseThrow(this::orderNotFound);
        } catch (DateTimeParseException | NumberFormatException ex) {
            throw orderNotFound();
        }
    }

    private String customerName(Order order) {
        if (order.userId != null) {
            return users.findById(order.userId).map(user -> user.name).orElse(null);
        }
        if (order.pendingCustomerEmail != null) {
            return order.pendingCustomerEmail;
        }
        if (order.pendingCustomerPhone != null) {
            return order.pendingCustomerPhone;
        }
        if (order.createdByUserId != null) {
            return users.findById(order.createdByUserId).map(user -> user.name).orElse(null);
        }
        return null;
    }

    private AppExceptions.NotFound orderNotFound() {
        return new AppExceptions.NotFound("Order not found");
    }
}
