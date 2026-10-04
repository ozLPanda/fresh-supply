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
    void recipientComesOnlyFromRegularBuyerSnapshot() throws Exception {
        OrderDto order = recordWith(orderWithPrintComment(null, List.of(invoiceItem())),
                "customerName", "Клиент аккаунта");
        try (PDDocument document = Loader.loadPDF(new OrderInvoicePdfService().generate(order))) {
            assertThat(new PDFTextStripper().getText(document)).doesNotContain("Клиент аккаунта");
        }
        order = recordWith(order, "regularBuyerName", "ИП Получатель");
        try (PDDocument document = Loader.loadPDF(new OrderInvoicePdfService().generate(order))) {
            assertThat(new PDFTextStripper().getText(document)).contains("ИП Получатель")
                    .doesNotContain("Клиент аккаунта");
        }
    }


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
            items.add(
                    new OrderItemDto(
                            id,
                            id,
                            false,
                            row[0],
                            "Товар " + id,
                            currentPrice,
                            confirmedPrice,
                            false,
                            PriceTier.RETAIL,
                            quantity,
                            false,
                            false,
                            currentPrice.multiply(quantity),
                            confirmedTotal,
                            null,
                            null,
                            null,
                            null,
                            null));
            returnItems.add(
                    new OrderReturnSummaryDto.Item(
                            id,
                            quantity,
                            BigDecimal.ZERO,
                            quantity,
                            confirmedTotal,
                            BigDecimal.ZERO,
                            confirmedTotal));
        }
        OrderDto order = orderWithPrintComment(null, items);
        OrderReturnSummaryDto summary =
                new OrderReturnSummaryDto(
                        order.total(), BigDecimal.ZERO, order.total(), returnItems, List.of());

        try (PDDocument document =
                Loader.loadPDF(new OrderInvoicePdfService().generate(order, summary, true))) {
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
        byte[] pdf =
                service.generate(
                        orderWithPrintComment(printComment, List.of(invoiceItem())), false);

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(text).contains("Насос циркуляционный");
            assertThat(text)
                    .doesNotContain("Оплатить после доставки", "Позвонить получателю за час");
        }
    }

    @Test
    void movesAWholePrintCommentToTheNextPageWhenItDoesNotFitBelowTheInvoice() throws Exception {
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

        byte[] returnedPdf = service.generate(order, summary, true);
        savePreview("invoice-returns-preview.pdf", returnedPdf);
        try (PDDocument document = Loader.loadPDF(returnedPdf)) {
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

    @Test
    void printsZ2SupplierRecipientReleaseDateUnitsAndZeroVat() throws Exception {
        OrderItemDto kg =
                recordWith(
                        invoiceItem(),
                        "measurementUnit",
                        kz.company.shop.products.entity.MeasurementUnit.KG);
        kg = recordWith(kg, "quantity", new BigDecimal("49.160"));
        OrderDto order =
                recordWith(
                        orderWithPrintComment(null, List.of(kg, invoiceItem())),
                        "regularBuyerName",
                        "ИП Тестовый получатель");
        order = recordWith(order, "invoiceIssuedAt", Instant.parse("2026-10-03T23:10:00Z"));
        byte[] pdf = new OrderInvoicePdfService().generate(order);
        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');
            assertThat(text)
                    .contains(
                            "Форма З-2",
                            "Приложение 26",
                            "Индивидуальный предприниматель \"GASTROFLOW\"",
                            "910818451048",
                            "ИП Тестовый получатель",
                            "04.10.2026",
                            "20260904001",
                            "Гайсумов Р.М.",
                            "директор",
                            "Главный бухгалтер",
                            "По доверенности",
                            "0,00",
                            "49,16",
                            "50,16",
                            "килограмма; одна штука",
                            "кг",
                            "шт.");
            assertThat(text)
                    .doesNotContain(
                            "04.09.2026",
                            "Findhow",
                            "пятьдесят целых шестнадцать сотых килограмма");
            assertThat(document.getPage(0).getMediaBox().getWidth())
                    .isLessThan(document.getPage(0).getMediaBox().getHeight());
        }
    }

    @Test
    void usesCreationDateForLegacyOrdersAndKeepsSixteenRowsOnOnePage() throws Exception {
        String[] names = {
            "Помидор Теплица",
            "Грибы",
            "Перец Болгарский",
            "Баклажан ЮГ",
            "Черри Красный",
            "Пекинская капуста",
            "Салат Листовой",
            "Укроп свежий",
            "Петрушка свежая",
            "Лук зелёный",
            "Цукини ЮГ",
            "Виноград Бурбон",
            "Апельсин ЕГИПЕТ",
            "Груша Фуше",
            "Яблоки красные",
            "Лимон Китай"
        };
        String[] quantities = {
            "7.8", "5.585", "5.365", "5.13", "2.165", "3.09", "2.2", "2.2", "2.065", "1.08",
            "1.995", "1.595", "0.515", "0.795", "0.415", "7.165"
        };
        String[] prices = {
            "815", "2200", "1350", "450", "1400", "580", "1000", "1300", "2050", "1510", "450",
            "2860", "1050", "750", "750", "1000"
        };
        List<OrderItemDto> items = new java.util.ArrayList<>();
        for (int i = 0; i < names.length; i++) {
            OrderItemDto item = recordWith(invoiceItem(), "nameRu", names[i]);
            item = recordWith(item, "sku", String.valueOf(i + 1));
            item = recordWith(item, "quantity", new BigDecimal(quantities[i]));
            item = recordWith(item, "unitPrice", new BigDecimal(prices[i]));
            item =
                    recordWith(
                            item,
                            "lineTotal",
                            new BigDecimal(quantities[i])
                                    .multiply(new BigDecimal(prices[i]))
                                    .setScale(2, java.math.RoundingMode.HALF_UP));
            items.add(
                    recordWith(
                            item,
                            "measurementUnit",
                            kz.company.shop.products.entity.MeasurementUnit.KG));
        }
        OrderDto order =
                recordWith(
                        orderWithPrintComment(null, items),
                        "regularBuyerName",
                        "ИП Тестовый получатель");
        byte[] pdf = new OrderInvoicePdfService().generate(order);
        savePreview("invoice-preview.pdf", pdf);
        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');
            assertThat(document.getNumberOfPages()).isEqualTo(1);
            assertThat(text)
                    .contains(
                            "04.09.2026",
                            "49,16",
                            "58 015,20",
                            "Сорок девять целых шестнадцать сотых килограмма",
                            "Пятьдесят восемь тысяч пятнадцать тенге 20 тиын");
        }
    }

    @Test
    void paginatesLongNamesAndRepeatsHeadersWithoutDroppingRows() throws Exception {
        List<OrderItemDto> items = new java.util.ArrayList<>();
        for (int i = 1; i <= 65; i++) {
            OrderItemDto item =
                    recordWith(
                            invoiceItem(),
                            "nameRu",
                            "Позиция "
                                    + i
                                    + " длинное наименование свежего продукта с характеристиками упаковки и сорта");
            item = recordWith(item, "sku", "SKU-" + i);
            item =
                    recordWith(
                            item,
                            "measurementUnit",
                            i % 2 == 0
                                    ? kz.company.shop.products.entity.MeasurementUnit.KG
                                    : kz.company.shop.products.entity.MeasurementUnit.PIECE);
            items.add(item);
        }
        byte[] pdf =
                new OrderInvoicePdfService()
                        .generate(
                                orderWithPrintComment(
                                        "Контрольный комментарий на последней странице", items));
        savePreview("invoice-multipage-preview.pdf", pdf);
        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document);
            assertThat(document.getNumberOfPages()).isGreaterThan(2);
            assertThat(text)
                    .contains(
                            "SKU-1",
                            "SKU-65",
                            "Контрольный комментарий на последней странице",
                            "продолжение",
                            "Тридцать три штуки; тридцать два килограмма");
            for (int i = 1; i <= document.getNumberOfPages(); i++) {
                PDFTextStripper page = new PDFTextStripper();
                page.setStartPage(i);
                page.setEndPage(i);
                assertThat(page.getText(document))
                        .contains("Страница " + i + " из " + document.getNumberOfPages());
            }
        }
    }

    private static void savePreview(String name, byte[] pdf) throws Exception {
        String directory = System.getProperty("invoice.preview.dir");
        if (directory != null) {
            java.nio.file.Path path = java.nio.file.Path.of(directory);
            java.nio.file.Files.createDirectories(path);
            java.nio.file.Files.write(path.resolve(name), pdf);
        }
    }

    @SuppressWarnings("unchecked")
    private static <T extends Record> T recordWith(T record, String name, Object value)
            throws Exception {
        java.lang.reflect.RecordComponent[] components = record.getClass().getRecordComponents();
        Class<?>[] types = new Class<?>[components.length];
        Object[] values = new Object[components.length];
        for (int i = 0; i < components.length; i++) {
            types[i] = components[i].getType();
            values[i] =
                    components[i].getName().equals(name)
                            ? value
                            : components[i].getAccessor().invoke(record);
        }
        return (T) record.getClass().getDeclaredConstructor(types).newInstance(values);
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
