package kz.company.shop.orders.service;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.repository.OrderRepository;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Service;

/** Produces the internal comparison table with order sale prices and cost snapshots. */
@Service
public class OrderComparisonPdfService {
    private static final Locale RUSSIAN_LOCALE = Locale.forLanguageTag("ru-RU");
    private static final PDRectangle PAGE_SIZE =
            new PDRectangle(PDRectangle.A4.getHeight(), PDRectangle.A4.getWidth());
    private static final float PAGE_WIDTH = PAGE_SIZE.getWidth();
    private static final float PAGE_HEIGHT = PAGE_SIZE.getHeight();
    private static final float MARGIN = 36;
    private static final float[] COLUMN_WIDTHS = {75, 185, 95, 125, 95, 195};
    private static final float HEADER_HEIGHT = 24;
    private static final float TOTAL_HEIGHT = 28;
    private static final float FONT_SIZE = 9;
    private static final float LINE_HEIGHT = 12;
    private static final float CELL_PADDING = 5;
    private static final List<FontFiles> FONT_FILES =
            List.of(
                    new FontFiles(
                            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
                    new FontFiles(
                            "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
                            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"),
                    new FontFiles(
                            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"));

    private final OrderRepository orders;

    public OrderComparisonPdfService(OrderRepository orders) {
        this.orders = orders;
    }

    public byte[] generate(UUID orderId) {
        Order order =
                orders
                        .findWithItemsById(orderId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Заказ не найден"));
        return generate(order);
    }

    byte[] generate(Order order) {
        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Fonts fonts = loadFonts(document);
            PageState page = newPage(document);
            page.y = drawTitle(page, order, fonts);
            drawTableHeader(page, fonts);
            for (OrderItem item : order.items) {
                List<String> nameLines =
                        wrap(
                                item.nameRu,
                                fonts.regular(),
                                FONT_SIZE,
                                COLUMN_WIDTHS[1] - 2 * CELL_PADDING);
                float rowHeight = Math.max(28, nameLines.size() * LINE_HEIGHT + 2 * CELL_PADDING);
                if (page.y - rowHeight < MARGIN) {
                    page.close();
                    page = newPage(document);
                    page.y = drawTitle(page, order, fonts);
                    drawTableHeader(page, fonts);
                }
                drawItemRow(page, item, nameLines, rowHeight, fonts);
            }
            if (page.y - TOTAL_HEIGHT < MARGIN) {
                page.close();
                page = newPage(document);
                page.y = drawTitle(page, order, fonts);
            }
            drawTotals(page, order.items, fonts);
            page.close();
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Не удалось сформировать сравнительную таблицу PDF", exception);
        }
    }

    private PageState newPage(PDDocument document) throws IOException {
        PDPage pdfPage = new PDPage(PAGE_SIZE);
        document.addPage(pdfPage);
        return new PageState(new PDPageContentStream(document, pdfPage), PAGE_HEIGHT - MARGIN);
    }

    private float drawTitle(PageState page, Order order, Fonts fonts) throws IOException {
        text(page, "Сравнительная таблица по заказу № " + order.displayCode(), MARGIN, page.y, fonts, 14, true);
        page.y -= 28;
        return page.y;
    }

    private void drawTableHeader(PageState page, Fonts fonts) throws IOException {
        drawGrid(page, HEADER_HEIGHT);
        String[] labels = {
            "Артикул",
            "Название товара",
            "Кол-во отпущено",
            "Цена отдачи",
            "Цена приходная",
            "Сумма отдачи"
        };
        float x = MARGIN;
        for (int index = 0; index < labels.length; index++) {
            text(page, labels[index], x + CELL_PADDING, page.y + HEADER_HEIGHT - 16, fonts, FONT_SIZE, true);
            x += COLUMN_WIDTHS[index];
        }
    }

    private void drawItemRow(
            PageState page, OrderItem item, List<String> nameLines, float height, Fonts fonts)
            throws IOException {
        float bottom = drawGrid(page, height);
        drawLines(page, 0, List.of(orDash(item.sku)), bottom, height, fonts, CellAlignment.LEFT);
        drawLines(page, 1, nameLines, bottom, height, fonts, CellAlignment.LEFT);
        drawLines(
                page,
                2,
                List.of(quantityAmount(quantity(item))),
                bottom,
                height,
                fonts,
                CellAlignment.RIGHT);
        drawLines(
                page,
                3,
                List.of(salePrice(item)),
                bottom,
                height,
                fonts,
                CellAlignment.RIGHT);
        drawLines(
                page,
                4,
                List.of(item.incomingPrice == null ? "—" : amount(item.incomingPrice)),
                bottom,
                height,
                fonts,
                CellAlignment.RIGHT);
        drawLines(page, 5, List.of(saleAmount(item)), bottom, height, fonts, CellAlignment.RIGHT);
    }

    private void drawTotals(PageState page, List<OrderItem> items, Fonts fonts) throws IOException {
        String total = "Итого по отпускной цене: " + saleTotal(items);
        float textWidth = width(fonts.bold(), total, FONT_SIZE);
        page.y -= TOTAL_HEIGHT;
        text(page, total, PAGE_WIDTH - MARGIN - textWidth, page.y + 9, fonts, FONT_SIZE, true);
    }

    private float drawGrid(PageState page, float height) throws IOException {
        float bottom = page.y - height;
        float x = MARGIN;
        page.content.setLineWidth(0.6f);
        for (float width : COLUMN_WIDTHS) {
            page.content.addRect(x, bottom, width, height);
            x += width;
        }
        page.content.stroke();
        page.y = bottom;
        return bottom;
    }

    private void drawLines(
            PageState page,
            int column,
            List<String> lines,
            float bottom,
            float height,
            Fonts fonts,
            CellAlignment alignment)
            throws IOException {
        float x = MARGIN;
        for (int index = 0; index < column; index++) x += COLUMN_WIDTHS[index];
        float width = COLUMN_WIDTHS[column];
        float blockHeight = lines.size() * LINE_HEIGHT;
        float baseline = bottom + (height + blockHeight) / 2 - LINE_HEIGHT + 3;
        for (String line : lines) {
            float textWidth = width(fonts.regular(), line, FONT_SIZE);
            float textX =
                    switch (alignment) {
                        case LEFT -> x + CELL_PADDING;
                        case RIGHT -> x + width - CELL_PADDING - textWidth;
                    };
            text(page, line, textX, baseline, fonts, FONT_SIZE, false);
            baseline -= LINE_HEIGHT;
        }
    }

    private String salePrice(OrderItem item) {
        if (item.unitPrice == null) return "—";
        return withMargin(item.unitPrice, item.incomingPrice);
    }

    private String saleAmount(OrderItem item) {
        BigDecimal saleAmount = saleAmountValue(item);
        if (saleAmount == null) return "—";
        BigDecimal incomingAmount = incomingAmountValue(item);
        return withMargin(saleAmount, incomingAmount);
    }

    private String saleTotal(List<OrderItem> items) {
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal incomingTotal = BigDecimal.ZERO;
        boolean marginAvailable = true;
        for (OrderItem item : items) {
            BigDecimal saleAmount = saleAmountValue(item);
            if (saleAmount == null) continue;
            total = total.add(saleAmount);
            BigDecimal incomingAmount = incomingAmountValue(item);
            if (incomingAmount == null || incomingAmount.signum() == 0) {
                marginAvailable = false;
            } else {
                incomingTotal = incomingTotal.add(incomingAmount);
            }
        }
        return marginAvailable ? withMargin(total, incomingTotal) : amount(total);
    }

    private BigDecimal saleAmountValue(OrderItem item) {
        if (item.lineTotal != null) return item.lineTotal;
        if (item.unitPrice == null) return null;
        return item.unitPrice.multiply(quantity(item));
    }

    private BigDecimal incomingAmountValue(OrderItem item) {
        return item.incomingPrice == null ? null : item.incomingPrice.multiply(quantity(item));
    }

    private BigDecimal quantity(OrderItem item) {
        return item.quantity == null ? BigDecimal.ONE : item.quantity;
    }

    private String withMargin(BigDecimal sale, BigDecimal incoming) {
        if (incoming == null || incoming.signum() == 0) return amount(sale);
        BigDecimal margin = sale.subtract(incoming);
        BigDecimal percent =
                margin.multiply(BigDecimal.valueOf(100))
                        .divide(incoming, 0, RoundingMode.HALF_UP);
        return amount(sale) + " (" + signedPercent(percent) + " ; " + amount(margin) + ")";
    }

    private String signedPercent(BigDecimal percent) {
        String value = percent.stripTrailingZeros().toPlainString();
        return (percent.signum() > 0 ? "+" : "") + value + "%";
    }

    private String amount(BigDecimal value) {
        DecimalFormat formatter =
                new DecimalFormat("#,##0.##", DecimalFormatSymbols.getInstance(RUSSIAN_LOCALE));
        return formatter.format(value);
    }

    private String quantityAmount(BigDecimal value) {
        DecimalFormat formatter =
                new DecimalFormat("#,##0.###", DecimalFormatSymbols.getInstance(RUSSIAN_LOCALE));
        return formatter.format(value);
    }

    private List<String> wrap(String value, PDFont font, float fontSize, float maxWidth)
            throws IOException {
        String normalized = orDash(value).replaceAll("\\s+", " ");
        List<String> lines = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String word : normalized.split(" ")) {
            String candidate = current.isEmpty() ? word : current + " " + word;
            if (width(font, candidate, fontSize) <= maxWidth) {
                current.setLength(0);
                current.append(candidate);
                continue;
            }
            if (!current.isEmpty()) {
                lines.add(current.toString());
                current.setLength(0);
            }
            while (width(font, word, fontSize) > maxWidth && word.length() > 1) {
                int end = word.length() - 1;
                while (end > 1 && width(font, word.substring(0, end), fontSize) > maxWidth) end--;
                lines.add(word.substring(0, end));
                word = word.substring(end);
            }
            current.append(word);
        }
        if (!current.isEmpty()) lines.add(current.toString());
        return lines;
    }

    private Fonts loadFonts(PDDocument document) throws IOException {
        for (FontFiles files : FONT_FILES) {
            File regular = new File(files.regular());
            File bold = new File(files.bold());
            if (regular.isFile() && bold.isFile()) {
                return new Fonts(PDType0Font.load(document, regular), PDType0Font.load(document, bold));
            }
        }
        throw new IOException("Для PDF требуется шрифт с поддержкой кириллицы");
    }

    private void text(PageState page, String value, float x, float y, Fonts fonts, float size, boolean bold)
            throws IOException {
        page.content.beginText();
        page.content.setNonStrokingColor(Color.BLACK);
        page.content.setFont(bold ? fonts.bold() : fonts.regular(), size);
        page.content.newLineAtOffset(x, y);
        page.content.showText(value);
        page.content.endText();
    }

    private float width(PDFont font, String value, float size) throws IOException {
        return font.getStringWidth(value) / 1000 * size;
    }

    private String orDash(String value) {
        return value == null || value.isBlank() ? "—" : value.trim();
    }

    private static final class PageState {
        private final PDPageContentStream content;
        private float y;

        private PageState(PDPageContentStream content, float y) {
            this.content = content;
            this.y = y;
        }

        private void close() throws IOException {
            content.close();
        }
    }

    private record Fonts(PDFont regular, PDFont bold) {}

    private record FontFiles(String regular, String bold) {}

    private enum CellAlignment {
        LEFT,
        RIGHT
    }
}
