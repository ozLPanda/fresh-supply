package kz.company.shop.orders.service;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import kz.company.shop.carts.dto.TemporaryInvoiceDto;
import kz.company.shop.carts.dto.TemporaryInvoiceItemDto;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.dto.OrderItemDto;
import kz.company.shop.orders.dto.OrderReturnSummaryDto;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Service;

/** Creates a self-contained, printable delivery note for an order. */
@Service
public class OrderInvoicePdfService {
    private static final String MANUAL_ITEM_SKU = "Ручная позиция";
    private static final String TENGE_SYMBOL = "₸";
    private static final ZoneId TIME_ZONE = ZoneId.of("Asia/Almaty");
    private static final Locale RUSSIAN_LOCALE = Locale.forLanguageTag("ru-RU");
    private static final DateTimeFormatter DATE_FORMATTER =
            DateTimeFormatter.ofPattern("d MMMM yyyy 'г.'", RUSSIAN_LOCALE);
    private static final float PAGE_WIDTH = PDRectangle.A4.getWidth();
    private static final float PAGE_HEIGHT = PDRectangle.A4.getHeight();
    private static final float MARGIN = 40;
    private static final float TABLE_WIDTH = PAGE_WIDTH - 2 * MARGIN;
    // Keep numeric fields compact and reserve the widest column for product names.
    private static final float[] COLUMN_WIDTHS = {24, 301, 38, 26, 58, 68};
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

    public byte[] generate(OrderDto order) {
        return generate(order, true);
    }

    public byte[] generate(OrderDto order, boolean includePrintComment) {
        return generate(order, null, includePrintComment);
    }

    public byte[] generate(
            OrderDto order, OrderReturnSummaryDto returnSummary, boolean includePrintComment) {
        String number = order.displayCode().replaceAll("\\D", "");
        number =
                number.isEmpty()
                        ? order.displayCode()
                        : String.format("%010d", Long.parseLong(number));
        String title =
                "Товарная накладная № "
                        + number
                        + " от "
                        + DATE_FORMATTER.format(order.createdAt().atZone(TIME_ZONE));
        Map<Long, OrderReturnSummaryDto.Item> returnsByItemId =
                returnSummary == null
                        ? Map.of()
                        : returnSummary.items().stream()
                                .collect(
                                        java.util.stream.Collectors.toMap(
                                                OrderReturnSummaryDto.Item::orderItemId,
                                                item -> item));
        return generate(
                title,
                order.items().stream()
                        .map(item -> invoiceItem(item, returnsByItemId.get(item.id())))
                        .toList(),
                InvoiceTotals.from(order.total(), returnSummary),
                includePrintComment ? order.printComment() : null);
    }

    public byte[] generateTemporary(TemporaryInvoiceDto invoice) {
        return generate(
                "Временная накладная",
                invoice.items().stream().map(this::invoiceItem).toList(),
                InvoiceTotals.withoutReturns(invoice.total()),
                null);
    }

