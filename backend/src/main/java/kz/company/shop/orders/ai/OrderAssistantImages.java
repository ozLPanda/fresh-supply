package kz.company.shop.orders.ai;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import javax.imageio.ImageIO;

/** Inspect image headers without allocating an unbounded decoded bitmap. */
final class OrderAssistantImages {
    private OrderAssistantImages() {}

    static boolean valid(String url, byte[] bytes) {
        if (bytes.length < 24) return false;
        if (url.startsWith("data:image/webp;")) {
            if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) return false;
            long width, height;
            if (ascii(bytes, 12, "VP8X") && bytes.length >= 30) {
                width = little(bytes, 24, 3) + 1;
                height = little(bytes, 27, 3) + 1;
            } else if (ascii(bytes, 12, "VP8 ")
                    && bytes.length >= 30
                    && (bytes[23] & 255) == 0x9d
                    && bytes[24] == 1
                    && bytes[25] == 0x2a) {
                width = little(bytes, 26, 2) & 0x3fff;
                height = little(bytes, 28, 2) & 0x3fff;
            } else if (ascii(bytes, 12, "VP8L") && bytes.length >= 25 && bytes[20] == 0x2f) {
                long packed = little(bytes, 21, 4);
                width = (packed & 0x3fff) + 1;
                height = ((packed >> 14) & 0x3fff) + 1;
            } else return false;
            return little(bytes, 4, 4) + 8 == bytes.length && dimensions(width, height);
        }
        boolean png = bytes[0] == (byte) 0x89 && ascii(bytes, 1, "PNG\r\n\032\n");
        boolean jpeg =
                bytes[0] == (byte) 0xff && bytes[1] == (byte) 0xd8 && bytes[2] == (byte) 0xff;
        if (!(url.startsWith("data:image/png;") && png
                || url.startsWith("data:image/jpeg;") && jpeg)) return false;
        try (var input = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) return false;
            var reader = readers.next();
            try {
                reader.setInput(input);
                return dimensions(reader.getWidth(0), reader.getHeight(0));
            } finally {
                reader.dispose();
            }
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean dimensions(long width, long height) {
        return width > 0
                && height > 0
                && width <= 16000
                && height <= 16000
                && width * height <= 40_000_000;
    }

    private static long little(byte[] bytes, int offset, int count) {
        long result = 0;
        for (int i = 0; i < count; i++) result |= (long) (bytes[offset + i] & 255) << (8 * i);
        return result;
    }

    private static boolean ascii(byte[] bytes, int offset, String expected) {
        return new String(bytes, offset, expected.length(), StandardCharsets.ISO_8859_1)
                .equals(expected);
    }
}
