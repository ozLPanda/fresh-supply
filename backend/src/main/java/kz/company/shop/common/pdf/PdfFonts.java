package kz.company.shop.common.pdf;

import java.io.IOException;
import java.io.InputStream;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

/** Embedded document fonts that do not depend on the operating system's font installation. */
public final class PdfFonts {
    private PdfFonts() {}

    public static Fonts load(PDDocument document) throws IOException {
        return new Fonts(loadRegular(document), loadFont(document, "/fonts/DejaVuSans-Bold.ttf"));
    }

    public static PDFont loadRegular(PDDocument document) throws IOException {
        return loadFont(document, "/fonts/DejaVuSans.ttf");
    }

    private static PDFont loadFont(PDDocument document, String resource) throws IOException {
        // A resource stream also works from the packaged Spring Boot JAR on Windows and macOS.
        try (InputStream stream = PdfFonts.class.getResourceAsStream(resource)) {
            if (stream == null) {
                throw new IOException("Не найден встроенный шрифт PDF: " + resource);
            }
            return PDType0Font.load(document, stream, true);
        }
    }

    public record Fonts(PDFont regular, PDFont bold) {}
}
