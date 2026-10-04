package kz.company.shop.warehouse.service;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.warehouse.entity.PriceSettingGroup;
import kz.company.shop.warehouse.entity.StockDocument;
import kz.company.shop.warehouse.entity.StockDocumentLine;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.entity.StockDocumentStatus;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.repository.PriceSettingGroupRepository;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.StockDocumentRepository;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Printable comparison of draft and posted price-setting documents in one group. */
@Service
public class PriceSettingGroupPdfService {
    private static final Locale RUSSIAN = Locale.forLanguageTag("ru-RU");
    private static final ZoneId ALMATY_ZONE = ZoneId.of("Asia/Almaty");
    private static final DateTimeFormatter DATE_FORMAT =
            DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm", RUSSIAN);
    private static final PDRectangle PAGE =
            new PDRectangle(PDRectangle.A3.getHeight(), PDRectangle.A3.getWidth());
    private static final float MARGIN = 28;
    private static final Color NEW_PRICE_COLOR = new Color(222, 244, 232);
    private static final Color OLD_PRICE_COLOR = new Color(255, 232, 218);
    private static final List<FontFiles> FONT_FILES =
            List.of(
                    new FontFiles(
                            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
                    new FontFiles(
                            "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
                            "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"));

    private final PriceSettingGroupRepository groups;
    private final StockDocumentRepository documents;
    private final StockDocumentLineRepository lines;
    private final ProductRepository products;

    public PriceSettingGroupPdfService(
            PriceSettingGroupRepository groups,
            StockDocumentRepository documents,
            StockDocumentLineRepository lines,
            ProductRepository products) {
        this.groups = groups;
        this.documents = documents;
        this.lines = lines;
        this.products = products;
    }

    /** Posted documents retain their previous price; drafts compare against the current card price. */
    @Transactional(readOnly = true)
    public byte[] generate(UUID groupId) {
        PriceSettingGroup group =
                groups.findById(groupId)
                        .filter(value -> value.deletedAt == null)
                        .orElseThrow(() -> new AppExceptions.NotFound("Группа установки цен не найдена"));
        List<StockDocument> candidates =
                documents.findByPriceSettingGroupIdAndDeletedAtIsNullOrderByCreatedAtDesc(groupId).stream()
                        .filter(document -> document.documentType == StockDocumentType.PRICE_SETTING)
                        .filter(document -> document.status == StockDocumentStatus.DRAFT
                                || document.status == StockDocumentStatus.POSTED)
                        .filter(document -> document.priceType != null)
                        .toList();
        if (candidates.isEmpty()) {
            throw new AppExceptions.BadRequest(
                    "В группе нет черновиков или проведённых документов установки цен для выгрузки");
        }

        // The latest draft is the current proposal for a price type. Otherwise use the latest
        // posted document to preserve the historical comparison.
        Map<StockDocumentPriceType, StockDocument> documentByType = new EnumMap<>(StockDocumentPriceType.class);
        candidates.stream()
                .sorted(Comparator
                        .comparingInt((StockDocument document) ->
                                document.status == StockDocumentStatus.DRAFT ? 1 : 0)
                        .thenComparing(this::documentMoment)
                        .reversed())
                .forEach(document -> documentByType.putIfAbsent(document.priceType, document));
        List<StockDocumentPriceType> priceTypes =
                List.of(StockDocumentPriceType.values()).stream()
                        .filter(documentByType::containsKey)
                        .toList();
        Map<Long, Row> rows = new LinkedHashMap<>();
        for (StockDocumentPriceType priceType : priceTypes) {
            for (StockDocumentLine line : lines.findByDocumentIdOrderById(documentByType.get(priceType).id)) {
                Product product = products.findByIdAndDeletedAtIsNull(line.productId).orElse(null);
                if (product == null) continue;
                Row row = rows.computeIfAbsent(line.productId, ignored -> new Row(product.sku, product.nameRu));
                row.newPrices.put(priceType, line.unitPrice);
                row.oldPrices.put(priceType,
                        documentByType.get(priceType).status == StockDocumentStatus.DRAFT
                                ? productPrice(product, priceType)
                                : line.previousUnitPrice);
            }
        }
        if (rows.isEmpty()) {
            throw new AppExceptions.BadRequest("В документах группы нет доступных товаров");
        }
        List<Row> sortedRows =
                rows.values().stream()
                        .sorted(Comparator.comparing(Row::sku, Comparator.nullsLast(String::compareToIgnoreCase)))
                        .toList();
        try {
            return render(group.name, priceTypes, sortedRows,
                    "Новые цены — зелёные столбцы; старые цены для черновиков — текущие, для проведённых — на момент проведения.");
        } catch (IOException exception) {
            throw new IllegalStateException("Не удалось сформировать PDF таблицу цен", exception);
        }
    }

    public record PreviewRow(String sku, String name,
            Map<StockDocumentPriceType, BigDecimal> newPrices,
            Map<StockDocumentPriceType, BigDecimal> oldPrices) {}

    /** Render the same price comparison before AI drafts become warehouse documents. */
    public byte[] generatePreview(String groupName, List<PreviewRow> previewRows) {
        if (previewRows == null || previewRows.isEmpty())
            throw new AppExceptions.BadRequest("В черновике нет цен для просмотра");
        List<Row> rows = previewRows.stream().map(preview -> {
            Row row = new Row(preview.sku(), preview.name());
            row.newPrices.putAll(preview.newPrices());
            row.oldPrices.putAll(preview.oldPrices());
            return row;
        }).sorted(Comparator.comparing(Row::sku, Comparator.nullsLast(String::compareToIgnoreCase))).toList();
        try {
            return render(groupName, List.of(StockDocumentPriceType.values()), rows,
                    "Черновик агента: документы ещё не созданы. Новые цены — зелёные столбцы; старые — на момент расчёта.");
        } catch (IOException exception) {
            throw new IllegalStateException("Не удалось сформировать PDF таблицу цен", exception);
        }
    }

    private byte[] render(
            String groupName,
            List<StockDocumentPriceType> priceTypes,
            List<Row> rows,
            String explanation)
            throws IOException {
        try (PDDocument document = new PDDocument(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            Fonts fonts = loadFonts(document);
            PageState page = addPage(document, fonts, groupName, priceTypes, explanation, 1);
            for (Row row : rows) {
                float rowHeight = rowHeight(fonts.regular, row, priceTypes, page.layout);
                if (page.y - rowHeight < MARGIN) {
                    page.close();
                    page = addPage(document, fonts, groupName, priceTypes, explanation, page.number + 1);
                }
                drawRow(page, fonts, priceTypes, row, rowHeight);
            }
            page.close();
            document.save(output);
            return output.toByteArray();
        }
    }

    private PageState addPage(
            PDDocument document,
            Fonts fonts,
            String groupName,
            List<StockDocumentPriceType> priceTypes,
            String explanation,
            int number)
            throws IOException {
        PDPage page = new PDPage(PAGE);
        document.addPage(page);
        PDPageContentStream content = new PDPageContentStream(document, page);
        float y = PAGE.getHeight() - MARGIN;
        text(content, fonts.bold, 14, MARGIN, y, "Установка цен: " + groupName, Color.BLACK);
        y -= 17;
        text(
                content,
                fonts.regular,
                7.5f,
                MARGIN,
                y,
                explanation,
                Color.DARK_GRAY);
        y -= 14;
        TableLayout layout = TableLayout.forTypes(priceTypes.size());
        float x = MARGIN;
        drawHeaderCell(content, fonts, x, y, layout.skuWidth, "Артикул", Color.WHITE);
        x += layout.skuWidth;
        drawHeaderCell(content, fonts, x, y, layout.nameWidth, "Товар", Color.WHITE);
        x += layout.nameWidth;
        for (StockDocumentPriceType type : priceTypes) {
            String label = "Новая\n" + priceTypeName(type);
            drawHeaderCell(content, fonts, x, y, layout.priceWidth, label, NEW_PRICE_COLOR);
            x += layout.priceWidth;
        }
        for (StockDocumentPriceType type : priceTypes) {
            String label = "Старая\n" + priceTypeName(type);
            drawHeaderCell(content, fonts, x, y, layout.priceWidth, label, OLD_PRICE_COLOR);
            x += layout.priceWidth;
        }
        y -= 25;
        return new PageState(content, y, layout, number);
    }

    private void drawRow(
            PageState page, Fonts fonts, List<StockDocumentPriceType> types, Row row, float height)
            throws IOException {
        float x = MARGIN;
        drawCell(page.content, fonts.regular, x, page.y, page.layout.skuWidth, height, safe(row.sku), Color.WHITE, 6.5f);
        x += page.layout.skuWidth;
        drawWrappedCell(
                page.content,
                fonts.regular,
                x,
                page.y,
                page.layout.nameWidth,
                height,
                safe(row.name),
                Color.WHITE,
                6.5f);
        x += page.layout.nameWidth;
        for (StockDocumentPriceType type : types) {
            drawWrappedCell(
                    page.content,
                    fonts.regular,
                    x,
                    page.y,
                    page.layout.priceWidth,
                    height,
                    newPriceWithChange(row.newPrices.get(type), row.oldPrices.get(type)),
                    NEW_PRICE_COLOR,
                    6.5f);
            x += page.layout.priceWidth;
        }
        for (StockDocumentPriceType type : types) {
            drawWrappedCell(
                    page.content,
                    fonts.regular,
                    x,
                    page.y,
                    page.layout.priceWidth,
                    height,
                    money(row.oldPrices.get(type)),
                    OLD_PRICE_COLOR,
                    6.5f);
            x += page.layout.priceWidth;
        }
        page.y -= height;
    }

    private float rowHeight(
            PDFont font, Row row, List<StockDocumentPriceType> types, TableLayout layout)
            throws IOException {
        int lines = wrapText(font, safe(row.name), layout.nameWidth - 4, 6.5f).size();
        for (StockDocumentPriceType type : types) {
            lines = Math.max(
                    lines,
                    wrapText(
                                    font,
                                    newPriceWithChange(row.newPrices.get(type), row.oldPrices.get(type)),
                                    layout.priceWidth - 4,
                                    6.5f)
                            .size());
            lines = Math.max(
                    lines,
                    wrapText(font, money(row.oldPrices.get(type)), layout.priceWidth - 4, 6.5f)
                            .size());
        }
        return Math.max(17, 8 + lines * 8);
    }

    private void drawHeaderCell(
            PDPageContentStream content, Fonts fonts, float x, float y, float width, String value, Color fill)
            throws IOException {
        float height = 25;
        content.setNonStrokingColor(fill);
        content.addRect(x, y - height, width, height);
        content.fill();
        content.setStrokingColor(new Color(175, 175, 175));
        content.addRect(x, y - height, width, height);
        content.stroke();
        String[] pieces = value.split("\\n");
        for (int i = 0; i < pieces.length; i++) {
            text(content, fonts.bold, 5.8f, x + 2, y - 9 - i * 7, ellipsize(fonts.bold, pieces[i], width - 4, 5.8f), Color.BLACK);
        }
    }

    private void drawCell(
            PDPageContentStream content, PDFont font, float x, float y, float width, float height,
            String value, Color fill, float fontSize)
            throws IOException {
        content.setNonStrokingColor(fill);
        content.addRect(x, y - height, width, height);
        content.fill();
        content.setStrokingColor(new Color(205, 205, 205));
        content.addRect(x, y - height, width, height);
        content.stroke();
        text(content, font, fontSize, x + 2, y - 11, ellipsize(font, value, width - 4, fontSize), Color.BLACK);
    }

    private void drawWrappedCell(
            PDPageContentStream content,
            PDFont font,
            float x,
            float y,
            float width,
            float height,
            String value,
            Color fill,
            float fontSize)
            throws IOException {
        content.setNonStrokingColor(fill);
        content.addRect(x, y - height, width, height);
        content.fill();
        content.setStrokingColor(new Color(205, 205, 205));
        content.addRect(x, y - height, width, height);
        content.stroke();

        List<String> lines = wrapText(font, value, width - 4, fontSize);
        float textHeight = lines.size() * 8;
        float baseline = y - Math.max(7, (height - textHeight) / 2 + 6.5f);
        for (String line : lines) {
            text(content, font, fontSize, x + 2, baseline, line, Color.BLACK);
            baseline -= 8;
        }
    }

    private Fonts loadFonts(PDDocument document) throws IOException {
        for (FontFiles candidate : FONT_FILES) {
            if (new File(candidate.regular).isFile() && new File(candidate.bold).isFile()) {
                return new Fonts(
                        PDType0Font.load(document, new File(candidate.regular)),
                        PDType0Font.load(document, new File(candidate.bold)));
            }
        }
        throw new IOException("Не найден шрифт с поддержкой кириллицы для PDF");
    }

    private static void text(PDPageContentStream content, PDFont font, float size, float x, float y, String value, Color color) throws IOException {
        content.beginText();
        content.setFont(font, size);
        content.setNonStrokingColor(color);
        content.newLineAtOffset(x, y);
        content.showText(value);
        content.endText();
    }

    private String ellipsize(PDFont font, String value, float maxWidth, float size) throws IOException {
        if (width(font, value, size) <= maxWidth) return value;
        String suffix = "…";
        int end = value.length();
        while (end > 0 && width(font, value.substring(0, end) + suffix, size) > maxWidth) end--;
        return end == 0 ? suffix : value.substring(0, end) + suffix;
    }

    private List<String> wrapText(PDFont font, String value, float maxWidth, float size)
            throws IOException {
        List<String> result = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (String word : value.trim().split("\\s+")) {
            if (line.isEmpty()) {
                appendWordParts(result, line, word, font, maxWidth, size);
                continue;
            }
            String candidate = line + " " + word;
            if (width(font, candidate, size) <= maxWidth) {
                line.append(' ').append(word);
            } else {
                result.add(line.toString());
                line.setLength(0);
                appendWordParts(result, line, word, font, maxWidth, size);
            }
        }
        if (!line.isEmpty()) result.add(line.toString());
        return result.isEmpty() ? List.of("—") : result;
    }

    private void appendWordParts(
            List<String> result, StringBuilder line, String word, PDFont font, float maxWidth, float size)
            throws IOException {
        for (int index = 0; index < word.length(); index++) {
            String candidate = line + String.valueOf(word.charAt(index));
            if (!line.isEmpty() && width(font, candidate, size) > maxWidth) {
                result.add(line.toString());
                line.setLength(0);
            }
            line.append(word.charAt(index));
        }
    }

    private static float width(PDFont font, String value, float size) throws IOException {
        return font.getStringWidth(value) / 1000 * size;
    }

    private static String money(BigDecimal value) {
        if (value == null) return "—";
        return new DecimalFormat("#,##0.##", DecimalFormatSymbols.getInstance(RUSSIAN)).format(value);
    }

    private static String newPriceWithChange(BigDecimal newPrice, BigDecimal oldPrice) {
        if (newPrice == null) return "—";
        if (oldPrice == null || oldPrice.signum() == 0) return money(newPrice);
        BigDecimal change =
                newPrice.subtract(oldPrice)
                        .multiply(BigDecimal.valueOf(100))
                        .divide(oldPrice, 2, RoundingMode.HALF_UP);
        String sign = change.signum() >= 0 ? "+" : "";
        return money(newPrice) + " (" + sign + money(change) + "%)";
    }

    private static String safe(String value) { return value == null ? "—" : value; }

    private static String priceTypeName(StockDocumentPriceType type) {
        return switch (type) {
            case RETAIL -> "розничная";
            case WHOLESALE -> "оптовая";
            case BULK_WHOLESALE -> "крупно-оптовая";
            case SKO -> "СКО";
            case GSKO -> "ГСКО";
            case INCOMING -> "приходная";
        };
    }

    private static BigDecimal productPrice(Product product, StockDocumentPriceType type) {
        return switch (type) {
            case RETAIL -> product.price;
            case WHOLESALE -> product.wholesalePrice;
            case BULK_WHOLESALE -> product.bulkWholesalePrice;
            case SKO -> product.skoPrice;
            case GSKO -> product.gskoPrice;
            case INCOMING -> product.incomingPrice;
        };
    }

    private Instant documentMoment(StockDocument document) {
        if (document.status == StockDocumentStatus.DRAFT) {
            return document.updatedAt == null ? document.createdAt : document.updatedAt;
        }
        return document.postedAt == null ? document.createdAt : document.postedAt;
    }

    private record FontFiles(String regular, String bold) {}
    private record Fonts(PDFont regular, PDFont bold) {}
    private record TableLayout(float skuWidth, float nameWidth, float priceWidth) {
        static TableLayout forTypes(int count) {
            float available = PAGE.getWidth() - 2 * MARGIN;
            float sku = 74;
            float name = 180;
            return new TableLayout(sku, name, (available - sku - name) / (count * 2));
        }
    }
    private static final class PageState {
        private final PDPageContentStream content;
        private final TableLayout layout;
        private final int number;
        private float y;
        private PageState(PDPageContentStream content, float y, TableLayout layout, int number) {
            this.content = content;
            this.y = y;
            this.layout = layout;
            this.number = number;
        }
        private void close() throws IOException { content.close(); }
    }
    private static final class Row {
        private final String sku;
        private final String name;
        private final Map<StockDocumentPriceType, BigDecimal> newPrices = new EnumMap<>(StockDocumentPriceType.class);
        private final Map<StockDocumentPriceType, BigDecimal> oldPrices = new EnumMap<>(StockDocumentPriceType.class);
        private Row(String sku, String name) { this.sku = sku; this.name = name; }
        private String sku() { return sku; }
    }
}
