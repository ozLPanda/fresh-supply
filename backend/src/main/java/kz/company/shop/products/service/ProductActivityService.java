package kz.company.shop.products.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import kz.company.shop.audit.entity.AuditLog;
import kz.company.shop.audit.repository.AuditLogRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.products.dto.ProductActivityDto;
import kz.company.shop.products.dto.ProductActivityChangeDto;
import kz.company.shop.products.dto.ProductActivityFilterOptionsDto;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import kz.company.shop.warehouse.entity.StockDocument;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.entity.StockDocumentVersion;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.StockDocumentVersionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProductActivityService {
    private static final int MAX_PAGE_SIZE = 100;
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Qyzylorda");

    private final ProductRepository products;
    private final AuditLogRepository auditLogs;
    private final StockDocumentVersionRepository documentVersions;
    private final StockDocumentLineRepository documentLines;
    private final UserRepository users;
    private final ObjectMapper objectMapper;

    public ProductActivityService(
            ProductRepository products,
            AuditLogRepository auditLogs,
            StockDocumentVersionRepository documentVersions,
            StockDocumentLineRepository documentLines,
            UserRepository users,
            ObjectMapper objectMapper) {
        this.products = products;
        this.auditLogs = auditLogs;
        this.documentVersions = documentVersions;
        this.documentLines = documentLines;
        this.users = users;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public PageResult<ProductActivityDto> list(
            Long productId,
            Long actorUserId,
            LocalDate from,
            LocalDate to,
            Set<ProductActivityCategory> categories,
            Set<String> types,
            int page,
            int size) {
        validate(productId, actorUserId, from, to);
        List<ProductActivityDto> all = activity(productId);
        Set<String> normalizedTypes = normalizeTypes(types);
        List<ProductActivityDto> filtered =
                all.stream()
                        .filter(item -> actorUserId == null || actorUserId.equals(item.actorUserId()))
                        .filter(item -> categories == null || categories.isEmpty() || categories.contains(ProductActivityCategory.valueOf(item.category())))
                        .filter(item -> normalizedTypes.isEmpty() || normalizedTypes.contains(item.type()))
                        .filter(item -> insideDateRange(item.occurredAt(), from, to))
                        .sorted(Comparator.comparing(ProductActivityDto::occurredAt).reversed().thenComparing(ProductActivityDto::id))
                        .toList();
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 1);
        int start = Math.min((safePage - 1) * safeSize, filtered.size());
        int end = Math.min(start + safeSize, filtered.size());
        return new PageResult<>(
                filtered.subList(start, end),
                safePage,
                safeSize,
                filtered.size(),
                (int) Math.ceil((double) filtered.size() / safeSize));
    }

    @Transactional(readOnly = true)
    public ProductActivityFilterOptionsDto filterOptions(Long productId) {
        requireProduct(productId);
        List<ProductActivityDto> activity = activity(productId);
        Set<String> existingTypes =
                activity.stream()
                        .map(item -> item.category() + ":" + item.type())
                        .collect(Collectors.toCollection(LinkedHashSet::new));
        List<ProductActivityFilterOptionsDto.TypeOption> types =
                existingTypes.stream()
                        .map(
                                value -> {
                                    String[] parts = value.split(":", 2);
                                    return new ProductActivityFilterOptionsDto.TypeOption(
                                            parts[0], parts[1], typeLabel(parts[1]));
                                })
                        .toList();
        return new ProductActivityFilterOptionsDto(
                users.findActiveAdministrators().stream()
                        .map(user -> new ProductActivityFilterOptionsDto.UserOption(user.id, user.name))
                        .toList(),
                types);
    }

    private void validate(Long productId, Long actorUserId, LocalDate from, LocalDate to) {
        requireProduct(productId);
        if (from != null && to != null && from.isAfter(to)) {
            throw new AppExceptions.BadRequest("Дата начала не может быть позже даты окончания");
        }
        if (actorUserId != null
                && users.findActiveAdministrators().stream().noneMatch(user -> user.id.equals(actorUserId))) {
            throw new AppExceptions.BadRequest("Для фильтра можно выбрать только администратора");
        }
    }

    private void requireProduct(Long productId) {
        if (!products.existsByIdAndDeletedAtIsNull(productId)) {
            throw new AppExceptions.NotFound("Товар не найден");
        }
    }

    private List<ProductActivityDto> activity(Long productId) {
        List<ProductActivityDto> result = new ArrayList<>();
        for (AuditLog log : auditLogs.findByEntityTypeAndEntityIdOrderByCreatedAtDesc("PRODUCT", productId.toString())) {
            result.add(
                    new ProductActivityDto(
                            "audit:" + log.id,
                            ProductActivityCategory.PRODUCT_CHANGE.name(),
                            "PRODUCT",
                            log.action,
                            log.description,
                            auditChanges(log),
                            log.actorUserId,
                            log.actorName,
                            log.createdAt,
                            null,
                            null,
                            null));
        }

        Map<Long, String> names = employeeNames(documentActorIds(productId));
        for (Object[] row : documentVersions.findHistoryByProductId(productId)) {
            StockDocumentVersion version = (StockDocumentVersion) row[0];
            StockDocument document = (StockDocument) row[1];
            result.add(versionActivity(version, document, names));
        }
        // System-generated sales do not have document versions. They still represent a real
        // fulfilment fact, so expose their persisted posting metadata once.
        for (StockDocument document : documentLines.findDocumentsWithoutVersionsByProductId(productId)) {
            result.add(documentActivity(document, names));
        }
        return result;
    }

    private Collection<Long> documentActorIds(Long productId) {
        Set<Long> ids = new LinkedHashSet<>();
        for (Object[] row : documentVersions.findHistoryByProductId(productId)) {
            StockDocumentVersion version = (StockDocumentVersion) row[0];
            if (version.changedByUserId != null) ids.add(version.changedByUserId);
        }
        for (StockDocument document : documentLines.findDocumentsWithoutVersionsByProductId(productId)) {
            if (document.createdByUserId != null) ids.add(document.createdByUserId);
            if (document.postedByUserId != null) ids.add(document.postedByUserId);
            if (document.cancelledByUserId != null) ids.add(document.cancelledByUserId);
            if (document.deletedByUserId != null) ids.add(document.deletedByUserId);
        }
        return ids;
    }

    private Map<Long, String> employeeNames(Collection<Long> ids) {
        if (ids.isEmpty()) return Map.of();
        Map<Long, String> names = new LinkedHashMap<>();
        users.findAllById(ids).forEach(user -> names.put(user.id, user.name));
        return names;
    }

    private ProductActivityDto versionActivity(
            StockDocumentVersion version, StockDocument document, Map<Long, String> names) {
        ProductActivityCategory category = category(document.documentType);
        return new ProductActivityDto(
                "document-version:" + version.id,
                category.name(),
                document.documentType.name(),
                version.action,
                version.changeSummary,
                List.of(),
                version.changedByUserId,
                actorName(version.changedByUserId, names),
                version.createdAt,
                document.id.toString(),
                document.documentNumber,
                uuid(document.sourceOrderId));
    }

    private ProductActivityDto documentActivity(StockDocument document, Map<Long, String> names) {
        Long actorId = document.postedByUserId != null ? document.postedByUserId : document.createdByUserId;
        Instant occurredAt = document.postedAt != null ? document.postedAt : document.createdAt;
        String action = document.postedAt != null ? "POST" : "CREATE";
        String description =
                document.documentType == StockDocumentType.SALE
                        ? "Отпуск товара по заказу"
                        : "Создан документ без истории версий";
        return new ProductActivityDto(
                "document:" + document.id + ":" + action,
                category(document.documentType).name(),
                document.documentType.name(),
                action,
                description,
                List.of(),
                actorId,
                actorName(actorId, names),
                occurredAt,
                document.id.toString(),
                document.documentNumber,
                uuid(document.sourceOrderId));
    }

    private static ProductActivityCategory category(StockDocumentType type) {
        if (type == StockDocumentType.SALE) return ProductActivityCategory.ORDER_FULFILLMENT;
        if (type == StockDocumentType.PRICE_SETTING) return ProductActivityCategory.PRODUCT_CHANGE;
        return ProductActivityCategory.DOCUMENT;
    }

    private static String actorName(Long userId, Map<Long, String> names) {
        return userId == null ? "Система" : names.getOrDefault(userId, "Пользователь #" + userId);
    }

    private static String uuid(UUID value) {
        return value == null ? null : value.toString();
    }

    private static Set<String> normalizeTypes(Set<String> types) {
        if (types == null) return Set.of();
        return types.stream()
                .filter(value -> value != null && !value.isBlank())
                .map(value -> value.trim().toUpperCase())
                .collect(Collectors.toSet());
    }

    private static boolean insideDateRange(Instant occurredAt, LocalDate from, LocalDate to) {
        LocalDate date = occurredAt.atZone(BUSINESS_ZONE).toLocalDate();
        return (from == null || !date.isBefore(from)) && (to == null || !date.isAfter(to));
    }

    private static String typeLabel(String type) {
        return switch (type) {
            case "PRODUCT" -> "Изменения товара";
            case "PRICE_SETTING" -> "Установка цен";
            case "RECEIPT" -> "Приход";
            case "PURCHASE_ORDER" -> "Заказ поставщику";
            case "OPENING_BALANCE" -> "Начальные остатки";
            case "INVENTORY" -> "Инвентаризация";
            case "CUSTOMER_RETURN" -> "Возврат покупателя";
            case "SALE" -> "Отпуск в заказе";
            default -> type;
        };
    }

    private List<ProductActivityChangeDto> auditChanges(AuditLog log) {
        if (log.details == null || log.details.isBlank()) return List.of();
        try {
            return objectMapper.readValue(
                    log.details, new TypeReference<List<ProductActivityChangeDto>>() {});
        } catch (Exception ignored) {
            return List.of();
        }
    }
}
