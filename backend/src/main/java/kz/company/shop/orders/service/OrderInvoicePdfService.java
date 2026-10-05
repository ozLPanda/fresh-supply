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
    private static final DateTimeFormatter COMPACT_DATE_FORMATTER =
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
        Map<Long, OrderReturnSummaryDto.Item> returnsByItemId =
                returnSummary == null
                        ? Map.of()
                        : returnSummary.items().stream()
                                .collect(
                                        java.util.stream.Collectors.toMap(
                                                OrderReturnSummaryDto.Item::orderItemId,
                                                item -> item));
        return generateRelease(
                order,
                order.items().stream()
                        .map(item -> invoiceItem(item, returnsByItemId.get(item.id())))
                        .toList(),
                InvoiceTotals.from(order.total(), returnSummary),
                includePrintComment ? order.printComment() : null);
    }

    /** Prints the compact order delivery note used by the source shop. */
    public byte[] generateZ2(
            OrderDto order, OrderReturnSummaryDto returnSummary, boolean includePrintComment) {
        String number = order.displayCode().replaceAll("\\D", "");
        number =
                number.isEmpty()
                        ? order.displayCode()
                        : String.format("%010d", new java.math.BigInteger(number));
        String title =
                "Товарная накладная № "
                        + number
                        + " от "
                        + COMPACT_DATE_FORMATTER.format(
                                (order.invoiceIssuedAt() == null
                                                ? order.createdAt()
                                                : order.invoiceIssuedAt())
                                        .atZone(TIME_ZONE));
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
                includePrintComment ? order.printComment() : null,
                "ИП \"GASTROFLOW\"",
                order.regularBuyerName() == null ? "" : order.regularBuyerName());
    }

    private static final float FORM_MARGIN = 24;
    private static final float FORM_WIDTH = PAGE_WIDTH - 2 * FORM_MARGIN;
    private static final float[] FORM_COLUMNS = {32, 137, 47, 43, 49, 49, 60, 73, FORM_WIDTH - 490};
    private static final float FORM_FONT = 7.5f;

    private byte[] generateRelease(
            OrderDto order, List<InvoiceItem> items, InvoiceTotals totals, String printComment) {
        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            InvoiceFonts fonts = loadUnicodeFonts(document);
            PageState page = newPage(document);
            drawReleaseHeader(page, order, fonts);
            drawReleaseTableHeader(page, fonts);
            for (int index = 0; index < items.size(); index++) {
                List<List<InvoiceCellLine>> cells =
                        releaseCells(index + 1, items.get(index), fonts);
                int lineCount = cells.stream().mapToInt(List::size).max().orElse(1);
                // Split unusually long product names across pages instead of drawing beyond the
                // sheet.
                int offset = 0;
                while (offset < lineCount) {
                    int available = (int) ((page.y - FORM_MARGIN - 6) / 10);
                    if (available < 2) {
                        page.close();
                        page = newPage(document);
                        text(
                                page,
                                "Накладная № " + order.displayCode() + " (продолжение)",
                                FORM_MARGIN,
                                page.y,
                                fonts,
                                9,
                                true);
                        page.y -= 18;
                        drawReleaseTableHeader(page, fonts);
                        available = (int) ((page.y - FORM_MARGIN - 6) / 10);
                    }
                    int count = Math.min(lineCount - offset, available);
                    List<List<InvoiceCellLine>> part = new ArrayList<>();
                    for (List<InvoiceCellLine> cell : cells) {
                        part.add(
                                cell.subList(
                                        Math.min(offset, cell.size()),
                                        Math.min(offset + count, cell.size())));
                    }
                    drawReleaseRow(page, part, Math.max(17, count * 10 + 5), fonts, false);
                    offset += count;
                }
            }
            BigDecimal quantity =
                    items.stream()
                            .map(InvoiceItem::remainingQuantity)
                            .reduce(BigDecimal.ZERO, BigDecimal::add);
            String quantityWords = releaseQuantityWords(items);
            String moneyWords =
                    RussianInvoiceWords.capitalize(
                            RussianInvoiceWords.money(totals.remainingTotal()));
            int footerLines =
                    wrap(quantityWords, fonts.bold(), 8, FORM_WIDTH).size()
                            + wrap(
                                            "На сумму (прописью), в KZT: " + moneyWords,
                                            fonts.regular(),
                                            8,
                                            FORM_WIDTH)
                                    .size();
            float footerHeight = 165 + footerLines * 11 + (totals.hasReturns() ? 36 : 0);
            if (page.y - footerHeight < FORM_MARGIN) {
                page.close();
                page = newPage(document);
                text(
                        page,
                        "Накладная № " + order.displayCode() + " - итоги",
                        FORM_MARGIN,
                        page.y,
                        fonts,
                        9,
                        true);
                page.y -= 18;
            }
            drawReleaseRow(
                    page,
                    simpleCells(
                            new String[] {
                                "",
                                "Итого",
                                "",
                                "",
                                quantity(quantity),
                                quantity(quantity),
                                "x",
                                money(totals.remainingTotal()),
                                "0,00"
                            }),
                    18,
                    fonts,
                    true);
            if (totals.hasReturns()) {
                page.y -= 12;
                text(
                        page,
                        "Сумма до возврата: "
                                + money(totals.originalTotal())
                                + " KZT; К возврату: "
                                + money(totals.returnedTotal())
                                + " KZT",
                        FORM_MARGIN,
                        page.y,
                        fonts,
                        8,
                        false);
                page.y -= 12;
                text(
                        page,
                        "Итого после возврата: " + money(totals.remainingTotal()) + " KZT",
                        FORM_MARGIN,
                        page.y,
                        fonts,
                        8,
                        true);
            }
            page.y -= 17;
            drawReleaseParagraph(
                    page, "Всего отпущено количество запасов (прописью):", fonts, false);
            drawReleaseParagraph(page, quantityWords, fonts, true);
            page.y -= 5;
            drawReleaseParagraph(page, "На сумму (прописью), в KZT: " + moneyWords, fonts, false);
            page.y -= 15;
            drawReleaseSignatures(page, fonts);
            page = drawPrintComment(document, page, printComment, fonts);
            page.close();
            for (int index = 0; index < document.getNumberOfPages(); index++) {
                PDPage pdfPage = document.getPage(index);
                try (PDPageContentStream content =
                        new PDPageContentStream(
                                document, pdfPage, PDPageContentStream.AppendMode.APPEND, true)) {
                    PageState footer = new PageState(content, 13);
                    text(
                            footer,
                            "Страница " + (index + 1) + " из " + document.getNumberOfPages(),
                            FORM_MARGIN,
                            13,
                            fonts,
                            7,
                            false);
                }
            }
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Не удалось сформировать PDF накладной", exception);
        }
    }

    private void drawReleaseHeader(PageState page, OrderDto order, InvoiceFonts fonts)
            throws IOException {
        float right = PAGE_WIDTH - FORM_MARGIN;
        float y = PAGE_HEIGHT - 29;
        for (String line :
                List.of(
                        "Приложение 26",
                        "к приказу Министра финансов",
                        "Республики Казахстан",
                        "от 20 декабря 2012 года № 562",
                        "",
                        "Форма З-2")) {
            text(page, line, right - width(fonts.regular(), line, 7.5f), y, fonts, 7.5f, false);
            y -= 10;
        }
        page.y = y - 15;
        text(
                page,
                "Организация (индивидуальный предприниматель)",
                FORM_MARGIN,
                page.y,
                fonts,
                7.5f,
                false);
        page.y -= 13;
        text(
                page,
                "Индивидуальный предприниматель \"GASTROFLOW\"",
                FORM_MARGIN,
                page.y,
                fonts,
                9,
                true);
        text(page, "ИИН/БИН 910818451048", right - 130, page.y, fonts, 8, true);
        page.y -= 20;
        float boxX = right - 178;
        formBox(page, boxX, page.y, 84, 22, "Номер документа", fonts, 7.5f, false);
        formBox(page, boxX + 84, page.y, 94, 22, "Дата составления", fonts, 7.5f, false);
        String date =
                DateTimeFormatter.ofPattern("dd.MM.yyyy")
                        .format(
                                (order.invoiceIssuedAt() == null
                                                ? order.createdAt()
                                                : order.invoiceIssuedAt())
                                        .atZone(TIME_ZONE));
        formBox(page, boxX, page.y - 22, 84, 17, order.displayCode(), fonts, 8, true);
        formBox(page, boxX + 84, page.y - 22, 94, 17, date, fonts, 8, true);
        page.y -= 59;
        String title = "НАКЛАДНАЯ НА ОТПУСК ЗАПАСОВ НА СТОРОНУ";
        text(
                page,
                title,
                FORM_MARGIN + (FORM_WIDTH - width(fonts.bold(), title, 10)) / 2,
                page.y,
                fonts,
                10,
                true);
        page.y -= 20;
        String[] labels = {
            "Организация (индивидуальный предприниматель) - отправитель",
            "Организация (индивидуальный предприниматель) - получатель",
            "Ответственный за поставку (Ф.И.О.)",
            "Транспортная организация",
            "Товарно-транспортная накладная (номер, дата)"
        };
        String[] values = {
            "ИП \"GASTROFLOW\"",
            order.regularBuyerName() == null ? "" : order.regularBuyerName(),
            "",
            "",
            ""
        };
        float[] widths = {119, 119, 103, 92, FORM_WIDTH - 433};
        float x = FORM_MARGIN;
        float valueHeight = 27;
        for (int i = 0; i < values.length; i++) {
            valueHeight =
                    Math.max(
                            valueHeight,
                            wrap(values[i], fonts.regular(), 8, widths[i] - 6).size() * 10 + 8);
        }
        for (int i = 0; i < labels.length; i++) {
            formBox(page, x, page.y, widths[i], 39, labels[i], fonts, 7, false);
            formBox(page, x, page.y - 39, widths[i], valueHeight, values[i], fonts, 8, false);
            x += widths[i];
        }
        page.y -= 39 + valueHeight + 10;
    }

    private void drawReleaseTableHeader(PageState page, InvoiceFonts fonts) throws IOException {
        String[] labels = {
            "№ п/п",
            "Наименование, характеристика",
            "Номенкла-\nтурный номер",
            "Ед.\nизм.",
            "подлежит\nотпуску",
            "отпущено",
            "Цена за единицу, в KZT",
            "Сумма с НДС, в KZT",
            "Сумма НДС, в KZT"
        };
        float x = FORM_MARGIN;
        for (int i = 0; i < labels.length; i++) {
            if (i == 4)
                formBox(
                        page,
                        x,
                        page.y,
                        FORM_COLUMNS[4] + FORM_COLUMNS[5],
                        15,
                        "Количество",
                        fonts,
                        7,
                        false);
            formBox(
                    page,
                    x,
                    page.y - (i == 4 || i == 5 ? 15 : 0),
                    FORM_COLUMNS[i],
                    i == 4 || i == 5 ? 31 : 46,
                    labels[i],
                    fonts,
                    7,
                    false);
            x += FORM_COLUMNS[i];
        }
        page.y -= 46;
        drawReleaseRow(
                page,
                simpleCells(new String[] {"1", "2", "3", "4", "5", "6", "7", "8", "9"}),
                13,
                fonts,
                false);
    }

    private List<List<InvoiceCellLine>> releaseCells(
            int index, InvoiceItem item, InvoiceFonts fonts) throws IOException {
        List<List<InvoiceCellLine>> cells = new ArrayList<>();
        String[] values = {
            String.valueOf(index),
            item.nameRu(),
            hasPrintableSku(item) ? item.sku() : "",
            item.kilograms() ? "кг" : "шт.",
            quantity(item.quantity()),
            quantity(item.quantity()),
            money(item.unitPrice()),
            money(item.lineTotal()),
            "0,00"
        };
        for (int column = 0; column < values.length; column++) {
            List<InvoiceCellLine> lines = new ArrayList<>();
            if (!values[column].isEmpty()) {
                for (String line :
                        wrap(
                                values[column],
                                fonts.regular(),
                                FORM_FONT,
                                FORM_COLUMNS[column] - 6)) {
                    lines.add(
                            new InvoiceCellLine(
                                    line,
                                    item.hasReturn()
                                            && (column == 4
                                                    || column == 5
                                                    || column == 7
                                                    || column == 1 && item.isFullyReturned())));
                }
            }
            if (item.hasReturn()) {
                String extra =
                        switch (column) {
                            case 1 ->
                                    item.isFullyReturned()
                                            ? "Возвращено полностью"
                                            : "Возвращена часть товара";
                            case 4, 5 -> quantity(item.remainingQuantity());
                            case 7 -> money(item.remainingLineTotal());
                            default -> null;
                        };
                if (extra != null)
                    for (String line :
                            wrap(extra, fonts.regular(), FORM_FONT, FORM_COLUMNS[column] - 6))
                        lines.add(new InvoiceCellLine(line, false));
            }
            cells.add(lines);
        }
        return cells;
    }

    private List<List<InvoiceCellLine>> simpleCells(String[] values) {
        return java.util.Arrays.stream(values)
                .map(value -> List.of(new InvoiceCellLine(value, false)))
                .toList();
    }

    private void drawReleaseRow(
            PageState page,
            List<List<InvoiceCellLine>> cells,
            float height,
            InvoiceFonts fonts,
            boolean bold)
            throws IOException {
        float x = FORM_MARGIN;
        for (int column = 0; column < cells.size(); column++) {
            page.content.setLineWidth(0.5f);
            page.content.addRect(x, page.y - height, FORM_COLUMNS[column], height);
            page.content.stroke();
            List<InvoiceCellLine> lines = cells.get(column);
            float baseline = page.y - (height - lines.size() * 10) / 2 - 8;
            for (InvoiceCellLine line : lines) {
                PDFont font = bold ? fonts.bold() : fonts.regular();
                float size =
                        Math.min(
                                FORM_FONT,
                                (FORM_COLUMNS[column] - 6)
                                        / Math.max(1, width(font, line.value(), 1)));
                float measured = width(font, line.value(), size);
                float textX =
                        column == 1
                                ? x + 3
                                : column >= 4
                                        ? x + FORM_COLUMNS[column] - measured - 3
                                        : x + (FORM_COLUMNS[column] - measured) / 2;
                text(page, line.value(), textX, baseline, fonts, size, bold);
                if (line.strikethrough()) strike(page, textX, baseline, measured, size);
                baseline -= 10;
            }
            x += FORM_COLUMNS[column];
        }
        page.y -= height;
    }

    private void formBox(
            PageState page,
            float x,
            float top,
            float w,
            float h,
            String value,
            InvoiceFonts fonts,
            float size,
            boolean bold)
            throws IOException {
        page.content.setLineWidth(0.5f);
        page.content.addRect(x, top - h, w, h);
        page.content.stroke();
        if (value == null || value.isBlank()) return;
        List<String> lines = new ArrayList<>();
        while (true) {
            lines.clear();
            for (String part : value.split("\\n"))
                lines.addAll(wrap(part, bold ? fonts.bold() : fonts.regular(), size, w - 6));
            if (lines.size() * (size + 2) <= h - 4 || size <= 4.5f) break;
            size -= 0.25f;
        }
        float lineHeight = size + 2;
        float y = top - (h - lines.size() * lineHeight) / 2 - size;
        for (String line : lines) {
            text(
                    page,
                    line,
                    x + (w - width(bold ? fonts.bold() : fonts.regular(), line, size)) / 2,
                    y,
                    fonts,
                    size,
                    bold);
            y -= lineHeight;
        }
    }

    private String releaseQuantityWords(List<InvoiceItem> items) {
        Map<Boolean, BigDecimal> quantities = new java.util.LinkedHashMap<>();
        for (InvoiceItem item : items)
            quantities.merge(item.kilograms(), item.remainingQuantity(), BigDecimal::add);
        if (quantities.isEmpty()) return "Ноль";
        return RussianInvoiceWords.capitalize(
                quantities.entrySet().stream()
                        .map(
                                entry ->
                                        RussianInvoiceWords.quantity(
                                                entry.getValue(), entry.getKey()))
                        .collect(java.util.stream.Collectors.joining("; ")));
    }

    private void drawReleaseParagraph(
            PageState page, String value, InvoiceFonts fonts, boolean bold) throws IOException {
        for (String line : wrap(value, bold ? fonts.bold() : fonts.regular(), 8, FORM_WIDTH)) {
            text(page, line, FORM_MARGIN, page.y, fonts, 8, bold);
            page.y -= 11;
        }
    }

    private void drawReleaseSignatures(PageState page, InvoiceFonts fonts) throws IOException {
        float x = FORM_MARGIN;
        float right = FORM_MARGIN + FORM_WIDTH * .55f;
        text(page, "Отпуск разрешил", x, page.y, fonts, 7.5f, false);
        text(page, "директор", x + 77, page.y, fonts, 7.5f, false);
        text(page, "________ / Гайсумов Р.М.", x + 130, page.y, fonts, 7.5f, false);
        text(page, "По доверенности __________________________", right, page.y, fonts, 7.5f, false);
        page.y -= 11;
        text(
                page,
                "должность       подпись       расшифровка подписи",
                x + 76,
                page.y,
                fonts,
                6,
                false);
        text(
                page,
                "выданной __________________________________",
                right,
                page.y,
                fonts,
                7.5f,
                false);
        page.y -= 22;
        text(
                page,
                "Главный бухгалтер __________ / __________________",
                x,
                page.y,
                fonts,
                7.5f,
                false);
        text(
                page,
                "___________________________________________",
                right,
                page.y,
                fonts,
                7.5f,
                false);
        page.y -= 11;
        text(page, "подпись           расшифровка подписи", x + 92, page.y, fonts, 6, false);
        page.y -= 12;
        text(page, "М.П.", x, page.y, fonts, 8, true);
        page.y -= 19;
        text(page, "Отпустил __________ / Гайсумов Р.М.", x, page.y, fonts, 7.5f, false);
        text(
                page,
                "Запасы получил __________ / _________________",
                right,
                page.y,
                fonts,
                7.5f,
                false);
        page.y -= 11;
        text(page, "подпись       расшифровка подписи", x + 45, page.y, fonts, 6, false);
        text(page, "подпись       расшифровка подписи", right + 83, page.y, fonts, 6, false);
        page.y -= 12;
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
        return generate(title, items, totals, printComment, "GastroFlow", null);
    }

    private byte[] generate(
            String title,
            List<InvoiceItem> items,
            InvoiceTotals totals,
            String printComment,
            String supplier,
            String buyer) {
        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            InvoiceFonts fonts = loadUnicodeFonts(document);
            TableLayout tableLayout = TableLayout.forItemCount(items.size());
            PageState page = newPage(document);
            page.y = drawHeader(page, title, supplier, buyer, fonts);
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
                item.measurementUnit() != null && item.measurementUnit().name().equals("KG"),
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
                false,
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

    private float drawHeader(
            PageState page, String title, String supplier, String buyer, InvoiceFonts fonts)
            throws IOException {
        text(page, title, MARGIN, page.y, fonts, 14, true);
        page.content.setLineWidth(1.2f);
        page.content.moveTo(MARGIN, page.y - 7);
        page.content.lineTo(PAGE_WIDTH - MARGIN, page.y - 7);
        page.content.stroke();
        page.y -= 32;
        text(page, "Поставщик:", MARGIN, page.y, fonts, 10, false);
        text(
                page,
                supplier,
                MARGIN + width(fonts.regular(), "Поставщик:", 10) + 8,
                page.y,
                fonts,
                10,
                true);
        if (buyer != null) {
            page.y -= 18;
            text(page, "Покупатель:", MARGIN, page.y, fonts, 10, false);
            float buyerX = MARGIN + width(fonts.regular(), "Покупатель:", 10) + 8;
            List<String> buyerLines =
                    buyer.isBlank()
                            ? List.of()
                            : wrap(buyer, fonts.bold(), 10, PAGE_WIDTH - MARGIN - buyerX);
            for (int index = 0; index < buyerLines.size(); index++) {
                if (index > 0) page.y -= 13;
                text(page, buyerLines.get(index), buyerX, page.y, fonts, 10, true);
            }
        }
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
                    item.kilograms() ? "кг" : "шт.",
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
        drawCellLines(page, bottom, height, 1, productLines, fonts, layout, CellAlignment.LEFT);
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
                List.of(new InvoiceCellLine(item.kilograms() ? "кг" : "шт.", false)),
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
            PageState page,
            String label,
            BigDecimal amount,
            InvoiceFonts fonts,
            float size,
            boolean bold)
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
        return (value == null ? BigDecimal.ZERO : value)
                .stripTrailingZeros()
                .toPlainString()
                .replace('.', ',');
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
            boolean kilograms,
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
