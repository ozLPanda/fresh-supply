package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.repository.OrderRepository;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class OrderComparisonPdfServiceTest {
    @Test
    void printsCyrillicFullNameAndMarginRelativeToIncomingPrice() throws Exception {
        Order order =
                orderWith(
                        item(
                                "ABC-001",
                                "Очень длинное полное название товара без сокращений для печати",
                                "928",
                                "887",
                                "2"));

        byte[] pdf = new OrderComparisonPdfService(Mockito.mock(OrderRepository.class)).generate(order);

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text =
                    new PDFTextStripper()
                            .getText(document)
                            .replace('\u00a0', ' ')
                            .replaceAll("\\s+", " ");

            assertThat(document.getPage(0).getMediaBox().getWidth())
                    .isGreaterThan(document.getPage(0).getMediaBox().getHeight());
            assertThat(text)
                    .contains(
                            "Сравнительная таблица по заказу № 202609181",
                            "Артикул",
                            "Название товара",
                            "Кол-во отпущено",
                            "Цена отдачи",
                            "Цена приходная",
                            "Сумма отдачи",
                            "ABC-001",
                            "2",
                            "Очень длинное полное название товара без сокращений для печати",
                            "928 (+5% ; 41)",
                            "1 856 (+5% ; 82)",
                            "Итого по отпускной цене: 1 856 (+5% ; 82)",
                            "887");
        }
    }

    @Test
    void omitsMarginPercentageWhenIncomingPriceIsUnknownOrZero() throws Exception {
        Order order =
                orderWith(
                        item("NO-COST", "Без цены", "928", null, "2"),
                        item("ZERO-COST", "Нулевая цена", "928", "0", "3"));

        byte[] pdf = new OrderComparisonPdfService(Mockito.mock(OrderRepository.class)).generate(order);

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document).replace('\u00a0', ' ');

            assertThat(text).contains("NO-COST", "ZERO-COST", "928", "1 856", "2 784", "—", "0");
            assertThat(text).doesNotContain("(+");
        }
    }

    private Order orderWith(OrderItem... items) {
        Order order = new Order();
        order.orderNumberDate = LocalDate.of(2026, 9, 18);
        order.dailyNumber = 1;
        order.items = List.of(items);
        return order;
    }

    private OrderItem item(
            String sku, String name, String unitPrice, String incomingPrice, String quantity) {
        OrderItem item = new OrderItem();
        item.sku = sku;
        item.nameRu = name;
        item.unitPrice = new BigDecimal(unitPrice);
        item.incomingPrice = incomingPrice == null ? null : new BigDecimal(incomingPrice);
        item.quantity = new BigDecimal(quantity);
        item.lineTotal = item.unitPrice.multiply(item.quantity);
        return item;
    }
}
