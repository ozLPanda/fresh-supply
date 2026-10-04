package kz.company.shop.orders.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import kz.company.shop.audit.entity.AuditLog;
import kz.company.shop.audit.repository.AuditLogRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.orders.dto.OrderActivityChangeDto;
import kz.company.shop.orders.dto.OrderActivityDto;
import kz.company.shop.orders.dto.OrderActivityFilterOptionsDto;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.users.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read model for the history button on the order card. Audit records remain the source of truth. */
@Service
public class OrderActivityService {
    private static final int MAX_PAGE_SIZE = 100;
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Qyzylorda");

    private final OrderRepository orders;
    private final AuditLogRepository auditLogs;
    private final UserRepository users;
    private final ObjectMapper objectMapper;

    public OrderActivityService(
            OrderRepository orders,
            AuditLogRepository auditLogs,
            UserRepository users,
            ObjectMapper objectMapper) {
        this.orders = orders;
        this.auditLogs = auditLogs;
        this.users = users;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public PageResult<OrderActivityDto> list(
            java.util.UUID orderId,
            Long actorUserId,
            LocalDate from,
            LocalDate to,
            Set<OrderActivityCategory> categories,
            Set<String> actions,
            int page,
            int size) {
        validate(orderId, actorUserId, from, to);
        Set<String> normalizedActions = normalize(actions);
        List<OrderActivityDto> filtered = activity(orderId).stream()
                .filter(item -> actorUserId == null || actorUserId.equals(item.actorUserId()))
                .filter(item -> categories == null || categories.isEmpty()
                        || categories.contains(OrderActivityCategory.valueOf(item.category())))
                .filter(item -> normalizedActions.isEmpty() || normalizedActions.contains(item.action()))
                .filter(item -> insideDateRange(item.occurredAt(), from, to))
                .sorted(Comparator.comparing(OrderActivityDto::occurredAt).reversed()
                        .thenComparing(OrderActivityDto::id))
                .toList();
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 1);
        int start = Math.min((safePage - 1) * safeSize, filtered.size());
        int end = Math.min(start + safeSize, filtered.size());
        return new PageResult<>(filtered.subList(start, end), safePage, safeSize, filtered.size(),
                (int) Math.ceil((double) filtered.size() / safeSize));
    }

    @Transactional(readOnly = true)
    public OrderActivityFilterOptionsDto filterOptions(java.util.UUID orderId) {
        requireOrder(orderId);
        List<OrderActivityFilterOptionsDto.ActionOption> actions = activity(orderId).stream()
                .map(item -> new OrderActivityFilterOptionsDto.ActionOption(
                        item.category(), item.action(), actionLabel(item.action())))
                .collect(Collectors.collectingAndThen(
                        Collectors.toMap(
                                item -> item.category() + ":" + item.value(),
                                item -> item,
                                (left, ignored) -> left,
                                java.util.LinkedHashMap::new),
                        map -> List.copyOf(map.values())));
        return new OrderActivityFilterOptionsDto(
                users.findActiveAdministrators().stream()
                        .map(user -> new OrderActivityFilterOptionsDto.UserOption(user.id, user.name))
                        .toList(),
                actions);
    }

    private List<OrderActivityDto> activity(java.util.UUID orderId) {
        return auditLogs.findByEntityTypeAndEntityIdOrderByCreatedAtDesc("ORDER", orderId.toString())
                .stream()
                .map(log -> new OrderActivityDto(
                        "audit:" + log.id,
                        category(log.action).name(),
                        log.action,
                        log.description,
                        changes(log),
                        log.actorUserId,
                        log.actorName,
                        log.createdAt))
                .toList();
    }

    private void validate(java.util.UUID orderId, Long actorUserId, LocalDate from, LocalDate to) {
        requireOrder(orderId);
        if (from != null && to != null && from.isAfter(to)) {
            throw new AppExceptions.BadRequest("Дата начала не может быть позже даты окончания");
        }
        if (actorUserId != null && users.findActiveAdministrators().stream()
                .noneMatch(user -> user.id.equals(actorUserId))) {
            throw new AppExceptions.BadRequest("Для фильтра можно выбрать только администратора");
        }
    }

    private void requireOrder(java.util.UUID orderId) {
        if (!orders.existsById(orderId)) throw new AppExceptions.NotFound("Заказ не найден");
    }

    private List<OrderActivityChangeDto> changes(AuditLog log) {
        if (log.details == null || log.details.isBlank()) return List.of();
        try {
            return objectMapper.readValue(log.details, new TypeReference<List<OrderActivityChangeDto>>() {});
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private static Set<String> normalize(Set<String> values) {
        if (values == null) return Set.of();
        return values.stream().filter(value -> value != null && !value.isBlank())
                .map(value -> value.trim().toUpperCase()).collect(Collectors.toSet());
    }

    private static boolean insideDateRange(Instant at, LocalDate from, LocalDate to) {
        LocalDate date = at.atZone(BUSINESS_ZONE).toLocalDate();
        return (from == null || !date.isBefore(from)) && (to == null || !date.isAfter(to));
    }

    private static OrderActivityCategory category(String action) {
        if (action.startsWith("PAYMENT") || action.equals("PRICE_CONFIRM")) return OrderActivityCategory.PAYMENT;
        if (action.startsWith("FULFILLMENT") || action.equals("STOCK_SHORTAGE_RELEASE")) return OrderActivityCategory.FULFILLMENT;
        return OrderActivityCategory.ORDER_CHANGE;
    }

    private static String actionLabel(String action) {
        return switch (action) {
            case "STATUS_CHANGE" -> "Изменение статуса";
            case "PRICE_REVIEW", "PRICE_DOCUMENT_UPDATE" -> "Актуализация цен";
            case "PRICE_CONFIRM" -> "Подтверждение цен";
            case "PAYMENT_COMPLETE" -> "Подтверждение оплаты";
            case "PAYMENT_METHOD_UPDATE" -> "Изменение способа оплаты";
            case "COMMENT_UPDATE" -> "Изменение комментария";
            case "PRINT_COMMENT_UPDATE" -> "Изменение комментария для накладной";
            case "FULFILLMENT_ASSIGNEES" -> "Назначение ответственных";
            case "FULFILLMENT_ITEM" -> "Сборка и проверка позиции";
            case "MANUAL_ITEM_ADD" -> "Добавление ручной позиции";
            case "CATALOG_ITEM_ADD" -> "Добавление товара";
            case "ORDER_ITEM_QUANTITY_UPDATE" -> "Изменение количества";
            case "ORDER_ITEM_ORDER_UPDATE" -> "Изменение порядка позиций";
            case "ORDER_ITEM_DELETE" -> "Удаление позиции";
            case "ORDER_COPY" -> "Создание копии заказа";
            case "RESERVATION_CREATED" -> "Создание резерва";
            case "RESERVATION_EXTENDED" -> "Изменение срока резерва";
            case "RESERVATION_EXPIRED" -> "Автоматическое снятие резерва";
            case "SOFT_DELETE" -> "Скрытие заказа";
            case "STOCK_SHORTAGE_RELEASE" -> "Отпуск с расхождением по остаткам";
            default -> action;
        };
    }
}
