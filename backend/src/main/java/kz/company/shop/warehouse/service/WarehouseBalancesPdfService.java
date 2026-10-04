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
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import kz.company.shop.warehouse.dto.WarehouseDto;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Service;

/** Printable stock balances, including a blank column for manual inventory counts. */
@Service
public class WarehouseBalancesPdfService {
    private static final Locale RUSSIAN = Locale.forLanguageTag("ru-RU");
    private static final PDRectangle PAGE =
            new PDRectangle(PDRectangle.A4.getHeight(), PDRectangle.A4.getWidth());
    private static final float MARGIN = 36;
    private static final float FONT_SIZE = 8.5f;
    private static final float LINE_HEIGHT = 11;
    private static final float PADDING = 5;
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

    private final WarehouseService warehouseService;

    public WarehouseBalancesPdfService(WarehouseService warehouseService) {
        this.warehouseService = warehouseService;
    }

    public byte[] generate(Mode mode, StockFilter stockFilter, String search) {
        List<WarehouseDto.Balance> balances =
                warehouseService.balances(false).stream()
                        .filter(balance -> stockFilter.matches(balance.onHand()))
                        .filter(
                                balance ->
                                        matchesSearch(
                                                balance.sku() + " " + balance.productName(), search))
                        .toList();
        try {
            return render(mode, balances);
        } catch (IOException exception) {
            throw new IllegalStateException("Не удалось сформировать PDF остатков склада", exception);
        }
    }

