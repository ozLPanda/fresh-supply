package kz.company.shop.barcodes.service;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.oned.Code128Writer;
import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import kz.company.shop.barcodes.dto.BarcodeItemRequest;
import kz.company.shop.barcodes.dto.BarcodePdfMode;
import kz.company.shop.barcodes.dto.BarcodePdfRequest;
import kz.company.shop.common.exception.AppExceptions;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.springframework.stereotype.Service;

@Service
public class BarcodePdfService {
    static final int MAX_LABELS = 10_000;
    static final float MM = 72f / 25.4f;

    // Compact: 45 x 30 mm, 4 x 9 = 36 labels/A4.
    static final int COLUMNS = 4;
    static final int ROWS = 9;
    static final int LABELS_PER_PAGE = COLUMNS * ROWS;
    static final float LABEL_WIDTH = 45 * MM;
    static final float LABEL_HEIGHT = 30 * MM;
    static final float HORIZONTAL_GAP = 0;
    static final float VERTICAL_GAP = 0;
    static final float PAGE_MARGIN_X = horizontalMargin(COLUMNS, LABEL_WIDTH, HORIZONTAL_GAP);
    static final float PAGE_MARGIN_Y = verticalMargin(ROWS, LABEL_HEIGHT, VERTICAL_GAP);

    // With name: 60 x 45 mm, 3 x 6 = 18 labels/A4.
    static final int WITH_NAME_COLUMNS = 3;
    static final int WITH_NAME_ROWS = 6;
    static final int WITH_NAME_LABELS_PER_PAGE = WITH_NAME_COLUMNS * WITH_NAME_ROWS;
    static final float WITH_NAME_LABEL_WIDTH = 60 * MM;
    static final float WITH_NAME_LABEL_HEIGHT = 45 * MM;
    static final float WITH_NAME_HORIZONTAL_GAP = 0;
    static final float WITH_NAME_VERTICAL_GAP = 0;
    static final float WITH_NAME_PAGE_MARGIN_X =
            horizontalMargin(WITH_NAME_COLUMNS, WITH_NAME_LABEL_WIDTH, WITH_NAME_HORIZONTAL_GAP);
    static final float WITH_NAME_PAGE_MARGIN_Y =
            verticalMargin(WITH_NAME_ROWS, WITH_NAME_LABEL_HEIGHT, WITH_NAME_VERTICAL_GAP);

    private static final float COMPACT_PADDING = 2 * MM;
    private static final float WITH_NAME_PADDING = 3 * MM;
    private static final float MIN_MODULE_WIDTH = 0.25f * MM;
    private static final float COMPACT_BARCODE_HEIGHT = 20 * MM;
    private static final float WITH_NAME_BARCODE_HEIGHT = 23 * MM;
    private static final float COMPACT_VALUE_BASELINE = 3.5f * MM;
    private static final float WITH_NAME_VALUE_BASELINE = 3.5f * MM;
    private static final float NAME_FONT_SIZE = 7.5f;
    private static final float NAME_LINE_HEIGHT = 3.4f * MM;
    private static final String LINUX_FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
    private static final String WINDOWS_FONT = "C:/Windows/Fonts/arial.ttf";
    static final Map<EncodeHintType, Object> BARCODE_HINTS = Map.of(EncodeHintType.MARGIN, 20);

