package kz.company.shop.orders.service;

import java.math.BigDecimal;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.dto.OrderReturnStatisticDto;
import kz.company.shop.orders.dto.OrderReturnSummaryDto;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.warehouse.entity.StockDocumentLine;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.StockDocumentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Reads the customer-return ledger for one order. The original order is intentionally immutable. */
@Service
public class OrderReturnSummaryService {
    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final OrderRepository orders;
    private final StockDocumentRepository documents;
    private final StockDocumentLineRepository lines;

    public OrderReturnSummaryService(
            OrderRepository orders,
            StockDocumentRepository documents,
            StockDocumentLineRepository lines) {
        this.orders = orders;
        this.documents = documents;
        this.lines = lines;
    }

    @Transactional(readOnly = true)
    public OrderReturnSummaryDto summary(UUID orderId) {
        Order order =
                orders.findWithItemsById(orderId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Заказ не найден"));
        Map<Long, OrderItem> itemsById = new LinkedHashMap<>();
        for (OrderItem item : order.items) {
            if (item.id != null) itemsById.put(item.id, item);
        }

        Map<Long, BigDecimal> returnedQuantity = new HashMap<>();
        Map<Long, BigDecimal> returnedAmount = new HashMap<>();
        List<OrderReturnSummaryDto.Document> returnDocuments = new ArrayList<>();
        for (var document : documents.findPostedCustomerReturnsBySourceOrderId(order.id)) {
            List<OrderReturnSummaryDto.Line> documentLines = new ArrayList<>();
            BigDecimal documentTotal = ZERO;
            for (StockDocumentLine line : lines.findByDocumentIdOrderById(document.id)) {
                OrderItem item = itemsById.get(line.sourceOrderItemId);
                if (item == null) continue;
                BigDecimal quantity = value(line.quantity);
                BigDecimal amount = salePrice(line, item).multiply(quantity);
                returnedQuantity.merge(item.id, quantity, BigDecimal::add);
                returnedAmount.merge(item.id, amount, BigDecimal::add);
                documentTotal = documentTotal.add(amount);
                documentLines.add(
                        new OrderReturnSummaryDto.Line(item.id, item.nameRu, quantity, amount));
            }
            returnDocuments.add(
                    new OrderReturnSummaryDto.Document(
                            document.id,
                            document.documentNumber,
                            document.postedAt,
                            documentTotal,
                            documentLines));
        }

        List<OrderReturnSummaryDto.Item> itemSummaries = new ArrayList<>();
        BigDecimal returnedTotal = ZERO;
        for (OrderItem item : order.items) {
            BigDecimal quantity = value(item.quantity);
            BigDecimal originalAmount = originalAmount(item, quantity);
            BigDecimal returned = returnedQuantity.getOrDefault(item.id, ZERO);
            BigDecimal returnedLineAmount = returnedAmount.getOrDefault(item.id, ZERO);
            itemSummaries.add(
                    new OrderReturnSummaryDto.Item(
                            item.id,
                            quantity,
                            returned,
                            quantity.subtract(returned).max(ZERO),
                            originalAmount,
                            returnedLineAmount,
                            originalAmount.subtract(returnedLineAmount).max(ZERO)));
            returnedTotal = returnedTotal.add(returnedLineAmount);
        }
        BigDecimal originalTotal = value(order.total);
        return new OrderReturnSummaryDto(
                originalTotal,
                returnedTotal,
                originalTotal.subtract(returnedTotal).max(ZERO),
                itemSummaries,
                returnDocuments);
    }

    @Transactional(readOnly = true)
    public List<OrderReturnStatisticDto> statistics() {
        return lines.postedCustomerReturnStatistics().stream()
                .map(
                        row ->
                                new OrderReturnStatisticDto(
                                        (UUID) row[0], value((BigDecimal) row[1]), value((BigDecimal) row[2])))
                .toList();
    }

    private static BigDecimal originalAmount(OrderItem item, BigDecimal quantity) {
        return item.confirmedLineTotal != null
                ? item.confirmedLineTotal
                : salePrice(null, item).multiply(quantity);
    }

    private static BigDecimal salePrice(StockDocumentLine line, OrderItem item) {
        if (line != null && line.unitPrice != null) return line.unitPrice;
        if (item.confirmedUnitPrice != null) return item.confirmedUnitPrice;
        return value(item.unitPrice);
    }

    private static BigDecimal value(BigDecimal value) {
        return value == null ? ZERO : value;
    }
}