    private byte[] render(Mode mode, List<WarehouseDto.Balance> balances) throws IOException {
        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Fonts fonts = loadFonts(document);
            PageState page = addPage(document, fonts, mode, 1);
            for (WarehouseDto.Balance balance : balances) {
                List<String> nameLines =
                        wrap(
                                value(balance.productName()),
                                fonts.regular(),
                                FONT_SIZE,
                                layout(mode)[1] - PADDING * 2);
                float rowHeight = Math.max(25, nameLines.size() * LINE_HEIGHT + PADDING * 2);
                if (page.y - rowHeight < MARGIN + 18) {
                    finishPage(page, fonts);
                    page = addPage(document, fonts, mode, page.number + 1);
                }
                drawRow(page, fonts, mode, balance, nameLines, rowHeight);
            }
            finishPage(page, fonts);
            document.save(output);
            return output.toByteArray();
        }
    }

    /** Mirrors the admin table's token-based SKU/name matching for a faithful export. */
    private boolean matchesSearch(String searchableValue, String search) {
        if (search == null || search.isBlank()) return true;
        String normalizedValue = ProductSearchTextNormalizer.normalize(searchableValue);
        if (normalizedValue == null) return false;
        return java.util.Arrays.stream(search.trim().split("\\s+"))
                .allMatch(
                        token ->
                                ProductSearchTextNormalizer.searchVariants(token).stream()
                                        .anyMatch(normalizedValue::contains));
    }

    private PageState addPage(PDDocument document, Fonts fonts, Mode mode, int number)
            throws IOException {
        PDPage pdfPage = new PDPage(PAGE);
        document.addPage(pdfPage);
        PDPageContentStream content = new PDPageContentStream(document, pdfPage);
        float y = PAGE.getHeight() - MARGIN;
        text(
                content,
                fonts.bold(),
                14,
                MARGIN,
                y,
                mode == Mode.INVENTORY ? "Инвентаризационная ведомость" : "Остатки на складе",
                Color.BLACK);
        y -= 23;
        drawHeader(content, fonts, mode, y);
        return new PageState(content, y - 23, number);
    }

    private void finishPage(PageState page, Fonts fonts) throws IOException {
        String footer = "Страница " + page.number;
        float footerWidth = width(fonts.regular(), footer, 8);
        text(
                page.content,
                fonts.regular(),
                8,
                PAGE.getWidth() - MARGIN - footerWidth,
                MARGIN - 14,
                footer,
                Color.DARK_GRAY);
        page.close();
    }

    private void drawHeader(PDPageContentStream content, Fonts fonts, Mode mode, float top)
            throws IOException {
        String[] headers =
                mode == Mode.INVENTORY
                        ? new String[] {
                            "Артикул", "Товар", "Остаток", "Резерв", "Доступно", "Фактический\nостаток"
                        }
                        : new String[] {"Артикул", "Товар", "Остаток", "Резерв", "Доступно"};
        float x = MARGIN;
        float[] widths = layout(mode);
        for (int index = 0; index < headers.length; index++) {
            content.setNonStrokingColor(new Color(235, 239, 243));
            content.addRect(x, top - 20, widths[index], 20);
            content.fill();
            content.setStrokingColor(Color.BLACK);
            content.addRect(x, top - 20, widths[index], 20);
            content.stroke();
            String[] lines = headers[index].split("\\n");
            float baseline = lines.length == 1 ? top - 13 : top - 9;
            for (String line : lines) {
                text(content, fonts.bold(), 8, x + PADDING, baseline, line, Color.BLACK);
                baseline -= 8;
            }
            x += widths[index];
        }
    }

    private void drawRow(
            PageState page,
            Fonts fonts,
            Mode mode,
            WarehouseDto.Balance balance,
            List<String> nameLines,
            float height)
            throws IOException {
        float[] widths = layout(mode);
        float bottom = page.y - height;
        float x = MARGIN;
        for (float columnWidth : widths) {
            page.content.setStrokingColor(Color.BLACK);
            page.content.addRect(x, bottom, columnWidth, height);
            page.content.stroke();
            x += columnWidth;
        }
        drawLines(page, fonts, 0, List.of(value(balance.sku())), bottom, height, widths, Alignment.LEFT);
        drawLines(page, fonts, 1, nameLines, bottom, height, widths, Alignment.LEFT);
        drawLines(page, fonts, 2, List.of(quantity(balance.onHand())), bottom, height, widths, Alignment.RIGHT);
        drawLines(page, fonts, 3, List.of(quantity(balance.reserved())), bottom, height, widths, Alignment.RIGHT);
        drawLines(page, fonts, 4, List.of(quantity(balance.available())), bottom, height, widths, Alignment.RIGHT);
        page.y = bottom;
    }

    private void drawLines(
            PageState page,
            Fonts fonts,
            int column,
            List<String> lines,
            float bottom,
            float height,
            float[] widths,
            Alignment alignment)
            throws IOException {
        float x = MARGIN;
        for (int index = 0; index < column; index++) x += widths[index];
        float blockHeight = lines.size() * LINE_HEIGHT;
        float baseline = bottom + (height + blockHeight) / 2 - LINE_HEIGHT + 3;
        for (String line : lines) {
            float textWidth = width(fonts.regular(), line, FONT_SIZE);
            float textX =
                    alignment == Alignment.LEFT ? x + PADDING : x + widths[column] - PADDING - textWidth;
            text(page.content, fonts.regular(), FONT_SIZE, textX, baseline, line, Color.BLACK);
            baseline -= LINE_HEIGHT;
        }
    }

    private float[] layout(Mode mode) {
        return mode == Mode.INVENTORY
                ? new float[] {105, 275, 88, 78, 88, 135}
                : new float[] {115, 345, 100, 90, 119};
    }

    private List<String> wrap(String value, PDFont font, float size, float maxWidth) throws IOException {
        List<String> lines = new ArrayList<>();
        StringBuilder current = new StringBuilder();
        for (String word : value.replaceAll("\\s+", " ").split(" ")) {
            String candidate = current.isEmpty() ? word : current + " " + word;
            if (width(font, candidate, size) <= maxWidth) {
                current.setLength(0);
                current.append(candidate);
                continue;
            }
            if (!current.isEmpty()) {
                lines.add(current.toString());
                current.setLength(0);
            }
            while (width(font, word, size) > maxWidth && word.length() > 1) {
                int end = word.length() - 1;
                while (end > 1 && width(font, word.substring(0, end), size) > maxWidth) end--;
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

    private String quantity(BigDecimal value) {
        DecimalFormat formatter =
                new DecimalFormat("#,##0.###", DecimalFormatSymbols.getInstance(RUSSIAN));
        return formatter.format(value == null ? BigDecimal.ZERO : value);
    }

    private String value(String value) {
        return value == null || value.isBlank() ? "—" : value.trim();
    }

    private void text(
            PDPageContentStream content,
            PDFont font,
            float size,
            float x,
            float y,
            String value,
            Color color)
            throws IOException {
        content.beginText();
        content.setNonStrokingColor(color);
        content.setFont(font, size);
        content.newLineAtOffset(x, y);
        content.showText(value);
        content.endText();
    }

    private float width(PDFont font, String value, float size) throws IOException {
        return font.getStringWidth(value) / 1000 * size;
    }

    public enum Mode {
        STANDARD,
        INVENTORY
    }

    public enum StockFilter {
        ALL {
            @Override
            boolean matches(BigDecimal onHand) {
                return true;
            }
        },
        ZERO {
            @Override
            boolean matches(BigDecimal onHand) {
                return quantity(onHand).signum() == 0;
            }
        },
        BELOW_ZERO {
            @Override
            boolean matches(BigDecimal onHand) {
                return quantity(onHand).signum() < 0;
            }
        },
        IN_STOCK {
            @Override
            boolean matches(BigDecimal onHand) {
                return quantity(onHand).signum() > 0;
            }
        },
        BELOW_10 {
            @Override
            boolean matches(BigDecimal onHand) {
                return quantity(onHand).compareTo(BigDecimal.TEN) < 0;
            }
        },
        BELOW_100 {
            @Override
            boolean matches(BigDecimal onHand) {
                return quantity(onHand).compareTo(BigDecimal.valueOf(100)) < 0;
            }
        };

        abstract boolean matches(BigDecimal onHand);

        private static BigDecimal quantity(BigDecimal value) {
            return value == null ? BigDecimal.ZERO : value;
        }
    }

    private record Fonts(PDFont regular, PDFont bold) {}

    private record FontFiles(String regular, String bold) {}

    private enum Alignment {
        LEFT,
        RIGHT
    }

    private static final class PageState {
        private final PDPageContentStream content;
        private final int number;
        private float y;

        private PageState(PDPageContentStream content, float y, int number) {
            this.content = content;
            this.y = y;
            this.number = number;
        }

        private void close() throws IOException {
            content.close();
        }
    }
}