    private final Code128Writer barcodeWriter = new Code128Writer();
    private final PDType1Font compactFont =
            new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);

    public byte[] generate(BarcodePdfRequest request) {
        BarcodePdfMode mode = request == null ? BarcodePdfMode.COMPACT : request.effectiveMode();
        Layout layout = Layout.forMode(mode);
        List<Label> labels = normalize(request, layout);
        labels = excludeIncompleteSheetIfRequested(request, labels, layout.labelsPerPage());

        try (PDDocument document = new PDDocument();
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            PDFont nameFont = mode == BarcodePdfMode.WITH_NAME ? loadUnicodeFont(document) : null;
            for (int offset = 0; offset < labels.size(); offset += layout.labelsPerPage()) {
                int end = Math.min(offset + layout.labelsPerPage(), labels.size());
                addPage(document, labels.subList(offset, end), layout, nameFont);
            }
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not generate barcode PDF", exception);
        }
    }

    private List<Label> excludeIncompleteSheetIfRequested(
            BarcodePdfRequest request, List<Label> labels, int labelsPerPage) {
        if (request == null || !request.shouldExcludeIncompleteSheet()) {
            return labels;
        }

        int remainder = labels.size() % labelsPerPage;
        if (remainder == 0) {
            return labels;
        }

        int retainedLabelCount = labels.size() - remainder;
        if (retainedLabelCount == 0) {
            throw new AppExceptions.BadRequest(
                    "Cannot exclude an incomplete sheet: there are not enough labels for one full sheet");
        }
        return new ArrayList<>(labels.subList(0, retainedLabelCount));
    }

    private List<Label> normalize(BarcodePdfRequest request, Layout layout) {
        if (request == null || request.items() == null || request.items().isEmpty()) {
            throw new AppExceptions.BadRequest("Add at least one barcode");
        }
        List<Label> labels = new ArrayList<>();
        for (BarcodeItemRequest item : request.items()) {
            if (item == null) {
                throw new AppExceptions.BadRequest("Barcode row must not be empty");
            }
            String value = item.value() == null ? "" : item.value().trim();
            validateValue(value);
            int quantity = item.quantity() == null ? 1 : item.quantity();
            if (quantity < 1 || quantity > 100) {
                throw new AppExceptions.BadRequest("Quantity must be between 1 and 100");
            }
            if (labels.size() + quantity > MAX_LABELS) {
                throw new AppExceptions.BadRequest(
                        "A request may generate at most " + MAX_LABELS + " labels");
            }
            BitMatrix barcode = encode(value, layout.barcodeWidth());
            String name =
                    layout.mode() == BarcodePdfMode.WITH_NAME ? normalizeName(item.name()) : "";
            for (int i = 0; i < quantity; i++) {
                labels.add(new Label(value, name, barcode));
            }
        }
        return labels;
    }

    private String normalizeName(String name) {
        return name == null ? "" : name.trim().replaceAll("\\s+", " ");
    }

    private void validateValue(String value) {
        if (value.isEmpty()) {
            throw new AppExceptions.BadRequest("Barcode value is required");
        }
        if (value.length() > 48) {
            throw new AppExceptions.BadRequest("Barcode value must not exceed 48 characters");
        }
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (character < 0x20 || character > 0x7e) {
                throw new AppExceptions.BadRequest(
                        "Barcode value may contain only printable ASCII characters");
            }
        }
    }

    private BitMatrix encode(String value, float availableWidth) {
        try {
            BitMatrix barcode =
                    barcodeWriter.encode(value, BarcodeFormat.CODE_128, 1, 1, BARCODE_HINTS);
            if (barcode.getWidth() * MIN_MODULE_WIDTH > availableWidth) {
                throw new AppExceptions.BadRequest(
                        "Barcode value is too long to print at a reliably scannable size: "
                                + value);
            }
            return barcode;
        } catch (IllegalArgumentException exception) {
            throw new AppExceptions.BadRequest("Barcode value cannot be encoded: " + value);
        }
    }

    private void addPage(PDDocument document, List<Label> labels, Layout layout, PDFont nameFont)
            throws IOException {
        PDPage page = new PDPage(PDRectangle.A4);
        document.addPage(page);
        try (PDPageContentStream content = new PDPageContentStream(document, page)) {
            for (int index = 0; index < labels.size(); index++) {
                int column = index % layout.columns();
                int row = index / layout.columns();
                float x = layout.marginX() + column * (layout.width() + layout.horizontalGap());
                float top =
                        PDRectangle.A4.getHeight()
                                - layout.marginY()
                                - row * (layout.height() + layout.verticalGap());
                drawLabel(content, labels.get(index), x, top - layout.height(), layout, nameFont);
            }
        }
    }

    private void drawLabel(
            PDPageContentStream content,
            Label label,
            float x,
            float y,
            Layout layout,
            PDFont nameFont)
            throws IOException {
        content.setStrokingColor(new Color(190, 190, 190));
        content.setLineWidth(0.35f);
        content.addRect(x, y, layout.width(), layout.height());
        content.stroke();

        float barcodeY;
        float barcodeHeight;
        if (layout.mode() == BarcodePdfMode.WITH_NAME) {
            barcodeY = y + 8 * MM;
            barcodeHeight = WITH_NAME_BARCODE_HEIGHT;
            drawName(content, label.name(), nameFont, x, y, layout);
        } else {
            barcodeY = y + COMPACT_VALUE_BASELINE + 3 * MM;
            barcodeHeight = COMPACT_BARCODE_HEIGHT;
        }
        drawBarcode(
                content,
                label.barcode(),
                x + layout.padding(),
                barcodeY,
                layout.barcodeWidth(),
                barcodeHeight);

        float baseline =
                y
                        + (layout.mode() == BarcodePdfMode.WITH_NAME
                                ? WITH_NAME_VALUE_BASELINE
                                : COMPACT_VALUE_BASELINE);
        drawCenteredText(content, label.value(), compactFont, 9f, x, baseline, layout);
    }

    private void drawName(
            PDPageContentStream content, String name, PDFont font, float x, float y, Layout layout)
            throws IOException {
        if (name.isBlank()) {
            return;
        }
        List<String> lines = fitName(name, font, layout.barcodeWidth(), NAME_FONT_SIZE);
        float baseline = y + layout.height() - layout.padding() - NAME_FONT_SIZE;
        for (String line : lines) {
            drawCenteredText(content, line, font, NAME_FONT_SIZE, x, baseline, layout);
            baseline -= NAME_LINE_HEIGHT;
        }
    }

    private List<String> fitName(String name, PDFont font, float maxWidth, float fontSize)
            throws IOException {
        List<String> lines = new ArrayList<>(2);
        String remaining = name;
        for (int line = 0; line < 2 && !remaining.isBlank(); line++) {
            boolean lastLine = line == 1;
            String fitted = fitPrefix(remaining, font, maxWidth, fontSize, lastLine);
            lines.add(fitted);
            if (lastLine || fitted.length() >= remaining.length()) {
                break;
            }
            remaining = remaining.substring(fitted.length()).stripLeading();
        }
        return lines;
    }

    private String fitPrefix(
            String text, PDFont font, float maxWidth, float fontSize, boolean ellipsize)
            throws IOException {
        String suffix = ellipsize ? "..." : "";
        if (textWidth(text, font, fontSize) <= maxWidth) {
            return text;
        }
        int end = text.length();
        while (end > 1
                && textWidth(text.substring(0, end).stripTrailing() + suffix, font, fontSize)
                        > maxWidth) {
            end--;
        }
        if (!ellipsize) {
            int wordEnd = text.lastIndexOf(' ', end - 1);
            if (wordEnd > 0) {
                end = wordEnd;
            }
        }
        return text.substring(0, end).stripTrailing() + suffix;
    }

    private void drawCenteredText(
            PDPageContentStream content,
            String text,
            PDFont font,
            float fontSize,
            float x,
            float baseline,
            Layout layout)
            throws IOException {
        float width = textWidth(text, font, fontSize);
        content.beginText();
        content.setNonStrokingColor(Color.BLACK);
        content.setFont(font, fontSize);
        content.newLineAtOffset(
                x + Math.max(layout.padding(), (layout.width() - width) / 2), baseline);
        content.showText(text);
        content.endText();
    }

    private float textWidth(String text, PDFont font, float fontSize) throws IOException {
        return font.getStringWidth(text) / 1000 * fontSize;
    }

    private void drawBarcode(
            PDPageContentStream content,
            BitMatrix barcode,
            float x,
            float y,
            float width,
            float height)
            throws IOException {
        float moduleWidth = width / barcode.getWidth();
        content.setNonStrokingColor(Color.BLACK);
        for (int module = 0; module < barcode.getWidth(); ) {
            if (!barcode.get(module, 0)) {
                module++;
                continue;
            }
            int start = module;
            while (module < barcode.getWidth() && barcode.get(module, 0)) {
                module++;
            }
            content.addRect(x + start * moduleWidth, y, (module - start) * moduleWidth, height);
        }
        content.fill();
    }

    private PDFont loadUnicodeFont(PDDocument document) throws IOException {
        for (String path : List.of(LINUX_FONT, WINDOWS_FONT)) {
            File file = new File(path);
            if (file.isFile()) {
                return PDType0Font.load(document, file);
            }
        }
        throw new IOException("A Unicode font is required for barcode labels with product names");
    }

    private static float horizontalMargin(int columns, float width, float gap) {
        return (PDRectangle.A4.getWidth() - columns * width - (columns - 1) * gap) / 2;
    }

    private static float verticalMargin(int rows, float height, float gap) {
        return (PDRectangle.A4.getHeight() - rows * height - (rows - 1) * gap) / 2;
    }

    private record Label(String value, String name, BitMatrix barcode) {}

    private record Layout(
            BarcodePdfMode mode,
            int columns,
            int rows,
            int labelsPerPage,
            float width,
            float height,
            float horizontalGap,
            float verticalGap,
            float marginX,
            float marginY,
            float padding) {
        static Layout forMode(BarcodePdfMode mode) {
            if (mode == BarcodePdfMode.WITH_NAME) {
                return new Layout(
                        mode,
                        WITH_NAME_COLUMNS,
                        WITH_NAME_ROWS,
                        WITH_NAME_LABELS_PER_PAGE,
                        WITH_NAME_LABEL_WIDTH,
                        WITH_NAME_LABEL_HEIGHT,
                        WITH_NAME_HORIZONTAL_GAP,
                        WITH_NAME_VERTICAL_GAP,
                        WITH_NAME_PAGE_MARGIN_X,
                        WITH_NAME_PAGE_MARGIN_Y,
                        WITH_NAME_PADDING);
            }
            return new Layout(
                    BarcodePdfMode.COMPACT,
                    COLUMNS,
                    ROWS,
                    LABELS_PER_PAGE,
                    LABEL_WIDTH,
                    LABEL_HEIGHT,
                    HORIZONTAL_GAP,
                    VERTICAL_GAP,
                    PAGE_MARGIN_X,
                    PAGE_MARGIN_Y,
                    COMPACT_PADDING);
        }

        float barcodeWidth() {
            return width - 2 * padding;
        }
    }
}