    private byte[] generate(
            String title, List<InvoiceItem> items, InvoiceTotals totals, String printComment) {
        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            InvoiceFonts fonts = loadUnicodeFonts(document);
            TableLayout tableLayout = TableLayout.forItemCount(items.size());
            PageState page = newPage(document);
            page.y = drawHeader(page, title, fonts);
            drawTableHeader(page, fonts, tableLayout);

            for (int index = 0; index < items.size(); index++) {
                InvoiceItem item = items.get(index);
                float rowHeight = rowHeight(item, fonts.regular(), tableLayout);
                if (page.y - rowHeight < MARGIN + 110) {
                    page.close();
                    page = newPage(document);
                    drawTableHeader(page, fonts, tableLayout);
                }
                drawItemRow(page, index + 1, item, rowHeight, fonts, tableLayout);
            }

            if (page.y < MARGIN + (totals.hasReturns() ? 145 : 105)) {
                page.close();
                page = newPage(document);
            }
            drawSummaryAndSignatures(page, totals, fonts);
            page = drawPrintComment(document, page, printComment, fonts);
            page.close();
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Не удалось сформировать PDF накладной", exception);
        }
    }

    private InvoiceItem invoiceItem(OrderItemDto item, OrderReturnSummaryDto.Item returnItem) {
        // The return summary also contains untouched items and may still carry prices from
        // before a price review. Only actual returns should override the current order amounts.
        if (returnItem != null && returnItem.returnedQuantity().signum() == 0) {
            returnItem = null;
        }
        return new InvoiceItem(
                item.sku(),
                item.nameRu(),
                item.quantity(),
                item.unitPrice(),
                returnItem == null ? item.lineTotal() : returnItem.originalAmount(),
                returnItem == null ? BigDecimal.ZERO : returnItem.returnedQuantity(),
                returnItem == null ? item.quantity() : returnItem.remainingQuantity(),
                returnItem == null ? BigDecimal.ZERO : returnItem.returnedAmount(),
                returnItem == null ? item.lineTotal() : returnItem.remainingAmount());
    }

    private InvoiceItem invoiceItem(TemporaryInvoiceItemDto item) {
        return new InvoiceItem(
                item.sku(),
                item.nameRu(),
                item.quantity(),
                item.unitPrice(),
                item.lineTotal(),
                BigDecimal.ZERO,
                item.quantity(),
                BigDecimal.ZERO,
                item.lineTotal());
    }

    private PageState newPage(PDDocument document) throws IOException {
        PDPage page = new PDPage(PDRectangle.A4);
        document.addPage(page);
        return new PageState(new PDPageContentStream(document, page), PAGE_HEIGHT - MARGIN);
    }

    private float drawHeader(PageState page, String title, InvoiceFonts fonts) throws IOException {
        text(page, title, MARGIN, page.y, fonts, 14, true);
        page.content.setLineWidth(1.2f);
        page.content.moveTo(MARGIN, page.y - 7);
        page.content.lineTo(PAGE_WIDTH - MARGIN, page.y - 7);
        page.content.stroke();
        page.y -= 32;
        text(page, "Поставщик:", MARGIN, page.y, fonts, 10, false);
        text(page, "Фирма «Актив»", MARGIN + 62, page.y, fonts, 10, true);
        return page.y - 22;
    }

    private void drawTableHeader(PageState page, InvoiceFonts fonts, TableLayout layout)
            throws IOException {
        String[] labels = {
            "№", "Товар", "Кол-во", "Ед.", "Цена, " + TENGE_SYMBOL, "Сумма, " + TENGE_SYMBOL
        };
        drawTableRow(
                page, labels, layout.headerHeight(), fonts, layout.headerFontSize(), true, layout);
    }

    private void drawItemRow(
            PageState page,
            int index,
            InvoiceItem item,
            float height,
            InvoiceFonts fonts,
            TableLayout layout)
            throws IOException {
        if (item.hasReturn()) {
            drawReturnedItemRow(page, index, item, height, fonts, layout);
            return;
        }
        List<String> product =
                new ArrayList<>(
                        wrap(
                                item.nameRu(),
                                fonts.regular(),
                                layout.itemFontSize(),
                                COLUMN_WIDTHS[1] - 2 * layout.horizontalPadding()));
        if (hasPrintableSku(item)) {
            product.add("Артикул: " + item.sku());
        }
        drawTableRow(
                page,
                new String[] {
                    String.valueOf(index),
                    String.join("\n", product),
                    item.quantity().stripTrailingZeros().toPlainString(),
                    "шт.",
                    money(item.unitPrice()),
                    money(item.lineTotal())
                },
                height,
                fonts,
                layout.itemFontSize(),
                false,
                layout);
    }

    private void drawReturnedItemRow(
            PageState page,
            int index,
            InvoiceItem item,
            float height,
            InvoiceFonts fonts,
            TableLayout layout)
            throws IOException {
        float bottom = drawTableGrid(page, height);
        List<String> product =
                new ArrayList<>(
                        wrap(
                                item.nameRu(),
                                fonts.regular(),
                                layout.itemFontSize(),
                                COLUMN_WIDTHS[1] - 2 * layout.horizontalPadding()));
        if (hasPrintableSku(item)) product.add("Артикул: " + item.sku());

        List<InvoiceCellLine> productLines = new ArrayList<>();
        for (String line : product) {
            productLines.add(new InvoiceCellLine(line, item.isFullyReturned()));
        }
        productLines.add(
                new InvoiceCellLine(
                        item.isFullyReturned() ? "Возвращено полностью" : "Возвращена часть товара",
                        false));

        drawCellLines(
                page,
                bottom,
                height,
                0,
                List.of(new InvoiceCellLine(String.valueOf(index), false)),
                fonts,
                layout,
                CellAlignment.CENTER);
        drawCellLines(
                page,
                bottom,
                height,
                1,
                productLines,
                fonts,
                layout,
                CellAlignment.LEFT);
        drawCellLines(
                page,
                bottom,
                height,
                2,
                List.of(
                        new InvoiceCellLine(quantity(item.quantity()), true),
                        new InvoiceCellLine(quantity(item.remainingQuantity()), false)),
                fonts,
                layout,
                CellAlignment.CENTER);
        drawCellLines(
                page,
                bottom,
                height,
                3,
                List.of(new InvoiceCellLine("шт.", false)),
                fonts,
                layout,
                CellAlignment.CENTER);
        drawCellLines(
                page,
                bottom,
                height,
                4,
                List.of(new InvoiceCellLine(money(item.unitPrice()), false)),
                fonts,
                layout,
                CellAlignment.RIGHT);
        drawCellLines(
                page,
                bottom,
                height,
                5,
                List.of(
                        new InvoiceCellLine(money(item.lineTotal()), true),
                        new InvoiceCellLine(money(item.remainingLineTotal()), false)),
                fonts,
                layout,
                CellAlignment.RIGHT);
    }

    private void drawTableRow(
            PageState page,
            String[] values,
            float height,
            InvoiceFonts fonts,
            float fontSize,
            boolean header,
            TableLayout layout)
            throws IOException {
        float bottom = drawTableGrid(page, height);
        float x = MARGIN;
        for (int column = 0; column < values.length; column++) {
            float width = COLUMN_WIDTHS[column];
            String[] lines = values[column].split("\\n");
            float lineHeight = layout.lineHeight();
            float baseline = bottom + height - layout.padding() - fontSize;
            if (lines.length == 1) {
                baseline = bottom + (height + fontSize) / 2 - 2;
            }
            for (String line : lines) {
                PDFont font = header ? fonts.bold() : fonts.regular();
                float measured = width(font, line, fontSize);
                float textX =
                        switch (column) {
                            case 0, 2, 3 -> x + (width - measured) / 2;
                            case 4, 5 -> x + width - layout.horizontalPadding() - measured;
                            default -> x + layout.horizontalPadding();
                        };
                text(page, line, textX, baseline, fonts, fontSize, header);
                baseline -= lineHeight;
            }
            x += width;
        }
    }

    private float drawTableGrid(PageState page, float height) throws IOException {
        float bottom = page.y - height;
        float x = MARGIN;
        page.content.setLineWidth(0.65f);
        for (float width : COLUMN_WIDTHS) {
            page.content.addRect(x, bottom, width, height);
            x += width;
        }
        page.content.stroke();
        page.y = bottom;
        return bottom;
    }

    private void drawCellLines(
            PageState page,
            float bottom,
            float height,
            int column,
            List<InvoiceCellLine> lines,
            InvoiceFonts fonts,
            TableLayout layout,
            CellAlignment alignment)
            throws IOException {
        float x = MARGIN;
        for (int index = 0; index < column; index++) x += COLUMN_WIDTHS[index];
        float width = COLUMN_WIDTHS[column];
        float fontSize = layout.itemFontSize();
        float blockHeight = lines.size() * layout.lineHeight();
        float baseline = bottom + (height + blockHeight) / 2 - layout.lineHeight() + 2;
        for (InvoiceCellLine line : lines) {
            float measured = width(fonts.regular(), line.value(), fontSize);
            float textX =
                    switch (alignment) {
                        case LEFT -> x + layout.horizontalPadding();
                        case CENTER -> x + (width - measured) / 2;
                        case RIGHT -> x + width - layout.horizontalPadding() - measured;
                    };
            text(page, line.value(), textX, baseline, fonts, fontSize, false);
            if (line.strikethrough()) strike(page, textX, baseline, measured, fontSize);
            baseline -= layout.lineHeight();
        }
    }

    private float rowHeight(InvoiceItem item, PDFont font, TableLayout layout) throws IOException {
        int lines =
                wrap(
                                item.nameRu(),
                                font,
                                layout.itemFontSize(),
                                COLUMN_WIDTHS[1] - 2 * layout.horizontalPadding())
                        .size();
        if (hasPrintableSku(item)) {
            lines++;
        }
        if (item.hasReturn()) lines++;
        return Math.max(layout.minRowHeight(), lines * layout.lineHeight() + layout.padding() * 2);
    }

    private boolean hasPrintableSku(InvoiceItem item) {
        return item.sku() != null && !item.sku().isBlank() && !MANUAL_ITEM_SKU.equals(item.sku());
    }

    private void drawSummaryAndSignatures(PageState page, InvoiceTotals totals, InvoiceFonts fonts)
            throws IOException {
        page.y -= 22;
        if (totals.hasReturns()) {
            drawSummaryLine(page, "Сумма до возврата", totals.originalTotal(), fonts, 10, false);
            page.y -= 16;
            drawSummaryLine(page, "К возврату", totals.returnedTotal(), fonts, 10, false);
            page.y -= 18;
            drawSummaryLine(page, "Итого после возврата", totals.remainingTotal(), fonts, 12, true);
        } else {
            drawSummaryLine(page, "Всего к оплате", totals.remainingTotal(), fonts, 12, true);
        }
        page.y -= 62;
        drawSignature(page, "Отпустил", MARGIN, fonts);
        drawSignature(page, "Получил", MARGIN + TABLE_WIDTH / 2 + 18, fonts);
        page.y -= 24;
    }

    private void drawSummaryLine(
            PageState page, String label, BigDecimal amount, InvoiceFonts fonts, float size, boolean bold)
            throws IOException {
        String value = label + ": " + money(amount) + " " + TENGE_SYMBOL;
        text(
                page,
                value,
                PAGE_WIDTH - MARGIN - width(bold ? fonts.bold() : fonts.regular(), value, size),
                page.y,
                fonts,
                size,
                bold);
    }

    /** Prints the customer-facing note directly below the delivery note, without a heading. */
    private PageState drawPrintComment(
            PDDocument document, PageState page, String printComment, InvoiceFonts fonts)
            throws IOException {
        List<String> lines = wrapPrintComment(printComment, fonts.regular(), 10, TABLE_WIDTH);
        if (lines.isEmpty()) return page;

        float lineHeight = 14;
        float commentHeight = lines.size() * lineHeight;
        float printableHeight = PAGE_HEIGHT - 2 * MARGIN;
        // Keep a normal multi-line note together. An unusually long note may span pages, but it
        // will always start as a whole block rather than being split at the bottom of the invoice.
        if (commentHeight <= printableHeight && page.y - commentHeight < MARGIN) {
            page.close();
            page = newPage(document);
        }

        for (String line : lines) {
            if (page.y - lineHeight < MARGIN) {
                page.close();
                page = newPage(document);
            }
            if (!line.isEmpty()) text(page, line, MARGIN, page.y, fonts, 10, false);
            page.y -= lineHeight;
        }
        return page;
    }

    private void drawSignature(PageState page, String label, float x, InvoiceFonts fonts)
            throws IOException {
        text(page, label, x, page.y, fonts, 10, false);
        float lineStart = x + 64;
        page.content.setLineWidth(0.65f);
        page.content.moveTo(lineStart, page.y - 3);
        page.content.lineTo(x + TABLE_WIDTH / 2 - 18, page.y - 3);
        page.content.stroke();
    }

    private List<String> wrap(String value, PDFont font, float fontSize, float maxWidth)
            throws IOException {
        String normalized =
                value == null || value.isBlank() ? "—" : value.trim().replaceAll("\\s+", " ");
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
                while (end > 1 && width(font, word.substring(0, end), fontSize) > maxWidth) {
                    end--;
                }
                lines.add(word.substring(0, end));
                word = word.substring(end);
            }
            current.append(word);
        }
        if (!current.isEmpty()) {
            lines.add(current.toString());
        }
        return lines;
    }

    private List<String> wrapPrintComment(String value, PDFont font, float fontSize, float maxWidth)
            throws IOException {
        if (value == null || value.isBlank()) return List.of();

        List<String> lines = new ArrayList<>();
        for (String paragraph : value.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1)) {
            if (paragraph.isBlank()) {
                lines.add("");
            } else {
                lines.addAll(wrap(paragraph, font, fontSize, maxWidth));
            }
        }
        return lines;
    }

    private InvoiceFonts loadUnicodeFonts(PDDocument document) throws IOException {
        for (FontFiles files : FONT_FILES) {
            File regular = new File(files.regular());
            File bold = new File(files.bold());
            if (regular.isFile() && bold.isFile()) {
                return new InvoiceFonts(
                        PDType0Font.load(document, regular), PDType0Font.load(document, bold));
            }
        }
        throw new IOException("Для накладной требуется шрифт с поддержкой кириллицы");
    }

    private void text(
            PageState page,
            String value,
            float x,
            float y,
            InvoiceFonts fonts,
            float size,
            boolean bold)
            throws IOException {
        page.content.beginText();
        page.content.setNonStrokingColor(Color.BLACK);
        page.content.setFont(bold ? fonts.bold() : fonts.regular(), size);
        page.content.newLineAtOffset(x, y);
        page.content.showText(value);
        page.content.endText();
    }

    private void strike(PageState page, float x, float baseline, float textWidth, float fontSize)
            throws IOException {
        page.content.setStrokingColor(Color.BLACK);
        page.content.setLineWidth(Math.max(0.55f, fontSize / 16));
        page.content.moveTo(x, baseline + fontSize * 0.32f);
        page.content.lineTo(x + textWidth, baseline + fontSize * 0.32f);
        page.content.stroke();
    }

    private float width(PDFont font, String value, float size) throws IOException {
        return font.getStringWidth(value) / 1000 * size;
    }

    private String money(BigDecimal amount) {
        DecimalFormat formatter =
                new DecimalFormat("#,##0.00", DecimalFormatSymbols.getInstance(RUSSIAN_LOCALE));
        return formatter.format(amount == null ? BigDecimal.ZERO : amount);
    }

    private String quantity(BigDecimal value) {
        return (value == null ? BigDecimal.ZERO : value).stripTrailingZeros().toPlainString();
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

    private record FontFiles(String regular, String bold) {}

    private record InvoiceFonts(PDFont regular, PDFont bold) {}

    private record InvoiceItem(
            String sku,
            String nameRu,
            BigDecimal quantity,
            BigDecimal unitPrice,
            BigDecimal lineTotal,
            BigDecimal returnedQuantity,
            BigDecimal remainingQuantity,
            BigDecimal returnedLineTotal,
            BigDecimal remainingLineTotal) {
        boolean hasReturn() {
            return returnedQuantity != null && returnedQuantity.signum() > 0;
        }

        boolean isFullyReturned() {
            return hasReturn() && remainingQuantity.signum() == 0;
        }
    }

    private record InvoiceTotals(
            BigDecimal originalTotal, BigDecimal returnedTotal, BigDecimal remainingTotal) {
        static InvoiceTotals withoutReturns(BigDecimal total) {
            return new InvoiceTotals(total, BigDecimal.ZERO, total);
        }

        static InvoiceTotals from(BigDecimal orderTotal, OrderReturnSummaryDto summary) {
            if (summary == null || summary.returnedTotal().signum() == 0) {
                return withoutReturns(orderTotal);
            }
            return new InvoiceTotals(
                    summary.originalTotal(), summary.returnedTotal(), summary.remainingTotal());
        }

        boolean hasReturns() {
            return returnedTotal.signum() > 0;
        }
    }

    private record InvoiceCellLine(String value, boolean strikethrough) {}

    private enum CellAlignment {
        LEFT,
        CENTER,
        RIGHT
    }

    private record TableLayout(
            float headerFontSize,
            float itemFontSize,
            float headerHeight,
            float minRowHeight,
            float lineHeight,
            float padding,
            float horizontalPadding) {
        static TableLayout forItemCount(int itemCount) {
            if (itemCount > 20) {
                return new TableLayout(8.5f, 8.5f, 19, 19, 11, 2, 2);
            }
            if (itemCount > 10) {
                return new TableLayout(8.5f, 8.5f, 20, 20, 11.5f, 2, 2);
            }
            if (itemCount > 2) {
                return new TableLayout(8.5f, 9, 20, 21, 12, 2, 2);
            }
            return new TableLayout(8.5f, 9, 22, 24, 12, 6, 5);
        }
    }
}
