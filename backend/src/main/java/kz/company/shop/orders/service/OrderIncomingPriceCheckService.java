package kz.company.shop.orders.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.dto.OrderIncomingPriceCheckDto;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.priceStatistics.repository.PriceChangeSnapshotRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderIncomingPriceCheckService {
    private static final ZoneId ORDER_TIME_ZONE = ZoneId.of("Asia/Almaty");

    private final OrderRepository orders;
    private final PriceChangeSnapshotRepository priceSnapshots;

    public OrderIncomingPriceCheckService(
            OrderRepository orders, PriceChangeSnapshotRepository priceSnapshots) {
        this.orders = orders;
        this.priceSnapshots = priceSnapshots;
    }

    @Transactional(readOnly = true)
    public OrderIncomingPriceCheckDto check(UUID orderId) {
        Order order =
                orders.findWithItemsById(orderId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Заказ не найден"));
        if (order.status == OrderStatus.COMPLETED || order.status == OrderStatus.CANCELLED) {
            return new OrderIncomingPriceCheckDto(false, List.of());
        }

        LocalDate orderDate =
                order.orderNumberDate != null
                        ? order.orderNumberDate
                        : order.createdAt.atZone(ORDER_TIME_ZONE).toLocalDate();
        Instant endExclusive = orderDate.plusDays(1).atStartOfDay(ORDER_TIME_ZONE).toInstant();
        List<OrderIncomingPriceCheckDto.Problem> problems =
                order.items.stream()
                        .flatMap(
                                item ->
                                        belowIncomingPrice(item, endExclusive)
                                                .map(
                                                        incomingPrice ->
                                                                new OrderIncomingPriceCheckDto
                                                                        .Problem(
                                                                        item.id, incomingPrice))
                                                .stream())
                        .toList();
        return new OrderIncomingPriceCheckDto(true, problems);
    }

    private Optional<BigDecimal> belowIncomingPrice(OrderItem item, Instant endExclusive) {
        if (item.id == null || item.unitPrice == null) return Optional.empty();
        return incomingPriceForDate(item, endExclusive)
                .filter(incomingPrice -> item.unitPrice.compareTo(incomingPrice) < 0);
    }

    private Optional<BigDecimal> incomingPriceForDate(OrderItem item, Instant endExclusive) {
        if (item.productId == null) return Optional.ofNullable(item.incomingPrice);

        List<BigDecimal> effectivePrices =
                priceSnapshots.findIncomingPricesEffectiveBefore(item.productId, endExclusive);
        if (!effectivePrices.isEmpty()) return Optional.ofNullable(effectivePrices.getFirst());

        List<BigDecimal> nextPrices =
                priceSnapshots.findIncomingPricesStartingAt(item.productId, endExclusive);
        if (!nextPrices.isEmpty()) return Optional.ofNullable(nextPrices.getFirst());

        // Imports were added after some historical orders.  Their own immutable
        // cost snapshot is the only safe fallback; never compare with current cost.
        return Optional.ofNullable(item.incomingPrice);
    }
}
