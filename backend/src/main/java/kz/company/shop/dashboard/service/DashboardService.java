package kz.company.shop.dashboard.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import kz.company.shop.audit.repository.AuditLogRepository;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.dashboard.dto.DashboardDto;
import kz.company.shop.integrations.onec.repository.IntegrationLogRepository;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.productViews.repository.ProductViewEventRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Qyzylorda");
    private static final DateTimeFormatter DAY_LABEL = DateTimeFormatter.ofPattern("dd.MM");

    private final OrderRepository orderRepository;
    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;
    private final ProductViewEventRepository viewRepository;
    private final AuditLogRepository auditRepository;
    private final IntegrationLogRepository integrationLogRepository;

    public DashboardService(
            OrderRepository orderRepository,
            ProductRepository productRepository,
            CategoryRepository categoryRepository,
            ProductViewEventRepository viewRepository,
            AuditLogRepository auditRepository,
            IntegrationLogRepository integrationLogRepository) {
        this.orderRepository = orderRepository;
        this.productRepository = productRepository;
        this.categoryRepository = categoryRepository;
        this.viewRepository = viewRepository;
        this.auditRepository = auditRepository;
        this.integrationLogRepository = integrationLogRepository;
    }

    public DashboardDto get(int requestedPeriod) {
        int period =
                switch (requestedPeriod) {
                    case 7, 30, 90 -> requestedPeriod;
                    default -> 30;
                };
        ZonedDateTime now = ZonedDateTime.now(BUSINESS_ZONE);
        ZonedDateTime currentStart =
                now.toLocalDate().minusDays(period - 1L).atStartOfDay(BUSINESS_ZONE);
        ZonedDateTime previousStart = currentStart.minusDays(period);
        Instant currentFrom = currentStart.toInstant();
        Instant previousFrom = previousStart.toInstant();
        Instant to = now.toInstant();

        long currentOrders =
                orderRepository.countByStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        OrderStatus.NEW, currentFrom, to);
        long previousOrders =
                orderRepository.countByStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        OrderStatus.NEW, previousFrom, currentFrom);
        long currentViews =
                viewRepository.countByViewedAtGreaterThanEqualAndViewedAtLessThan(currentFrom, to);
        long previousViews =
                viewRepository.countByViewedAtGreaterThanEqualAndViewedAtLessThan(
                        previousFrom, currentFrom);

        List<Order> paidOrders =
                orderRepository
                        .findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                                PaymentStatus.PAID, OrderStatus.COMPLETED, currentFrom, to)
                        // Keep the business rule explicit even if a repository implementation is
                        // changed later: only finalized sales belong to dashboard sales metrics.
                        .stream()
                        .filter(order -> order.status == OrderStatus.COMPLETED)
                        .toList();

        return new DashboardDto(
                period,
                new DashboardDto.MetricDto(currentOrders, trend(currentOrders, previousOrders)),
                productRepository.countByActiveTrueAndDeletedAtIsNull(),
                categoryRepository.countByActiveTrueAndDeletedAtIsNull(),
                new DashboardDto.MetricDto(currentViews, trend(currentViews, previousViews)),
                revenueSeries(
                        period,
                        currentStart.toLocalDate(),
                        now.toLocalDate(),
                        paidOrders,
                        incomingPricesForLegacyOrders(paidOrders)),
                productRepository
                        .findByDeletedAtIsNullOrderByCreatedAtDesc(PageRequest.of(0, 5))
                        .stream()
                        .map(
                                product ->
                                        new DashboardDto.RecentProductDto(
                                                product.id,
                                                product.sku,
                                                product.nameRu,
                                                product.price,
                                                product.active,
                                                product.createdAt))
                        .toList(),
                auditRepository.findAllByOrderByCreatedAtDesc(PageRequest.of(0, 5)).stream()
                        .map(
                                log ->
                                        new DashboardDto.AuditItemDto(
                                                log.id,
                                                log.actorName,
                                                log.action,
                                                log.entityType,
                                                log.entityId,
                                                log.description,
                                                log.createdAt))
                        .toList(),
                productRepository.countActiveWithoutImages(),
                integrationLogRepository.countErrors());
    }

    private List<DashboardDto.RevenuePointDto> revenueSeries(
            int period,
            LocalDate from,
            LocalDate to,
            List<Order> orders,
            Map<Long, BigDecimal> incomingPrices) {
        if (period == 90) return weeklyRevenue(from, to, orders, incomingPrices);
        Map<LocalDate, List<Order>> byDay =
                orders.stream()
                        .collect(
                                Collectors.groupingBy(
                                        order ->
                                                order.createdAt
                                                        .atZone(BUSINESS_ZONE)
                                                        .toLocalDate()));
        List<DashboardDto.RevenuePointDto> result = new ArrayList<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            List<Order> bucket = byDay.getOrDefault(day, List.of());
            result.add(point(day.toString(), DAY_LABEL.format(day), bucket, incomingPrices));
        }
        return result;
    }

    private List<DashboardDto.RevenuePointDto> weeklyRevenue(
            LocalDate from,
            LocalDate to,
            List<Order> orders,
            Map<Long, BigDecimal> incomingPrices) {
        List<DashboardDto.RevenuePointDto> result = new ArrayList<>();
        LocalDate cursor = from;
        while (!cursor.isAfter(to)) {
            LocalDate end = cursor.plusDays(6);
            if (end.isAfter(to)) end = to;
            LocalDate bucketStart = cursor;
            LocalDate bucketEnd = end;
            List<Order> bucket =
                    orders.stream()
                            .filter(
                                    order -> {
                                        LocalDate date =
                                                order.createdAt.atZone(BUSINESS_ZONE).toLocalDate();
                                        return !date.isBefore(bucketStart)
                                                && !date.isAfter(bucketEnd);
                                    })
                            .toList();
            result.add(
                    point(
                            bucketStart.toString(),
                            DAY_LABEL.format(bucketStart) + "–" + DAY_LABEL.format(bucketEnd),
                            bucket,
                            incomingPrices));
            cursor = end.plusDays(1);
        }
        return result;
    }

    private DashboardDto.RevenuePointDto point(
            String key, String label, List<Order> orders, Map<Long, BigDecimal> incomingPrices) {
        BigDecimal revenue =
                orders.stream().map(order -> order.total).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal netProfit = profitForOrders(orders, incomingPrices);
        return new DashboardDto.RevenuePointDto(key, label, revenue, netProfit, orders.size());
    }

    private Map<Long, BigDecimal> incomingPricesForLegacyOrders(List<Order> orders) {
        var productIds = new LinkedHashSet<Long>();
        for (Order order : orders) {
            for (OrderItem item : order.items) {
                if (!item.warehouseCostCalculated && item.incomingPrice == null && item.productId != null)
                    productIds.add(item.productId);
            }
        }
        if (productIds.isEmpty()) return Map.of();
        List<Product> products = productRepository.findByIdInAndDeletedAtIsNull(productIds);
        if (products == null || products.isEmpty()) return Map.of();
        return products.stream()
                .filter(product -> product.id != null && product.incomingPrice != null)
                .collect(Collectors.toMap(product -> product.id, product -> product.incomingPrice));
    }

    /**
     * Cost is never returned to the client. Lines without a known incoming cost remain in revenue
     * but are omitted from profit, so one incomplete product card cannot hide a whole day's result.
     */
    private BigDecimal profitForOrders(List<Order> orders, Map<Long, BigDecimal> incomingPrices) {
        BigDecimal result = BigDecimal.ZERO;
        for (Order order : orders) {
            for (OrderItem item : order.items) {
                BigDecimal incoming =
                        item.incomingPrice != null
                                ? item.incomingPrice
                                : item.warehouseCostCalculated || item.productId == null
                                        ? null
                                        : incomingPrices.get(item.productId);
                if (incoming == null) continue;
                BigDecimal sold =
                        item.confirmedLineTotal != null ? item.confirmedLineTotal : item.lineTotal;
                result = result.add(sold.subtract(incoming.multiply(item.quantity)));
            }
        }
        return result;
    }

    private Double trend(long current, long previous) {
        if (previous == 0) return null;
        return BigDecimal.valueOf(current - previous)
                .multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(previous), 1, RoundingMode.HALF_UP)
                .doubleValue();
    }
}
