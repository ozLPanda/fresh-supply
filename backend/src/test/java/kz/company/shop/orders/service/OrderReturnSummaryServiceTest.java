package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.warehouse.entity.StockDocument;
import kz.company.shop.warehouse.entity.StockDocumentLine;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.StockDocumentRepository;
import org.junit.jupiter.api.Test;

class OrderReturnSummaryServiceTest {
    @Test
    void returnsAggregateStatisticsForPostedCustomerReturns() {
        OrderRepository orders = mock(OrderRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        OrderReturnSummaryService service = new OrderReturnSummaryService(orders, documents, lines);
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000093");

        when(lines.postedCustomerReturnStatistics())
                .thenReturn(
                        List.<Object[]>of(
                                new Object[] {
                                    orderId, new BigDecimal("1.500"), new BigDecimal("750.00")
                                }));

        assertThat(service.statistics())
                .singleElement()
                .satisfies(
                        result -> {
                            assertThat(result.orderId()).isEqualTo(orderId);
                            assertThat(result.returnedQuantity()).isEqualByComparingTo("1.500");
                            assertThat(result.returnedTotal()).isEqualByComparingTo("750.00");
                        });
    }

    @Test
    void keepsOriginalSaleAndCalculatesRemainingValuesAfterPartialReturn() {
        OrderRepository orders = mock(OrderRepository.class);
        StockDocumentRepository documents = mock(StockDocumentRepository.class);
        StockDocumentLineRepository lines = mock(StockDocumentLineRepository.class);
        OrderReturnSummaryService service = new OrderReturnSummaryService(orders, documents, lines);
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000091");
        UUID documentId = UUID.fromString("00000000-0000-7000-8000-000000000092");

        Order order = new Order();
        order.id = orderId;
        order.total = new BigDecimal("1000.00");
        OrderItem item = new OrderItem();
        item.id = 7L;
        item.nameRu = "Товар";
        item.quantity = new BigDecimal("2.000");
        item.confirmedUnitPrice = new BigDecimal("500.00");
        item.confirmedLineTotal = new BigDecimal("1000.00");
        order.items.add(item);

        StockDocument document = new StockDocument();
        document.id = documentId;
        document.documentNumber = "ВОЗ-1";
        document.postedAt = Instant.parse("2026-09-07T06:00:00Z");
        StockDocumentLine returnLine = new StockDocumentLine();
        returnLine.sourceOrderItemId = item.id;
        returnLine.quantity = new BigDecimal("0.500");
        returnLine.unitPrice = new BigDecimal("500.00");

        when(orders.findWithItemsById(orderId)).thenReturn(Optional.of(order));
        when(documents.findPostedCustomerReturnsBySourceOrderId(orderId))
                .thenReturn(List.of(document));
        when(lines.findByDocumentIdOrderById(documentId)).thenReturn(List.of(returnLine));

        var summary = service.summary(orderId);

        assertThat(summary.originalTotal()).isEqualByComparingTo("1000.00");
        assertThat(summary.returnedTotal()).isEqualByComparingTo("250.00");
        assertThat(summary.remainingTotal()).isEqualByComparingTo("750.00");
        assertThat(summary.items())
                .singleElement()
                .satisfies(
                        result -> {
                            assertThat(result.returnedQuantity()).isEqualByComparingTo("0.500");
                            assertThat(result.remainingQuantity()).isEqualByComparingTo("1.500");
                            assertThat(result.remainingAmount()).isEqualByComparingTo("750.00");
                        });
        assertThat(summary.documents())
                .singleElement()
                .satisfies(
                        result -> {
                            assertThat(result.documentNumber()).isEqualTo("ВОЗ-1");
                            assertThat(result.total()).isEqualByComparingTo("250.00");
                        });
    }
}
