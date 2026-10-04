package kz.company.shop.orders.service;

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
import java.util.stream.Collectors;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.dto.OrderItemDto;
import kz.company.shop.orders.dto.OrderReturnSummaryDto;
import kz.company.shop.products.entity.MeasurementUnit;
import kz.company.shop.settings.dto.PaymentInvoiceSettingsDto;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Service;

/** Payment invoice matching the supplier's approved bank and payment form. */
@Service
public class OrderPaymentInvoicePdfService {
    private static final float MARGIN = 28;
    private static final float WIDTH = PDRectangle.A4.getWidth() - MARGIN * 2;
    private static final float BOTTOM = 32;
    private static final float FONT_SIZE = 8;
    private static final float LEADING = 11;
    private static final float[] COLUMNS = {24, 60, 202, 55, 28, 75, WIDTH - 444};
    private static final String[] HEADERS = {
        "№", "Код", "Наименование", "Кол-во", "Ед.", "Цена", "Сумма"
    };
    private static final List<String[]> FONT_FILES =
            List.of(
                    new String[] {
                        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
                    },
                    new String[] {
                        "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
                        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"
                    },
                    new String[] {
                        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
                    });

    public byte[] generate(
            OrderDto order, OrderReturnSummaryDto returnSummary, String buyerDetails, PaymentInvoiceSettingsDto settings) {
        Map<Long, OrderReturnSummaryDto.Item> returns =
                returnSummary == null
                        ? Map.of()
                        : returnSummary.items().stream()
                                .collect(Collectors.toMap(OrderReturnSummaryDto.Item::orderItemId, item -> item));
        List<PaymentItem> items = new ArrayList<>();
        for (OrderItemDto item : order.items()) {
            OrderReturnSummaryDto.Item returned = returns.get(item.id());
            // Untouched summary rows can contain prices from before a discount/price review.
            boolean hasReturn = returned != null && returned.returnedQuantity().signum() > 0;
            BigDecimal quantity = hasReturn ? returned.remainingQuantity() : item.quantity();
            if (hasReturn && quantity.signum() == 0) continue;
            items.add(new PaymentItem(item, quantity, hasReturn ? returned.remainingAmount() : item.lineTotal()));
        }
        BigDecimal total =
                returnSummary != null && returnSummary.returnedTotal().signum() > 0
                        ? returnSummary.remainingTotal()
                        : order.total();
        // This document records the goods' value; payments do not reduce its invoice total.
        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Fonts fonts = loadFonts(document);
            try (Layout layout = new Layout(document, fonts, order.displayCode(), settings)) {
                layout.header(order, buyerDetails);
                layout.tableHeader();
                for (int index = 0; index < items.size(); index++) {
                    PaymentItem item = items.get(index);
                    String sku = item.source().sku();
                    layout.item(new String[] {
                        String.valueOf(index + 1),
                        sku == null || sku.equalsIgnoreCase("Ручная позиция") ? "" : sku,
                        item.source().nameRu(),
                        item.quantity().stripTrailingZeros().toPlainString().replace('.', ','),
                        item.source().measurementUnit() == MeasurementUnit.KG ? "кг" : "шт",
                        money(item.source().unitPrice()),
                        money(item.total())
                    });
                }
                layout.summary(items.size(), total);
            }
            addPageNumbers(document, fonts);
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Не удалось сформировать PDF счёта на оплату", exception);
        }
    }

    private static final class Layout implements AutoCloseable {
        private final PDDocument document;
        private final Fonts fonts;
        private final String orderCode;
        private final PaymentInvoiceSettingsDto settings;
        private PDPageContentStream content;
        private float y;

        private Layout(PDDocument document, Fonts fonts, String orderCode, PaymentInvoiceSettingsDto settings) throws IOException {
            this.document = document;
            this.fonts = fonts;
            this.orderCode = orderCode;
            this.settings = settings;
            nextPage(false);
        }

        private void nextPage(boolean continuation) throws IOException {
            if (content != null) content.close();
            PDPage page = new PDPage(PDRectangle.A4);
            document.addPage(page);
            content = new PDPageContentStream(document, page);
            content.setLineWidth(0.6f);
            y = PDRectangle.A4.getHeight() - MARGIN;
            if (continuation) {
                for (String line : wrap("Счет на оплату №" + orderCode + " (продолжение)", fonts.bold(), 9, WIDTH)) {
                    text(content, fonts.bold(), 9, MARGIN, y - 9, line);
                    y -= 13;
                }
                y -= 6;
            }
        }

        private void ensure(float height) throws IOException {
            if (y - height < BOTTOM) nextPage(true);
        }

        private void paragraph(String value, float x, float width, float size, boolean bold)
                throws IOException {
            PDFont font = bold ? fonts.bold() : fonts.regular();
            for (String line : wrap(value, font, size, width)) {
                ensure(size + 4);
                text(content, font, size, x, y - size, line);
                y -= size + 4;
            }
        }

        private void header(OrderDto order, String buyerDetails) throws IOException {
            if (settings.paymentTerms() != null && !settings.paymentTerms().isBlank()) {
                paragraph(settings.paymentTerms(), MARGIN + 155, WIDTH - 155, 8, false);
                y -= 12;
            }
            String beneficiary = "Бенефициар:\n" + settings.supplierName() + "\n\nБИН: " + settings.supplierTaxId();
            String account = "ИИК\n\n" + settings.iban();
            String code = "Кбе\n\n" + settings.beneficiaryCode();
            String bank = "Банк бенефициара:\n" + settings.bankName();
            String bic = "БИК\n" + settings.bic();
            String purpose = "Код назначения платежа\n" + settings.paymentPurposeCode();
            float firstHeight = Math.max(62, Math.max(boxHeight(beneficiary, 300, false),
                    Math.max(boxHeight(account, 150, true), boxHeight(code, WIDTH - 450, true))));
            float secondHeight = Math.max(40, Math.max(boxHeight(bank, 300, false),
                    Math.max(boxHeight(bic, 100, true), boxHeight(purpose, WIDTH - 400, true))));
            ensure(firstHeight + secondHeight + 30);
            paragraph("Образец платежного поручения", MARGIN, WIDTH, 11, true);
            box(MARGIN, y, 300, firstHeight, beneficiary, false, false);
            box(MARGIN + 300, y, 150, firstHeight, account, true, true);
            box(MARGIN + 450, y, WIDTH - 450, firstHeight, code, true, true);
            y -= firstHeight;
            box(MARGIN, y, 300, secondHeight, bank, false, false);
            box(MARGIN + 300, y, 100, secondHeight, bic, true, true);
            box(MARGIN + 400, y, WIDTH - 400, secondHeight, purpose, true, true);
            y -= secondHeight + 20;
            String date = DateTimeFormatter.ofPattern("dd.MM.yyyy")
                    .format(order.createdAt().atZone(ZoneId.of("Asia/Almaty")));
            paragraph("Счет на оплату №" + order.displayCode() + " от " + date, MARGIN, WIDTH, 15, true);
            y -= 6;
            line(MARGIN, y, MARGIN + WIDTH, y, 1.2f);
            y -= 10;
            detail("Поставщик:", settings.supplierName());
            detail("Покупатель:", buyerDetails == null ? "" : buyerDetails);
            detail("Договор:", settings.contract() == null ? "" : settings.contract());
            y -= 4;
        }

        private void detail(String label, String value) throws IOException {
            ensure(18);
            text(content, fonts.regular(), 9, MARGIN, y - 9, label);
            paragraph(value, MARGIN + 83, WIDTH - 83, 9, true);
            y -= 10;
        }

        private float boxHeight(String value, float width, boolean bold) throws IOException {
            return wrap(value, bold ? fonts.bold() : fonts.regular(), 8.5f, width - 8).size() * 11 + 6;
        }

        private void box(float x, float top, float width, float height, String value, boolean bold, boolean center)
                throws IOException {
            content.addRect(x, top - height, width, height);
            content.stroke();
            PDFont font = bold ? fonts.bold() : fonts.regular();
            float baseline = top - 12;
            for (String row : wrap(value, font, 8.5f, width - 8)) {
                float left = center ? x + (width - width(font, row, 8.5f)) / 2 : x + 4;
                text(content, font, 8.5f, left, baseline, row);
                baseline -= 11;
            }
        }

        private void tableHeader() throws IOException {
            ensure(24);
            drawRow(cells(HEADERS, fonts.bold()), 0, 1, true);
        }

        private List<List<String>> cells(String[] values, PDFont font) throws IOException {
            List<List<String>> cells = new ArrayList<>();
            for (int i = 0; i < values.length; i++)
                cells.add(wrap(values[i], font, FONT_SIZE, COLUMNS[i] - 6));
            return cells;
        }

        private void item(String[] values) throws IOException {
            List<List<String>> cells = cells(values, fonts.regular());
            int count = cells.stream().mapToInt(List::size).max().orElse(1);
            int offset = 0;
            while (offset < count) {
                int available = (int) ((y - BOTTOM - 6) / LEADING);
                if (available < 1) {
                    nextPage(true);
                    tableHeader();
                    available = (int) ((y - BOTTOM - 6) / LEADING);
                }
                int part = Math.min(available, count - offset);
                drawRow(cells, offset, part, false);
                offset += part;
            }
        }

        private void drawRow(List<List<String>> cells, int offset, int count, boolean bold)
                throws IOException {
            float height = count * LEADING + 6;
            float x = MARGIN;
            PDFont font = bold ? fonts.bold() : fonts.regular();
            for (int column = 0; column < COLUMNS.length; column++) {
                content.addRect(x, y - height, COLUMNS[column], height);
                content.stroke();
                List<String> lines = cells.get(column);
                for (int i = offset; i < Math.min(offset + count, lines.size()); i++) {
                    String value = lines.get(i);
                    float textWidth = width(font, value, FONT_SIZE);
                    float left = bold || column == 0 || column == 4
                            ? x + (COLUMNS[column] - textWidth) / 2
                            : column >= 3 ? x + COLUMNS[column] - textWidth - 3 : x + 3;
                    text(content, font, FONT_SIZE, left, y - 11 - (i - offset) * LEADING, value);
                }
                x += COLUMNS[column];
            }
            y -= height;
        }

        private void summary(int count, BigDecimal total) throws IOException {
            String words = "Всего к оплате: " + RussianInvoiceWords.money(total);
            String executor = settings.executor() == null || settings.executor().isBlank()
                    ? "" : "/" + settings.executor() + "/";
            int executorLines = wrap(executor, fonts.regular(), 9, WIDTH - 310).size();
            ensure(118 + wrap(words, fonts.bold(), 9, WIDTH).size() * 13 + Math.max(0, executorLines - 1) * 13);
            y -= 10;
            totalLine("Итого:", money(total));
            totalLine("В том числе НДС:", "0,00");
            y -= 8;
            paragraph("Всего наименований " + count + ", на сумму " + money(total) + " KZT", MARGIN, WIDTH, 9, false);
            paragraph(words, MARGIN, WIDTH, 9, true);
            y -= 7;
            line(MARGIN, y, MARGIN + WIDTH, y, 1.2f);
            y -= 22;
            text(content, fonts.bold(), 9, MARGIN, y - 9, "Исполнитель");
            line(MARGIN + 85, y - 11, MARGIN + 305, y - 11, 0.6f);
            paragraph(executor, MARGIN + 310, WIDTH - 310, 9, false);
            y -= 14;
        }

        private void totalLine(String label, String value) throws IOException {
            text(content, fonts.bold(), 9, MARGIN + WIDTH - 215, y - 9, label);
            text(content, fonts.bold(), 9, MARGIN + WIDTH - width(fonts.bold(), value, 9) - 3, y - 9, value);
            y -= 15;
        }

        private void line(float x1, float y1, float x2, float y2, float thickness) throws IOException {
            content.setLineWidth(thickness);
            content.moveTo(x1, y1);
            content.lineTo(x2, y2);
            content.stroke();
            content.setLineWidth(0.6f);
        }

        @Override
        public void close() throws IOException {
            if (content != null) content.close();
        }
    }

    /** Wrap both words and arbitrarily long identifiers, preserving explicit paragraph breaks. */
    private static List<String> wrap(String value, PDFont font, float size, float maxWidth)
            throws IOException {
        List<String> result = new ArrayList<>();
        for (String paragraph : (value == null ? "" : value).replace('\r', '\n').split("\n", -1)) {
            String normalized = paragraph.trim().replaceAll("\\s+", " ");
            if (normalized.isEmpty()) {
                result.add("");
                continue;
            }
            int start = 0;
            while (start < normalized.length()) {
                int end = start;
                int lastSpace = -1;
                float used = 0;
                while (end < normalized.length()) {
                    int next = end + Character.charCount(normalized.codePointAt(end));
                    float glyph = width(font, normalized.substring(end, next), size);
                    if (used + glyph > maxWidth && end > start) break;
                    used += glyph;
                    if (normalized.charAt(end) == ' ') lastSpace = end;
                    end = next;
                }
                if (end < normalized.length() && lastSpace > start) end = lastSpace;
                result.add(normalized.substring(start, end).stripTrailing());
                start = end;
                while (start < normalized.length() && normalized.charAt(start) == ' ') start++;
            }
        }
        return result;
    }

    private static void text(PDPageContentStream content, PDFont font, float size, float x, float y, String value)
            throws IOException {
        content.beginText();
        content.setFont(font, size);
        content.newLineAtOffset(x, y);
        content.showText(value);
        content.endText();
    }

    private static float width(PDFont font, String value, float size) throws IOException {
        return font.getStringWidth(value) * size / 1000;
    }

    private static String money(BigDecimal value) {
        return new DecimalFormat("#,##0.00", DecimalFormatSymbols.getInstance(Locale.forLanguageTag("ru-RU")))
                .format(value);
    }

    private static Fonts loadFonts(PDDocument document) throws IOException {
        for (String[] pair : FONT_FILES) {
            if (new File(pair[0]).isFile() && new File(pair[1]).isFile())
                return new Fonts(PDType0Font.load(document, new File(pair[0])), PDType0Font.load(document, new File(pair[1])));
        }
        throw new IOException("Для счёта на оплату требуется шрифт с поддержкой кириллицы");
    }

    private static void addPageNumbers(PDDocument document, Fonts fonts) throws IOException {
        for (int index = 0; index < document.getNumberOfPages(); index++) {
            try (PDPageContentStream content = new PDPageContentStream(document, document.getPage(index), PDPageContentStream.AppendMode.APPEND, true)) {
                text(content, fonts.regular(), 7, MARGIN, 16, "Страница " + (index + 1) + " из " + document.getNumberOfPages());
            }
        }
    }

    private record Fonts(PDFont regular, PDFont bold) {}
    private record PaymentItem(OrderItemDto source, BigDecimal quantity, BigDecimal total) {}
}
