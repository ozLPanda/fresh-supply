package kz.company.shop.regularbuyers;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import kz.company.shop.common.exception.AppExceptions;

/** Shared normalization for directory aliases and assistant lookup. */
public final class RegularBuyerAliases {
    public static final int MAX_ALIASES = 50;
    public static final int MAX_LENGTH = 120;

    private RegularBuyerAliases() {}

    public static String display(String value) {
        return value == null ? null : value.replaceAll("(?U)\\s+", " ").trim();
    }

    public static String key(String value) {
        String display = display(value);
        return display == null ? "" : display.toLowerCase(Locale.ROOT).replace('ё', 'е');
    }

    public static List<String> normalize(List<String> aliases) {
        if (aliases == null) return List.of();
        if (aliases.size() > MAX_ALIASES) {
            throw new AppExceptions.BadRequest(
                    "Можно указать не более 50 дополнительных названий покупателя");
        }
        Map<String, String> unique = new LinkedHashMap<>();
        for (String alias : aliases) {
            String normalized = display(alias);
            if (normalized == null || normalized.isEmpty()) {
                throw new AppExceptions.BadRequest(
                        "Дополнительное название покупателя не должно быть пустым");
            }
            if (normalized.length() > MAX_LENGTH) {
                throw new AppExceptions.BadRequest(
                        "Дополнительное название покупателя не должно превышать 120 символов");
            }
            unique.putIfAbsent(key(normalized), normalized);
        }
        return List.copyOf(unique.values());
    }
}
