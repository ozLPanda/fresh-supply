package kz.company.shop.analytics.service;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import kz.company.shop.analytics.dto.SalesAnalyticsDto;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SalesAnalyticsService {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Almaty");
    private static final int MAX_DAYS = 3660;
    private static final long UNKNOWN_ID = -1L;

    private final OrderRepository orders;
    private final UserRepository users;
    private final ProductRepository products;
    private final CategoryRepository categories;

    public SalesAnalyticsService(
            OrderRepository orders,
            UserRepository users,
            ProductRepository products,
            CategoryRepository categories) {
        this.orders = orders;
        this.users = users;
        this.products = products;
        this.categories = categories;
    }

    @Transactional(readOnly = true)
    public SalesAnalyticsDto get(
            String requestedGroupBy, LocalDate requestedFrom, LocalDate requestedTo) {
        return get(requestedGroupBy, requestedFrom, requestedTo, null, null);
    }

    @Transactional(readOnly = true)
    public SalesAnalyticsDto get(
            String requestedGroupBy,
            LocalDate requestedFrom,
            LocalDate requestedTo,
            String dimension,
            Long entityId) {
        if (dimension != null && !Set.of("employees", "products", "categories").contains(dimension))
            throw new AppExceptions.BadRequest("Неизвестный разрез аналитики");
        if ((dimension == null) != (entityId == null))
            throw new AppExceptions.BadRequest("Укажите разрез и идентификатор вместе");
        GroupBy groupBy = GroupBy.from(requestedGroupBy);
        LocalDate today = LocalDate.now(BUSINESS_ZONE);
        LocalDate to = requestedTo == null ? today : requestedTo;
        LocalDate from = requestedFrom == null ? to.minusDays(29) : requestedFrom;
        if (from.isAfter(to))
            throw new AppExceptions.BadRequest("Дата начала не может быть позже даты окончания");
        if (from.plusDays(MAX_DAYS).isBefore(to))
            throw new AppExceptions.BadRequest("Период аналитики не может превышать 10 лет");

        Instant fromInstant = from.atStartOfDay(BUSINESS_ZONE).toInstant();
        Instant toExclusive = to.plusDays(1).atStartOfDay(BUSINESS_ZONE).toInstant();
        List<Order> paidOrders =
                orders
                        .findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                                PaymentStatus.PAID, OrderStatus.COMPLETED, fromInstant, toExclusive)
                        // Keep analytics aligned with dashboard metrics even if a repository
                        // implementation changes later: only finalized sales belong in revenue.
                        .stream()
                        .filter(
                                order ->
                                        order.status == OrderStatus.COMPLETED
                                                && order.paymentStatus == PaymentStatus.PAID
                                                && order.deletedAt == null)
                        .toList();
        List<Bucket> buckets = buckets(groupBy, from, to);
        Map<String, Bucket> bucketByKey =
                buckets.stream().collect(Collectors.toMap(Bucket::key, Function.identity()));

        Map<Long, String> employeeNames = employeeNames(paidOrders);
        Map<Long, Product> productById = productById(paidOrders);
        Map<Long, String> categoryNames = categoryNames(productById);

        List<Sale> orderSales =
                paidOrders.stream()
                        .map(
                                order ->
                                        orderSale(
                                                order,
                                                bucketByKey.get(
                                                        bucketKey(groupBy, order.createdAt)),
                                                productById))
                        .toList();
        List<Sale> productSales = new ArrayList<>();
        List<Sale> categorySales = new ArrayList<>();
        for (Order order : paidOrders) {
            Bucket bucket = bucketByKey.get(bucketKey(groupBy, order.createdAt));
            Map<Long, Sale> productSalesForOrder = new HashMap<>();
            Map<Long, Sale> categorySalesForOrder = new HashMap<>();
            for (OrderItem item : order.items) {
                BigDecimal revenue = soldAmount(item);
                Product product = item.productId == null ? null : productById.get(item.productId);
                BigDecimal netProfit = netProfitForItem(item, product);
                Long productId = item.productId == null ? UNKNOWN_ID : item.productId;
                Sale previousProduct = productSalesForOrder.get(productId);
                productSalesForOrder.put(
                        productId,
                        new Sale(
                                productId,
                                item.productId == null ? "Ручные позиции" : item.nameRu,
                                bucket,
                                order.createdAt,
                                1,
                                previousProduct == null
                                        ? item.quantity
                                        : previousProduct.items.add(item.quantity),
                                previousProduct == null
                                        ? revenue
                                        : previousProduct.revenue.add(revenue),
                                previousProduct == null
                                        ? netProfit
                                        : addNetProfit(previousProduct.netProfit, netProfit)));
                Long categoryId = product == null ? null : product.categoryId;
                String categoryName =
                        categoryId == null ? "Без категории" : categoryNames.get(categoryId);
                Long effectiveCategoryId = categoryId == null ? UNKNOWN_ID : categoryId;
                Sale existing = categorySalesForOrder.get(effectiveCategoryId);
                categorySalesForOrder.put(
                        effectiveCategoryId,
                        new Sale(
                                effectiveCategoryId,
                                categoryName,
                                bucket,
                                order.createdAt,
                                1,
                                existing == null
                                        ? item.quantity
                                        : existing.items.add(item.quantity),
                                existing == null ? revenue : existing.revenue.add(revenue),
                                existing == null
                                        ? netProfit
                                        : addNetProfit(existing.netProfit, netProfit)));
            }
            productSales.addAll(productSalesForOrder.values());
            categorySales.addAll(categorySalesForOrder.values());
        }

        List<Sale> selectedSales =
                dimension == null
                        ? orderSales
                        : switch (dimension) {
                            case "employees" -> orderSales;
                            case "products" -> productSales;
                            default -> categorySales;
                        };
        if (entityId != null)
            selectedSales =
                    selectedSales.stream().filter(sale -> entityId.equals(sale.id)).toList();
        return new SalesAnalyticsDto(
                groupBy.value,
                from.toString(),
                to.toString(),
                summary(selectedSales),
                series(buckets, selectedSales),
                dimension == null ? breakdown(buckets, orderSales, employeeNames) : List.of(),
                dimension == null ? breakdown(buckets, productSales, Map.of()) : List.of(),
                dimension == null ? breakdown(buckets, categorySales, Map.of()) : List.of(),
                profile(selectedSales, true),
                profile(selectedSales, false),
                activity(selectedSales),
                BUSINESS_ZONE.getId());
    }

    private List<SalesAnalyticsDto.SeriesPointDto> profile(List<Sale> sales, boolean monthly) {
        String[] labels =
                monthly
                        ? new String[] {
                            "Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт",
                            "Ноя", "Дек"
                        }
                        : new String[] {"Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"};
        List<Bucket> buckets = new ArrayList<>();
        for (int i = 0; i < labels.length; i++)
            buckets.add(new Bucket(Integer.toString(i + 1), labels[i]));
        List<Sale> adjusted =
                sales.stream()
                        .map(
                                sale -> {
                                    var date = sale.createdAt.atZone(BUSINESS_ZONE);
                                    int index =
                                            monthly
                                                    ? date.getMonthValue()
                                                    : date.getDayOfWeek().getValue();
                                    return new Sale(
                                            sale.id,
                                            sale.name,
                                            buckets.get(index - 1),
                                            sale.createdAt,
                                            sale.orders,
                                            sale.items,
                                            sale.revenue,
                                            sale.netProfit);
                                })
                        .toList();
        return series(buckets, adjusted);
    }

    private List<SalesAnalyticsDto.ActivityDto> activity(List<Sale> sales) {
        Map<Integer, List<Sale>> grouped =
                sales.stream()
                        .collect(
                                Collectors.groupingBy(
                                        sale -> {
                                            var date = sale.createdAt.atZone(BUSINESS_ZONE);
                                            return (date.getDayOfWeek().getValue() - 1) * 24
                                                    + date.getHour();
                                        }));
        List<SalesAnalyticsDto.ActivityDto> result = new ArrayList<>();
        for (int day = 1; day <= 7; day++)
            for (int hour = 0; hour < 24; hour++) {
                var total = summary(grouped.getOrDefault((day - 1) * 24 + hour, List.of()));
                result.add(
                        new SalesAnalyticsDto.ActivityDto(
                                day,
                                hour,
                                total.orders(),
                                total.items(),
                                total.revenue(),
                                total.netProfit()));
            }
        return result;
    }

    private Map<Long, String> employeeNames(List<Order> orders) {
        Set<Long> ids =
                orders.stream()
                        .map(order -> order.createdByUserId)
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet());
        Map<Long, String> result = new HashMap<>();
        users.findAllById(ids).forEach(user -> result.put(user.id, user.name));
        return result;
    }

    private Map<Long, Product> productById(List<Order> orders) {
        Set<Long> ids =
                orders.stream()
                        .flatMap(order -> order.items.stream())
                        .map(item -> item.productId)
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet());
        return products.findAllById(ids).stream()
                .collect(Collectors.toMap(product -> product.id, Function.identity()));
    }

    private Map<Long, String> categoryNames(Map<Long, Product> products) {
        Set<Long> ids =
                products.values().stream()
                        .map(product -> product.categoryId)
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet());
        return categories.findNamesRuByIdIn(ids).stream()
                .filter(
                        category ->
                                category.getId() != null
                                        && category.getNameRu() != null
                                        && !category.getNameRu().isBlank())
                .collect(
                        Collectors.toMap(
                                CategoryRepository.NameRuProjection::getId,
                                CategoryRepository.NameRuProjection::getNameRu,
                                (first, ignored) -> first));
    }

    private List<SalesAnalyticsDto.BreakdownDto> breakdown(
            List<Bucket> buckets, List<Sale> sales, Map<Long, String> names) {
        Map<Long, List<Sale>> grouped =
                sales.stream()
                        .collect(
                                Collectors.groupingBy(
                                        Sale::id, LinkedHashMap::new, Collectors.toList()));
        return grouped.entrySet().stream()
                .map(
                        entry -> {
                            Long id = entry.getKey();
                            String name =
                                    names.getOrDefault(id, entry.getValue().getFirst().name());
                            if (name == null || name.isBlank()) name = "Не указан";
                            return new SalesAnalyticsDto.BreakdownDto(
                                    id == UNKNOWN_ID ? null : id,
                                    name,
                                    summary(entry.getValue()).revenue(),
                                    summary(entry.getValue()).netProfit(),
                                    summary(entry.getValue()).orders(),
                                    summary(entry.getValue()).items(),
                                    series(buckets, entry.getValue()));
                        })
                .sorted(Comparator.comparing(SalesAnalyticsDto.BreakdownDto::revenue).reversed())
                .toList();
    }

    private SalesAnalyticsDto.SummaryDto summary(List<Sale> sales) {
        return new SalesAnalyticsDto.SummaryDto(
                sales.stream().map(Sale::revenue).reduce(BigDecimal.ZERO, BigDecimal::add),
                netProfit(sales),
                sales.stream().mapToLong(Sale::orders).sum(),
                sales.stream().map(Sale::items).reduce(BigDecimal.ZERO, BigDecimal::add));
    }

    private List<SalesAnalyticsDto.SeriesPointDto> series(List<Bucket> buckets, List<Sale> sales) {
        Map<String, List<Sale>> grouped =
                sales.stream().collect(Collectors.groupingBy(sale -> sale.bucket.key()));
        return buckets.stream()
                .map(
                        bucket -> {
                            SalesAnalyticsDto.SummaryDto summary =
                                    summary(grouped.getOrDefault(bucket.key, List.of()));
                            return new SalesAnalyticsDto.SeriesPointDto(
                                    bucket.key,
                                    bucket.label,
                                    summary.revenue(),
                                    summary.netProfit(),
                                    summary.orders(),
                                    summary.items());
                        })
                .toList();
    }

    private Sale orderSale(Order order, Bucket bucket, Map<Long, Product> productById) {
        return new Sale(
                order.createdByUserId == null ? UNKNOWN_ID : order.createdByUserId,
                order.createdByUserId == null
                        ? "Интернет-магазин"
                        : "Сотрудник #" + order.createdByUserId,
                bucket,
                order.createdAt,
                1,
                order.items.stream()
                        .map(item -> item.quantity)
                        .reduce(BigDecimal.ZERO, BigDecimal::add),
                order.items.stream().map(this::soldAmount).reduce(BigDecimal.ZERO, BigDecimal::add),
                netProfitForItems(order.items, productById));
    }

    private BigDecimal netProfitForItems(List<OrderItem> items, Map<Long, Product> productById) {
        BigDecimal result = BigDecimal.ZERO;
        for (OrderItem item : items) {
            Product product = item.productId == null ? null : productById.get(item.productId);
            BigDecimal itemNetProfit = netProfitForItem(item, product);
            // As on the dashboard, an incomplete product card must not hide an otherwise valid
            // profit total. The line remains in revenue but is omitted from profit.
            if (itemNetProfit == null) continue;
            result = result.add(itemNetProfit);
        }
        return result;
    }

    private BigDecimal netProfitForItem(OrderItem item, Product product) {
        BigDecimal incomingPrice =
                item.incomingPrice != null
                        ? item.incomingPrice
                        : item.warehouseCostCalculated || product == null ? null : product.incomingPrice;
        return incomingPrice == null
                ? null
                : soldAmount(item).subtract(incomingPrice.multiply(item.quantity));
    }

    private BigDecimal soldAmount(OrderItem item) {
        return item.confirmedLineTotal != null ? item.confirmedLineTotal : item.lineTotal;
    }

    private BigDecimal netProfit(List<Sale> sales) {
        return sales.stream()
                .map(Sale::netProfit)
                .filter(java.util.Objects::nonNull)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private BigDecimal addNetProfit(BigDecimal left, BigDecimal right) {
        if (left == null) return right;
        if (right == null) return left;
        return left.add(right);
    }

    private List<Bucket> buckets(GroupBy groupBy, LocalDate from, LocalDate to) {
        List<Bucket> result = new ArrayList<>();
        LocalDate cursor = groupBy.startOf(from);
        while (!cursor.isAfter(to)) {
            result.add(new Bucket(groupBy.key(cursor), groupBy.label(cursor)));
            cursor = groupBy.next(cursor);
        }
        return result;
    }

    private String bucketKey(GroupBy groupBy, Instant instant) {
        return groupBy.key(groupBy.startOf(instant.atZone(BUSINESS_ZONE).toLocalDate()));
    }

    private record Sale(
            Long id,
            String name,
            Bucket bucket,
            Instant createdAt,
            long orders,
            BigDecimal items,
            BigDecimal revenue,
            BigDecimal netProfit) {}

    private record Bucket(String key, String label) {}

    private enum GroupBy {
        DAY("day"),
        WEEK("week"),
        MONTH("month"),
        YEAR("year");

        private final String value;

        GroupBy(String value) {
            this.value = value;
        }

        static GroupBy from(String value) {
            for (GroupBy groupBy : values())
                if (groupBy.value.equalsIgnoreCase(value)) return groupBy;
            throw new AppExceptions.BadRequest(
                    "Параметр groupBy должен быть day, week, month или year");
        }

        LocalDate startOf(LocalDate date) {
            return switch (this) {
                case DAY -> date;
                case WEEK -> date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
                case MONTH -> date.withDayOfMonth(1);
                case YEAR -> date.withDayOfYear(1);
            };
        }

        LocalDate next(LocalDate date) {
            return switch (this) {
                case DAY -> date.plusDays(1);
                case WEEK -> date.plusWeeks(1);
                case MONTH -> date.plusMonths(1);
                case YEAR -> date.plusYears(1);
            };
        }

        String key(LocalDate date) {
            return switch (this) {
                case DAY -> date.toString();
                case WEEK -> date.toString();
                case MONTH -> YearMonth.from(date).toString();
                case YEAR -> Integer.toString(date.getYear());
            };
        }

        String label(LocalDate date) {
            return switch (this) {
                case DAY -> date.format(DateTimeFormatter.ofPattern("dd.MM.yyyy"));
                case WEEK ->
                        date.format(DateTimeFormatter.ofPattern("dd.MM"))
                                + "–"
                                + date.plusDays(6).format(DateTimeFormatter.ofPattern("dd.MM"));
                case MONTH ->
                        date.format(
                                DateTimeFormatter.ofPattern(
                                        "MMMM yyyy", java.util.Locale.forLanguageTag("ru")));
                case YEAR -> Integer.toString(date.getYear());
            };
        }
    }
}
