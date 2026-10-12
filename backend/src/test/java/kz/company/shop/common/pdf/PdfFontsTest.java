package kz.company.shop.common.pdf;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

class PdfFontsTest {
    @Test
    void packagedFontsEmbedCyrillicAndTengeWithoutSystemFonts() throws Exception {
        String text = "Накладная: Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі, 1 234,50 ₸";
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (PDDocument document = new PDDocument()) {
            PdfFonts.Fonts fonts = PdfFonts.load(document);
            assertThat(fonts.regular().getName()).isEqualTo("DejaVuSans");
            assertThat(fonts.bold().getName()).isEqualTo("DejaVuSans-Bold");
            PDPage page = new PDPage();
            document.addPage(page);
            try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                for (PDFont font : new PDFont[] {fonts.regular(), fonts.bold()}) {
                    content.beginText();
                    content.setFont(font, 12);
                    content.newLineAtOffset(30, font == fonts.regular() ? 760 : 730);
                    content.showText(text);
                    content.endText();
                }
            }
            document.save(bytes);
        }
        try (PDDocument reloaded = Loader.loadPDF(bytes.toByteArray())) {
            assertThat(new PDFTextStripper().getText(reloaded)).contains(text);
            for (var name : reloaded.getPage(0).getResources().getFontNames()) {
                assertThat(reloaded.getPage(0).getResources().getFont(name).isEmbedded()).isTrue();
            }
        }
    }
}
