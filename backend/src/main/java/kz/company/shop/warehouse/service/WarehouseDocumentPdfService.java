package kz.company.shop.warehouse.service;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.StockDocumentType;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Service;

/** A printable product list for supplier orders and receipts. Prices are intentionally omitted. */
@Service
public class WarehouseDocumentPdfService {
    private static final PDRectangle PAGE = PDRectangle.A4;
    private static final float MARGIN = 40;
    private static final float FONT_SIZE = 9;
    private static final float LINE_HEIGHT = 13;
    private static final float PADDING = 6;
    private static final float[] WIDTHS = {125, 300, 90};
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
                    },
                    new String[] {
                        "/System/Library/Fonts/Supplemental/Arial.ttf",
                        "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
                    });

    private final WarehouseService warehouseService;

    public WarehouseDocumentPdfService(WarehouseService warehouseService) {
        this.warehouseService = warehouseService;
    }

    public byte[] generate(UUID id) {
        WarehouseDto.Document source = warehouseService.getDocument(id, false);
        if (source.type() != StockDocumentType.PURCHASE_ORDER
                && source.type() != StockDocumentType.RECEIPT) {
            throw new AppExceptions.BadRequest(
                    "PDF доступен только для заказа поставщику и прихода");
        }
        try (PDDocument pdf = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Fonts fonts = loadFonts(pdf);
            PageState page = addPage(pdf, fonts, source, 1);
            for (WarehouseDto.DocumentLine line : source.lines()) {
                List<String> sku = wrap(value(line.sku()), fonts.regular, WIDTHS[0] - PADDING * 2);
                List<String> name =
                        wrap(value(line.productName()), fonts.regular, WIDTHS[1] - PADDING * 2);
                float rowHeight =
                        Math.max(28, Math.max(sku.size(), name.size()) * LINE_HEIGHT + PADDING * 2);
                if (page.y - rowHeight < MARGIN + 15) {
                    finishPage(page, fonts);
                    page = addPage(pdf, fonts, source, page.number + 1);
                }
                drawRow(page, fonts, sku, name, quantity(line.quantity()), rowHeight);
            }
            finishPage(page, fonts);
            pdf.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Не удалось сформировать PDF документа", exception);
        }
    }

    private PageState addPage(PDDocument pdf, Fonts fonts, WarehouseDto.Document source, int number)
            throws IOException {
        PDPage page = new PDPage(PAGE);
        pdf.addPage(page);
        PDPageContentStream content = new PDPageContentStream(pdf, page);
        float y = PAGE.getHeight() - MARGIN;
        String title = source.type() == StockDocumentType.PURCHASE_ORDER ? "Заказ" : "Приход";
        text(content, fonts.bold, 15, MARGIN, y, title);
        y -= 30;
        drawHeader(content, fonts, y);
        return new PageState(content, y - 25, number);
    }

    private void drawHeader(PDPageContentStream content, Fonts fonts, float top)
            throws IOException {
        String[] labels = {"Артикул", "Номенклатура", "Кол-во"};
        float x = MARGIN;
        for (int index = 0; index < WIDTHS.length; index++) {
            content.setNonStrokingColor(new Color(235, 239, 243));
            content.addRect(x, top - 25, WIDTHS[index], 25);
            content.fill();
            content.setStrokingColor(Color.GRAY);
            content.addRect(x, top - 25, WIDTHS[index], 25);
            content.stroke();
            text(content, fonts.bold, index == 2 ? 7.5f : 9, x + PADDING, top - 16, labels[index]);
            x += WIDTHS[index];
        }
    }

    private void drawRow(
            PageState page,
            Fonts fonts,
            List<String> sku,
            List<String> name,
            String quantity,
            float height)
            throws IOException {
        float bottom = page.y - height;
        float x = MARGIN;
        for (float width : WIDTHS) {
            page.content.setStrokingColor(Color.GRAY);
            page.content.addRect(x, bottom, width, height);
            page.content.stroke();
            x += width;
        }
        drawLines(page.content, fonts.regular, sku, MARGIN + PADDING, page.y - PADDING - FONT_SIZE);
        drawLines(
                page.content,
                fonts.regular,
                name,
                MARGIN + WIDTHS[0] + PADDING,
                page.y - PADDING - FONT_SIZE);
        float quantityWidth = width(fonts.regular, quantity);
        text(
                page.content,
                fonts.regular,
                FONT_SIZE,
                MARGIN + WIDTHS[0] + WIDTHS[1] + WIDTHS[2] - PADDING - quantityWidth,
                page.y - PADDING - FONT_SIZE,
                quantity);
        page.y = bottom;
    }

    private void drawLines(
            PDPageContentStream content, PDFont font, List<String> lines, float x, float y)
            throws IOException {
        for (String line : lines) {
            text(content, font, FONT_SIZE, x, y, line);
            y -= LINE_HEIGHT;
        }
    }

    private void finishPage(PageState page, Fonts fonts) throws IOException {
        String label = "Страница " + page.number;
        text(
                page.content,
                fonts.regular,
                8,
                PAGE.getWidth() - MARGIN - width(fonts.regular, label, 8),
                MARGIN - 15,
                label);
        page.content.close();
    }

    private List<String> wrap(String value, PDFont font, float maxWidth) throws IOException {
        List<String> result = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String word : value.replaceAll("\\s+", " ").split(" ")) {
            if (!current.isEmpty() && width(font, current + " " + word) > maxWidth) {
                result.add(current.toString());
                current.setLength(0);
            }
            for (int index = 0; index < word.length(); index++) {
                String candidate =
                        current
                                + (current.isEmpty() ? "" : index == 0 ? " " : "")
                                + word.charAt(index);
                if (!current.isEmpty() && width(font, candidate) > maxWidth) {
                    result.add(current.toString());
                    current.setLength(0);
                }
                if (index == 0 && !current.isEmpty()) current.append(' ');
                current.append(word.charAt(index));
            }
        }
        if (!current.isEmpty()) result.add(current.toString());
        return result;
    }

    private Fonts loadFonts(PDDocument pdf) throws IOException {
        for (String[] names : FONT_FILES) {
            File regular = new File(names[0]);
            File bold = new File(names[1]);
            if (regular.isFile() && bold.isFile()) {
                return new Fonts(PDType0Font.load(pdf, regular), PDType0Font.load(pdf, bold));
            }
        }
        throw new IOException("Для PDF требуется шрифт с поддержкой кириллицы");
    }

    private String quantity(BigDecimal value) {
        return new DecimalFormat(
                        "#,##0.###",
                        DecimalFormatSymbols.getInstance(Locale.forLanguageTag("ru-RU")))
                .format(value == null ? BigDecimal.ZERO : value);
    }

    private String value(String text) {
        return text == null || text.isBlank() ? "—" : text.trim();
    }

    private void text(
            PDPageContentStream content, PDFont font, float size, float x, float y, String text)
            throws IOException {
        content.beginText();
        content.setNonStrokingColor(Color.BLACK);
        content.setFont(font, size);
        content.newLineAtOffset(x, y);
        content.showText(text);
        content.endText();
    }

    private float width(PDFont font, String text) throws IOException {
        return width(font, text, FONT_SIZE);
    }

    private float width(PDFont font, String text, float size) throws IOException {
        return font.getStringWidth(text) / 1000 * size;
    }

    private record Fonts(PDFont regular, PDFont bold) {}

    private static class PageState {
        final PDPageContentStream content;
        final int number;
        float y;

        PageState(PDPageContentStream content, float y, int number) {
            this.content = content;
            this.y = y;
            this.number = number;
        }
    }
}
