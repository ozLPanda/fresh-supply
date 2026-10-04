package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import kz.company.shop.carts.dto.TemporaryInvoiceDto;
import kz.company.shop.carts.dto.TemporaryInvoiceItemDto;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.dto.OrderItemDto;
import kz.company.shop.orders.dto.OrderReturnSummaryDto;
import kz.company.shop.orders.entity.FulfillmentType;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentMethod;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.entity.PriceTier;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

class OrderInvoicePdfServiceTest {
    @Test
    void usesCurrentDiscountedLineTotalsWhenReturnSummaryContainsOldConfirmedPrices()
            throws Exception {
        List<OrderItemDto> items = new java.util.ArrayList<>();
        List<OrderReturnSummaryDto.Item> returnItems = new java.util.ArrayList<>();
        String[][] prices = {
            {"1119", "12", "3723", "3919"},
            {"351", "1", "1900", "2000"},
            {"407", "1", "1853", "1950"},
            {"1028", "4", "86", "90"}
        };
        for (int index = 0; index < prices.length; index++) {
            String[] row = prices[index];
            long id = index + 1;
            BigDecimal quantity = new BigDecimal(row[1]);
            BigDecimal currentPrice = new BigDecimal(row[2]);
            BigDecimal confirmedPrice = new BigDecimal(row[3]);
            BigDecimal confirmedTotal = confirmedPrice.multiply(quantity);
            items.add(new OrderItemDto(
                    id, id, false, row[0], "Товар " + id, currentPrice, confirmedPrice,
                    false, PriceTier.RETAIL, quantity, false, false,
                    currentPrice.multiply(quantity), confirmedTotal, null, null, null, null, null));
            returnItems.add(new OrderReturnSummaryDto.Item(
                    id, quantity, BigDecimal.ZERO, quantity, confirmedTotal,
                    BigDecimal.ZERO, confirmedTotal));
        }
        OrderDto order = orderWithPrintComment(null, items);
        OrderReturnSummaryDto summary = new OrderReturnSummaryDto(
                order.total(), BigDecimal.ZERO, order.total(), returnItems, List.of());

        try (PDDocument document = Loader.loadPDF(
                new OrderInvoicePdfService().generate(order, summary, true))) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(text).contains("44 676,00", "1 900,00", "1 853,00", "344,00", "48 773,00");
            assertThat(text).doesNotContain("47 028,00", "2 000,00", "1 950,00", "360,00");
        }
    }

    @Test
    void temporaryInvoiceDoesNotExposePriceTierOrProfit() throws Exception {
        OrderInvoicePdfService service = new OrderInvoicePdfService();

        byte[] pdf =
                service.generateTemporary(
                        new TemporaryInvoiceDto(
                                List.of(
                                        new TemporaryInvoiceItemDto(
                                                "2456",
                                                "Насос циркуляционный",
                                                new BigDecimal("2"),
                                                new BigDecimal("12350"),
                                                new BigDecimal("24700"))),
                                new BigDecimal("24700")));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(text)
                    .contains("Временная накладная", "Насос циркуляционный", "24 700,00", "₸");
            assertThat(text).doesNotContain("Крупный опт", "СКО", "Прибыль");
        }
    }

    @Test
    void printsMultilineOrderCommentWithoutAnAdditionalPdfHeading() throws Exception {
        OrderInvoicePdfService service = new OrderInvoicePdfService();
        byte[] pdf =
                service.generate(
                        orderWithPrintComment(
                                "Оплатить после доставки\nПозвонить получателю за час",
                                List.of(invoiceItem())));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(document.getNumberOfPages()).isEqualTo(1);
            assertThat(text).contains("Оплатить после доставки", "Позвонить получателю за час");
            assertThat(text).doesNotContain("Комментарий для накладной");
        }
    }

    @Test
    void canGenerateOrderInvoiceWithoutPrintComment() throws Exception {
        OrderInvoicePdfService service = new OrderInvoicePdfService();
        String printComment = "Оплатить после доставки\nПозвонить получателю за час";
        byte[] pdf = service.generate(orderWithPrintComment(printComment, List.of(invoiceItem())), false);

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(text).contains("Насос циркуляционный");
            assertThat(text).doesNotContain("Оплатить после доставки", "Позвонить получателю за час");
        }
    }

    @Test
    void movesAWholePrintCommentToTheNextPageWhenItDoesNotFitBelowTheInvoice()
            throws Exception {
        OrderInvoicePdfService service = new OrderInvoicePdfService();
        String printComment =
                java.util.stream.IntStream.rangeClosed(1, 42)
                        .mapToObj(index -> "Условие выдачи " + index)
                        .collect(java.util.stream.Collectors.joining("\n"));
        byte[] pdf = service.generate(orderWithPrintComment(printComment, List.of(invoiceItem())));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            PDFTextStripper lastPage = new PDFTextStripper();
            lastPage.setStartPage(document.getNumberOfPages());
            lastPage.setEndPage(document.getNumberOfPages());

            assertThat(document.getNumberOfPages()).isGreaterThanOrEqualTo(2);
            assertThat(lastPage.getText(document))
                    .contains("Условие выдачи 1", "Условие выдачи 42");
        }
    }

    @Test
    void marksReturnedItemsAndPrintsOriginalRemainingAndRefundTotals() throws Exception {
        OrderInvoicePdfService service = new OrderInvoicePdfService();
        OrderItemDto fullyReturned = invoiceItem();
        OrderItemDto partiallyReturned =
                new OrderItemDto(
                        2L,
                        2L,
                        false,
                        "2457",
                        "Клапан обратный",
                        new BigDecimal("100.00"),
                        new BigDecimal("100.00"),
                        false,
                        PriceTier.RETAIL,
                        new BigDecimal("3"),
                        false,
                        false,
                        new BigDecimal("300.00"),
                        new BigDecimal("300.00"),
                        null,
                        null,
                        null,
                        null,
                        null);
        OrderDto order = orderWithPrintComment(null, List.of(fullyReturned, partiallyReturned));
        OrderReturnSummaryDto summary =
                new OrderReturnSummaryDto(
                        new BigDecimal("12650.00"),
                        new BigDecimal("12450.00"),
                        new BigDecimal("200.00"),
                        List.of(
                                new OrderReturnSummaryDto.Item(
                                        fullyReturned.id(),
                                        BigDecimal.ONE,
                                        BigDecimal.ONE,
                                        BigDecimal.ZERO,
                                        new BigDecimal("12350.00"),
                                        new BigDecimal("12350.00"),
                                        BigDecimal.ZERO),
                                new OrderReturnSummaryDto.Item(
                                        partiallyReturned.id(),
                                        new BigDecimal("3"),
                                        BigDecimal.ONE,
                                        new BigDecimal("2"),
                                        new BigDecimal("300.00"),
                                        new BigDecimal("100.00"),
                                        new BigDecimal("200.00"))),
                        List.of());

        try (PDDocument document = Loader.loadPDF(service.generate(order, summary, true))) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(text)
                    .contains(
                            "Возвращено полностью",
                            "Возвращена часть товара",
                            "Сумма до возврата",
                            "К возврату",
                            "Итого после возврата",
                            "12 650,00",
                            "12 450,00",
                            "200,00");
        }
    }

    private OrderDto orderWithPrintComment(String printComment, List<OrderItemDto> items) {
        BigDecimal total =
                items.stream()
                        .map(OrderItemDto::lineTotal)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new OrderDto(
                UUID.randomUUID(),
                "20260904001",
                null,
                null,
                null,
                null,
                OrderStatus.COMPLETED,
                PaymentStatus.PAID,
                PaymentMethod.CASH,
                null,
                null,
                null,
                null,
                null,
                null,
                FulfillmentType.PICKUP,
                null,
                "+7 777 000 00 00",
                null,
                printComment,
                false,
                PriceTier.RETAIL,
                null,
                null,
                null,
                null,
                0,
                0,
                total,
                total,
                Instant.parse("2026-09-04T00:00:00Z"),
                items);
    }

    private OrderItemDto invoiceItem() {
        BigDecimal price = new BigDecimal("12350.00");
        return new OrderItemDto(
                1L,
                1L,
                false,
                "2456",
                "Насос циркуляционный",
                price,
                price,
                false,
                PriceTier.RETAIL,
                BigDecimal.ONE,
                false,
                false,
                price,
                price,
                null,
                null,
                null,
                null,
                null);
    }
}
