package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.dto.OrderItemDto;
import kz.company.shop.orders.dto.OrderReturnSummaryDto;
import kz.company.shop.orders.entity.FulfillmentType;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentMethod;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.products.entity.MeasurementUnit;
import kz.company.shop.settings.dto.PaymentInvoiceSettingsDto;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
import org.junit.jupiter.api.Test;

class OrderPaymentInvoicePdfServiceTest {
    private final OrderPaymentInvoicePdfService service = new OrderPaymentInvoicePdfService();

    @Test
    void reproducesExampleWithFractionalKilogramsAndFullInvoiceValueDespitePayment() throws Exception {
        String[][] rows = {
            {"Перец Болгарский", "3.305", "1245"},
            {"Цветная капуста", "2.335", "1150"},
            {"Грибы", "2.795", "1990"},
            {"Чеснок свежий", "0.845", "700"},
            {"Баклажан Юг", "1.885", "410"},
            {"Помидор Малина", "6.8", "1100"},
            {"Апельсин ЕГИПЕТ", "1.71", "975"},
            {"Банан жёлтые", "1.05", "900"},
            {"Микрозелень Редис Зелёный", "1", "0"}
        };
        List<OrderItemDto> items = new ArrayList<>();
        for (int i = 0; i < rows.length; i++)
            items.add(item(i + 1, rows[i][0], rows[i][1], rows[i][2], i == 8 ? MeasurementUnit.PIECE : MeasurementUnit.KG));
        byte[] pdf = service.generate(order(items), null, "ИИН/БИН: 790311301775, ИП Покупатель, Казахстан, г. Усть-Каменогорск, ул. А. Чехова 46 к1", PaymentInvoiceSettingsDto.defaults());
        savePreview("payment-invoice-preview.pdf", pdf);
        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = text(document);
            assertThat(document.getNumberOfPages()).isEqualTo(1);
            assertThat(document.getPage(0).getMediaBox().getWidth()).isEqualTo(PDRectangle.A4.getWidth());
            assertThat(text).contains("Счет на оплату №45 от 04.10.2026", "ИП \"GASTROFLOW\"", "БИН: 910818451048",
                    "KZ64722S000056725357", "CASPKZKA", "710", "Без договора", "ИП Покупатель", "3,305", "кг", "шт",
                    "Всего наименований 9, на сумму 23 818,63 KZT", "двадцать три тысячи восемьсот восемнадцать тенге 63 тиын",
                    "В том числе НДС:", "0,00", "Гайсумов Р.М.");
            assertThat(text).doesNotContain("Имя аккаунта", "Адрес аккаунта");
            assertTextInsidePages(document);
        }
    }

    @Test
    void usesCurrentStoredDiscountedAmountsInsteadOfUntouchedReturnSummaryOrPriceMultiplication() throws Exception {
        OrderItemDto item = with(item(1, "Скидка", "2", "100", MeasurementUnit.PIECE), "lineTotal", new BigDecimal("180.35"));
        OrderReturnSummaryDto summary = new OrderReturnSummaryDto(new BigDecimal("240"), BigDecimal.ZERO,
                new BigDecimal("240"), List.of(new OrderReturnSummaryDto.Item(1L, new BigDecimal("2"), BigDecimal.ZERO,
                new BigDecimal("2"), new BigDecimal("240"), BigDecimal.ZERO, new BigDecimal("240"))), List.of());
        try (PDDocument document = Loader.loadPDF(service.generate(order(List.of(item)), summary, "", PaymentInvoiceSettingsDto.defaults()))) {
            assertThat(text(document)).contains("180,35", "сто восемьдесят тенге 35 тиын").doesNotContain("240,00", "200,00");
        }
    }

    @Test
    void showsRemainingQuantitiesAndPostedAmountsAndOmitsFullyReturnedGoods() throws Exception {
        List<OrderItemDto> items = List.of(item(1, "Частичный возврат", "3.5", "100", MeasurementUnit.KG),
                item(2, "Возвращённый товар", "2", "100", MeasurementUnit.PIECE));
        OrderReturnSummaryDto summary = new OrderReturnSummaryDto(new BigDecimal("550"), new BigDecimal("325"), new BigDecimal("225"),
                List.of(new OrderReturnSummaryDto.Item(1L, new BigDecimal("3.5"), new BigDecimal("1.25"), new BigDecimal("2.25"),
                        new BigDecimal("350"), new BigDecimal("125"), new BigDecimal("225")),
                        new OrderReturnSummaryDto.Item(2L, new BigDecimal("2"), new BigDecimal("2"), BigDecimal.ZERO,
                                new BigDecimal("200"), new BigDecimal("200"), BigDecimal.ZERO)), List.of());
        try (PDDocument document = Loader.loadPDF(service.generate(order(items), summary, "ИП Покупатель", PaymentInvoiceSettingsDto.defaults()))) {
            assertThat(text(document)).contains("2,25", "225,00", "Всего наименований 1", "двести двадцать пять тенге 00 тиын")
                    .doesNotContain("Возвращённый товар", "550,00", "350,00", "200,00");
        }
    }

    @Test
    void paginatesLongRowsBuyerDetailsAndUnbrokenIdentifiersWithoutClipping() throws Exception {
        List<OrderItemDto> items = new ArrayList<>();
        items.add(item(1, "А".repeat(12000) + " КонецДлиннойСтроки", "1", "10", MeasurementUnit.KG));
        for (int i = 2; i <= 90; i++)
            items.add(item(i, "Позиция " + i + " свежий продукт с длинным наименованием и описанием упаковки", "1", "10", MeasurementUnit.PIECE));
        byte[] pdf = service.generate(order(items), null, "Р".repeat(10000) + " КонецРеквизитов", PaymentInvoiceSettingsDto.defaults());
        savePreview("payment-invoice-multipage-preview.pdf", pdf);
        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isGreaterThan(5);
            assertThat(text(document)).contains("КонецДлиннойСтроки", "КонецРеквизитов", "Позиция 90", "Всего наименований 90");
            for (int i = 1; i <= document.getNumberOfPages(); i++) {
                PDFTextStripper stripper = new PDFTextStripper();
                stripper.setStartPage(i);
                stripper.setEndPage(i);
                String pageText = stripper.getText(document);
                assertThat(pageText).contains("Страница " + i + " из " + document.getNumberOfPages());
                if (pageText.contains("Позиция ") || pageText.contains("КонецДлиннойСтроки"))
                    assertThat(pageText).contains("Наименование", "Кол-во", "Цена", "Сумма");
            }
            assertTextInsidePages(document);
        }
    }

    @Test
    void printsEditableSupplierSettingsWithLongValues() throws Exception {
        PaymentInvoiceSettingsDto settings = PaymentInvoiceSettingsDto.defaults();
        settings = with(settings, "supplierName", "Поставщик " + "Наименование ".repeat(18));
        settings = with(settings, "supplierTaxId", "123456789012");
        settings = with(settings, "bankName", "Банк " + "Название ".repeat(20));
        settings = with(settings, "iban", "KZ123456789012345678");
        settings = with(settings, "bic", "NEWBANKX");
        settings = with(settings, "contract", "Условия договора ".repeat(29));
        settings = with(settings, "executor", "Ответственный " + "Фамилия ".repeat(25));
        settings = with(settings, "paymentTerms", "Условия оплаты ".repeat(130));
        try (PDDocument document = Loader.loadPDF(service.generate(order(List.of(item(1, "Товар", "1", "10", MeasurementUnit.PIECE))), null, "Покупатель", settings))) {
            assertThat(text(document)).contains("123456789012", "KZ123456789012345678", "NEWBANKX", "Условия договора", "Ответственный")
                    .doesNotContain("GASTROFLOW", "CASPKZKA", "Гайсумов");
            assertTextInsidePages(document);
        }
    }

    private static void assertTextInsidePages(PDDocument document) throws Exception {
        new PDFTextStripper() {
            @Override
            protected void processTextPosition(TextPosition position) {
                assertThat(position.getXDirAdj()).isGreaterThanOrEqualTo(27f);
                assertThat(position.getXDirAdj() + position.getWidthDirAdj()).isLessThanOrEqualTo(PDRectangle.A4.getWidth() - 27);
                assertThat(position.getYDirAdj()).isBetween(20f, PDRectangle.A4.getHeight() - 14);
                super.processTextPosition(position);
            }
        }.getText(document);
    }

    private static String text(PDDocument document) throws Exception {
        return new PDFTextStripper().getText(document).replace('\u00a0', ' ');
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
    private static <T extends Record> T with(T record, String name, Object value) throws Exception {
        java.lang.reflect.RecordComponent[] components = record.getClass().getRecordComponents();
        Class<?>[] types = new Class<?>[components.length];
        Object[] values = new Object[components.length];
        for (int i = 0; i < components.length; i++) {
            types[i] = components[i].getType();
            values[i] = components[i].getName().equals(name) ? value : components[i].getAccessor().invoke(record);
        }
        return (T) record.getClass().getDeclaredConstructor(types).newInstance(values);
    }

    private static OrderItemDto item(long id, String name, String quantity, String price, MeasurementUnit unit) {
        BigDecimal amount = new BigDecimal(quantity);
        BigDecimal unitPrice = new BigDecimal(price);
        BigDecimal total = amount.multiply(unitPrice).setScale(2, RoundingMode.HALF_UP);
        return new OrderItemDto(id, id, false, String.valueOf(id), name, unitPrice, unitPrice, false,
                PriceTier.RETAIL, amount, false, false, total, total, null, null, null, null, null, unit);
    }

    private static OrderDto order(List<OrderItemDto> items) {
        BigDecimal total = items.stream().map(OrderItemDto::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new OrderDto(UUID.randomUUID(), "45", null, null, "Имя аккаунта", null,
                OrderStatus.COMPLETED, PaymentStatus.PAID, PaymentMethod.CASH,
                null, null, null, null, null, null, FulfillmentType.PICKUP,
                "Адрес аккаунта", null, null, null, false, PriceTier.RETAIL,
                null, null, null, null, 0, 0, total, total,
                Instant.parse("2026-10-03T20:00:00Z"), items);
    }
}
