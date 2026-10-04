package kz.company.shop.barcodes.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.client.j2se.BufferedImageLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.oned.Code128Writer;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import kz.company.shop.barcodes.dto.BarcodeItemRequest;
import kz.company.shop.barcodes.dto.BarcodePdfMode;
import kz.company.shop.barcodes.dto.BarcodePdfRequest;
import kz.company.shop.common.exception.AppExceptions;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

class BarcodePdfServiceTest {
    private final BarcodePdfService service = new BarcodePdfService();

    @Test
    void generateCreatesScannableCode128OnA4Page() throws Exception {
        byte[] pdf = service.generate(request(new BarcodeItemRequest("ABC-123", null)));

        assertThat(pdf).startsWith("%PDF".getBytes());
        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isEqualTo(1);
            assertThat(document.getPage(0).getMediaBox().getWidth())
                    .isCloseTo(595.28f, within(0.1f));
            assertThat(document.getPage(0).getMediaBox().getHeight())
                    .isCloseTo(841.89f, within(0.1f));

            var decoded = decodeFirst(document);

            assertThat(decoded.getText()).isEqualTo("ABC-123");
            assertThat(decoded.getBarcodeFormat()).isEqualTo(BarcodeFormat.CODE_128);
        }
    }

    @Test
    void generatePreservesLeadingZerosInOneCSku() throws Exception {
        byte[] pdf = service.generate(request(new BarcodeItemRequest("001234", 1)));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(decodeFirst(document).getText()).isEqualTo("001234");
        }
    }

    @Test
    void barcodeHasAtLeastTenModuleQuietZoneOnEachSide() throws Exception {
        var barcode =
                new Code128Writer()
                        .encode(
                                "001234",
                                BarcodeFormat.CODE_128,
                                1,
                                1,
                                BarcodePdfService.BARCODE_HINTS);
        int firstBlack = 0;
        while (firstBlack < barcode.getWidth() && !barcode.get(firstBlack, 0)) firstBlack++;
        int lastBlack = barcode.getWidth() - 1;
        while (lastBlack >= 0 && !barcode.get(lastBlack, 0)) lastBlack--;

        assertThat(firstBlack).isGreaterThanOrEqualTo(10);
        assertThat(barcode.getWidth() - 1 - lastBlack).isGreaterThanOrEqualTo(10);
    }

    @Test
    void labelGeometryDoesNotExceedFortyFiveByThirtyFiveMillimeters() {
        assertThat(BarcodePdfService.LABEL_WIDTH / BarcodePdfService.MM)
                .isCloseTo(45f, within(0.01f));
        assertThat(BarcodePdfService.LABEL_HEIGHT / BarcodePdfService.MM)
                .isCloseTo(30f, within(0.01f));
        assertThat(BarcodePdfService.PAGE_MARGIN_X / BarcodePdfService.MM)
                .isCloseTo(15f, within(0.01f));
        assertThat(BarcodePdfService.PAGE_MARGIN_Y / BarcodePdfService.MM)
                .isCloseTo(13.5f, within(0.01f));
        assertThat(BarcodePdfService.HORIZONTAL_GAP).isZero();
        assertThat(BarcodePdfService.VERTICAL_GAP).isZero();
    }

    @Test
    void generateFitsThirtySixLabelsOnOnePageAndStartsNextPageAfterThat() throws Exception {
        byte[] fullPage = service.generate(request(new BarcodeItemRequest("100200300", 36)));
        byte[] overflow = service.generate(request(new BarcodeItemRequest("100200300", 37)));

        try (PDDocument document = Loader.loadPDF(fullPage)) {
            assertThat(document.getNumberOfPages()).isEqualTo(1);
            assertThat(countOccurrences(new PDFTextStripper().getText(document), "100200300"))
                    .isEqualTo(36);
        }

        try (PDDocument document = Loader.loadPDF(overflow)) {
            assertThat(document.getNumberOfPages()).isEqualTo(2);
        }
    }

    @Test
    void excludeIncompleteSheetDefaultsToFalseAndPreservesTrailingLabels() throws Exception {
        byte[] pdf = service.generate(request(new BarcodeItemRequest("TAIL-1", 37)));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isEqualTo(2);
            assertThat(countOccurrences(new PDFTextStripper().getText(document), "TAIL-1"))
                    .isEqualTo(37);
        }
    }

    @Test
    void excludeIncompleteSheetDropsTrailingLabels() throws Exception {
        byte[] pdf =
                service.generate(
                        new BarcodePdfRequest(
                                BarcodePdfMode.COMPACT,
                                List.of(new BarcodeItemRequest("TAIL-2", 37)),
                                true));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isEqualTo(1);
            assertThat(countOccurrences(new PDFTextStripper().getText(document), "TAIL-2"))
                    .isEqualTo(36);
        }
    }

    @Test
    void excludeIncompleteSheetDoesNotChangeFullSheet() throws Exception {
        byte[] pdf =
                service.generate(
                        new BarcodePdfRequest(
                                BarcodePdfMode.COMPACT,
                                List.of(new BarcodeItemRequest("FULL-1", 36)),
                                true));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isEqualTo(1);
            assertThat(countOccurrences(new PDFTextStripper().getText(document), "FULL-1"))
                    .isEqualTo(36);
        }
    }

    @Test
    void excludeIncompleteSheetRejectsRequestSmallerThanOneSheet() {
        assertThatThrownBy(
                        () ->
                                service.generate(
                                        new BarcodePdfRequest(
                                                BarcodePdfMode.COMPACT,
                                                List.of(new BarcodeItemRequest("TOO-FEW", 35)),
                                                true)))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("not enough labels for one full sheet");
    }

    @Test
    void generatedPdfContainsOnlySkuText() throws Exception {
        byte[] pdf =
                service.generate(
                        request(new BarcodeItemRequest("SKU-123", "Ignored product name", 1)));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(new PDFTextStripper().getText(document).trim()).isEqualTo("SKU-123");
            assertThat(document.getPage(0).getResources().getXObjectNames()).isEmpty();
        }
    }

    @Test
    void absentModeDefaultsToCompactAndIgnoresEvenVeryLongName() throws Exception {
        byte[] pdf =
                service.generate(
                        new BarcodePdfRequest(
                                null,
                                List.of(
                                        new BarcodeItemRequest(
                                                "SKU-1", "Длинное название ".repeat(100), 1))));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(new PDFTextStripper().getText(document).trim()).isEqualTo("SKU-1");
            assertThat(decodeFirst(document).getText()).isEqualTo("SKU-1");
        }
    }

    @Test
    void withNameGeometryIsSixtyByFortyFiveAndFitsEighteenLabelsPerPage() throws Exception {
        assertThat(BarcodePdfService.WITH_NAME_LABEL_WIDTH / BarcodePdfService.MM)
                .isCloseTo(60f, within(0.01f));
        assertThat(BarcodePdfService.WITH_NAME_LABEL_HEIGHT / BarcodePdfService.MM)
                .isCloseTo(45f, within(0.01f));
        assertThat(BarcodePdfService.WITH_NAME_PAGE_MARGIN_X / BarcodePdfService.MM)
                .isCloseTo(15f, within(0.01f));
        assertThat(BarcodePdfService.WITH_NAME_PAGE_MARGIN_Y / BarcodePdfService.MM)
                .isCloseTo(13.5f, within(0.01f));
        assertThat(BarcodePdfService.WITH_NAME_HORIZONTAL_GAP).isZero();
        assertThat(BarcodePdfService.WITH_NAME_VERTICAL_GAP).isZero();

        byte[] fullPage =
                service.generate(
                        namedRequest(new BarcodeItemRequest("NAMED-18", "Название товара", 18)));
        byte[] overflow =
                service.generate(
                        namedRequest(new BarcodeItemRequest("NAMED-19", "Название товара", 19)));

        try (PDDocument document = Loader.loadPDF(fullPage)) {
            assertThat(document.getNumberOfPages()).isEqualTo(1);
            assertThat(countOccurrences(new PDFTextStripper().getText(document), "NAMED-18"))
                    .isEqualTo(18);
        }
        try (PDDocument document = Loader.loadPDF(overflow)) {
            assertThat(document.getNumberOfPages()).isEqualTo(2);
        }
    }

    @Test
    void withNamePrintsCyrillicTitleAndKeepsBarcodeScannable() throws Exception {
        byte[] pdf =
                service.generate(
                        namedRequest(
                                new BarcodeItemRequest(
                                        "002456", "Кофе натуральный жареный в зернах", 1)));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document);
            assertThat(text).contains("Кофе натуральный").contains("002456");
            assertThat(decodeFirst(document).getText()).isEqualTo("002456");
        }
    }

    @Test
    void withNameTruncatesLongTitleInsteadOfRejectingRequest() throws Exception {
        String longName =
                "Очень длинное русское название товара для проверки аккуратного переноса и обрезки "
                        .repeat(20);
        byte[] pdf =
                service.generate(namedRequest(new BarcodeItemRequest("LONG-NAME", longName, 1)));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            String text = new PDFTextStripper().getText(document);
            assertThat(text).contains("Очень длинное").contains("...").contains("LONG-NAME");
            assertThat(decodeFirst(document).getText()).isEqualTo("LONG-NAME");
        }
    }

    @Test
    void generateDefaultsQuantityToOne() throws Exception {
        byte[] pdf = service.generate(request(new BarcodeItemRequest("100200300", null)));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isEqualTo(1);
        }
    }

    @Test
    void generateSupportsMoreThanFiveHundredLabels() throws Exception {
        byte[] pdf =
                service.generate(
                        request(
                                new BarcodeItemRequest("1", 100),
                                new BarcodeItemRequest("2", 100),
                                new BarcodeItemRequest("3", 100),
                                new BarcodeItemRequest("4", 100),
                                new BarcodeItemRequest("5", 100),
                                new BarcodeItemRequest("6", 100)));

        try (PDDocument document = Loader.loadPDF(pdf)) {
            assertThat(document.getNumberOfPages()).isEqualTo(17);
        }
    }

    @Test
    void generateRejectsTenThousandAndOneLabelsWithoutRenderingPdf() {
        List<BarcodeItemRequest> items =
                new ArrayList<>(Collections.nCopies(100, new BarcodeItemRequest("1", 100)));
        items.add(new BarcodeItemRequest("2", 1));

        assertThatThrownBy(
                        () ->
                                service.generate(
                                        new BarcodePdfRequest(
                                                BarcodePdfMode.COMPACT, items, false)))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("10000 labels");
    }

    @Test
    void generateRejectsNonAsciiValue() {
        assertThatThrownBy(() -> service.generate(request(new BarcodeItemRequest("АРТИКУЛ", 1))))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("printable ASCII");
    }

    @Test
    void generateRejectsBarcodeThatWouldHaveTooNarrowModules() {
        assertThatThrownBy(
                        () ->
                                service.generate(
                                        request(
                                                new BarcodeItemRequest(
                                                        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv",
                                                        1))))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("reliably scannable");
    }

    private BarcodePdfRequest request(BarcodeItemRequest... items) {
        return new BarcodePdfRequest(List.of(items));
    }

    private BarcodePdfRequest namedRequest(BarcodeItemRequest... items) {
        return new BarcodePdfRequest(BarcodePdfMode.WITH_NAME, List.of(items));
    }

    private int countOccurrences(String text, String value) {
        return (text.length() - text.replace(value, "").length()) / value.length();
    }

    private com.google.zxing.Result decodeFirst(PDDocument document) throws Exception {
        BufferedImage page = new PDFRenderer(document).renderImageWithDPI(0, 200);
        BinaryBitmap bitmap =
                new BinaryBitmap(new HybridBinarizer(new BufferedImageLuminanceSource(page)));
        return new MultiFormatReader()
                .decode(
                        bitmap,
                        Map.of(
                                DecodeHintType.POSSIBLE_FORMATS,
                                List.of(BarcodeFormat.CODE_128),
                                DecodeHintType.TRY_HARDER,
                                true));
    }

    private static org.assertj.core.data.Offset<Float> within(float value) {
        return org.assertj.core.data.Offset.offset(value);
    }
}
