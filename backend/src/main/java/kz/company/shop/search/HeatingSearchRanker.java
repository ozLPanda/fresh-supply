package kz.company.shop.search;

import java.util.List;
import java.util.Locale;
import kz.company.shop.products.entity.Product;
import org.springframework.stereotype.Component;

/**
 * Applies a small, transparent domain boost after semantic retrieval. Embeddings find products
 * expressed in everyday language; this keeps complete heating appliances ahead of their parts.
 */
@Component
public class HeatingSearchRanker {
    public List<String> candidateTerms(String rawQuery) {
        String query = normalize(rawQuery);
        if (!isHeatingRequest(query) || isAccessoryRequest(query)) return List.of();
        if (containsAny(query, "электр", "электро", "эл кот", "220в", "380в")) {
            return List.of("электр", "эвп");
        }
        return List.of("котел", "котёл", "горняк");
    }

    public int score(String rawQuery, Product product) {
        String query = normalize(rawQuery);
        String name = normalize(product.nameRu + " " + product.nameKk);
        if (!isHeatingRequest(query) || isAccessoryRequest(query)) return 0;

        boolean electricRequested =
                containsAny(query, "электр", "электро", "эл кот", "220в", "380в");
        boolean electricProduct = containsAny(name, "электр", "электро", "эвп");
        boolean boiler = containsAny(name, "котел", "котёл", "горняк");
        boolean longBurningBoiler = boiler && containsAny(name, "длительного горения", "горняк");

        if (isAccessory(name)) return -200;
        if (!boiler) return 0;

        if (electricRequested) return electricProduct ? 200 : -80;
        if (longBurningBoiler) return 160;
        return electricProduct ? 40 : 100;
    }

    private boolean isHeatingRequest(String query) {
        return containsAny(
                query,
                "котел",
                "котёл",
                "печ",
                "отоп",
                "обогрев",
                "греть",
                "тепл",
                "угол",
                "угл",
                "дров",
                "твердотоплив");
    }

    private boolean isAccessoryRequest(String query) {
        return containsAny(query, "бак", "ручк", "ерш", "ёрш", "термоманометр", "горелк", "клапан");
    }

    private boolean isAccessory(String name) {
        return containsAny(
                name, "бак печ", "ручк", "ерш", "ёрш", "термоманометр", "горелк", "клапан");
    }

    private boolean containsAny(String text, String... values) {
        for (String value : values) {
            if (text.contains(value)) return true;
        }
        return false;
    }

    private String normalize(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
