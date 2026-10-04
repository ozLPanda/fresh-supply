package kz.company.shop.products.service;

import java.util.Locale;
import java.util.List;

/** Normalizes the Cyrillic/Latin look-alike letters commonly mixed in imported product names. */
public final class ProductSearchTextNormalizer {
    static final String CYRILLIC_HOMOGLYPHS = "авсеёнкмортухіј";
    static final String LATIN_HOMOGLYPHS = "abceehkmoptyxij";

    private ProductSearchTextNormalizer() {}

    public static String normalize(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        if (normalized.isBlank()) return null;
        return normalized
                .replace('а', 'a')
                .replace('в', 'b')
                .replace('с', 'c')
                .replace('е', 'e')
                .replace('ё', 'e')
                .replace('н', 'h')
                .replace('к', 'k')
                .replace('м', 'm')
                .replace('о', 'o')
                .replace('р', 'p')
                .replace('т', 't')
                .replace('у', 'y')
                .replace('х', 'x')
                .replace('і', 'i')
                .replace('ј', 'j');
    }

    /** Reads Latin keyboard keys as their Russian-layout counterparts without changing other text. */
    public static String latinKeyboardToRussian(String value) {
        if (value == null) return null;
        StringBuilder result = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            result.append(
                    switch (value.charAt(index)) {
                        case 'q' -> 'й';
                        case 'w' -> 'ц';
                        case 'e' -> 'у';
                        case 'r' -> 'к';
                        case 't' -> 'е';
                        case 'y' -> 'н';
                        case 'u' -> 'г';
                        case 'i' -> 'ш';
                        case 'o' -> 'щ';
                        case 'p' -> 'з';
                        case '[' -> 'х';
                        case ']' -> 'ъ';
                        case 'a' -> 'ф';
                        case 's' -> 'ы';
                        case 'd' -> 'в';
                        case 'f' -> 'а';
                        case 'g' -> 'п';
                        case 'h' -> 'р';
                        case 'j' -> 'о';
                        case 'k' -> 'л';
                        case 'l' -> 'д';
                        case ';' -> 'ж';
                        case '\'' -> 'э';
                        case 'z' -> 'я';
                        case 'x' -> 'ч';
                        case 'c' -> 'с';
                        case 'v' -> 'м';
                        case 'b' -> 'и';
                        case 'n' -> 'т';
                        case 'm' -> 'ь';
                        case ',' -> 'б';
                        case '.' -> 'ю';
                        default -> value.charAt(index);
                    });
        }
        return result.toString();
    }

    /** Reads Russian keyboard keys as their Latin-layout counterparts without changing other text. */
    public static String russianKeyboardToLatin(String value) {
        if (value == null) return null;
        StringBuilder result = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            result.append(
                    switch (value.charAt(index)) {
                        case 'й' -> 'q';
                        case 'ц' -> 'w';
                        case 'у' -> 'e';
                        case 'к' -> 'r';
                        case 'е' -> 't';
                        case 'н' -> 'y';
                        case 'г' -> 'u';
                        case 'ш' -> 'i';
                        case 'щ' -> 'o';
                        case 'з' -> 'p';
                        case 'х' -> '[';
                        case 'ъ' -> ']';
                        case 'ф' -> 'a';
                        case 'ы' -> 's';
                        case 'в' -> 'd';
                        case 'а' -> 'f';
                        case 'п' -> 'g';
                        case 'р' -> 'h';
                        case 'о' -> 'j';
                        case 'л' -> 'k';
                        case 'д' -> 'l';
                        case 'ж' -> ';';
                        case 'э' -> '\'';
                        case 'я' -> 'z';
                        case 'ч' -> 'x';
                        case 'с' -> 'c';
                        case 'м' -> 'v';
                        case 'и' -> 'b';
                        case 'т' -> 'n';
                        case 'ь' -> 'm';
                        case 'б' -> ',';
                        case 'ю' -> '.';
                        default -> value.charAt(index);
                    });
        }
        return result.toString();
    }

    /** Produces a common Latin spelling for a Russian product name or search query. */
    public static String transliterateRussianToLatin(String value) {
        if (value == null) return null;
        StringBuilder result = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            result.append(
                    switch (value.charAt(index)) {
                        case 'а' -> "a";
                        case 'б' -> "b";
                        case 'в' -> "v";
                        case 'г' -> "g";
                        case 'д' -> "d";
                        case 'е' -> "e";
                        case 'ё' -> "yo";
                        case 'ж' -> "zh";
                        case 'з' -> "z";
                        case 'и' -> "i";
                        case 'й' -> "y";
                        case 'к' -> "k";
                        case 'л' -> "l";
                        case 'м' -> "m";
                        case 'н' -> "n";
                        case 'о' -> "o";
                        case 'п' -> "p";
                        case 'р' -> "r";
                        case 'с' -> "s";
                        case 'т' -> "t";
                        case 'у' -> "u";
                        case 'ф' -> "f";
                        case 'х' -> "kh";
                        case 'ц' -> "ts";
                        case 'ч' -> "ch";
                        case 'ш' -> "sh";
                        case 'щ' -> "shch";
                        case 'ъ', 'ь' -> "";
                        case 'ы' -> "y";
                        case 'э' -> "e";
                        case 'ю' -> "yu";
                        case 'я' -> "ya";
                        default -> String.valueOf(value.charAt(index));
                    });
        }
        return result.toString();
    }

    /** Reads a common Latin transliteration as the corresponding Russian spelling. */
    public static String transliterateLatinToRussian(String value) {
        if (value == null) return null;
        StringBuilder result = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); ) {
            String tail = value.substring(index);
            if (tail.startsWith("shch")) {
                result.append('щ');
                index += 4;
            } else if (tail.startsWith("sch")) {
                result.append('щ');
                index += 3;
            } else if (tail.startsWith("yo")) {
                result.append('ё');
                index += 2;
            } else if (tail.startsWith("zh")) {
                result.append('ж');
                index += 2;
            } else if (tail.startsWith("kh")) {
                result.append('х');
                index += 2;
            } else if (tail.startsWith("ts")) {
                result.append('ц');
                index += 2;
            } else if (tail.startsWith("ch")) {
                result.append('ч');
                index += 2;
            } else if (tail.startsWith("sh")) {
                result.append('ш');
                index += 2;
            } else if (tail.startsWith("yu")) {
                result.append('ю');
                index += 2;
            } else if (tail.startsWith("ya")) {
                result.append('я');
                index += 2;
            } else {
                result.append(transliteratedRussianLetter(value.charAt(index)));
                index++;
            }
        }
        return result.toString();
    }

    private static char transliteratedRussianLetter(char value) {
        return switch (value) {
            case 'a' -> 'а';
            case 'b' -> 'б';
            case 'c', 'k', 'q' -> 'к';
            case 'd' -> 'д';
            case 'e' -> 'е';
            case 'f' -> 'ф';
            case 'g' -> 'г';
            case 'h' -> 'х';
            case 'i' -> 'и';
            case 'j', 'y' -> 'й';
            case 'l' -> 'л';
            case 'm' -> 'м';
            case 'n' -> 'н';
            case 'o' -> 'о';
            case 'p' -> 'п';
            case 'r' -> 'р';
            case 's' -> 'с';
            case 't' -> 'т';
            case 'u' -> 'у';
            case 'v', 'w' -> 'в';
            case 'x' -> 'к';
            case 'z' -> 'з';
            default -> value;
        };
    }

    public static List<String> searchVariants(String value) {
        if (value == null || value.isBlank()) return List.of();
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return List.of(
                        normalize(normalized),
                        normalize(latinKeyboardToRussian(normalized)),
                        normalize(russianKeyboardToLatin(normalized)),
                        normalize(transliterateRussianToLatin(normalized)),
                        normalize(transliterateLatinToRussian(normalized)))
                .stream()
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
    }

    /**
     * Produces keyboard-layout and transliteration alternatives without applying the product
     * homograph normalization. Use this for ordinary database text fields outside the catalogue.
     */
    public static List<String> rawSearchVariants(String value) {
        if (value == null || value.isBlank()) return List.of();
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return List.of(
                        normalized,
                        latinKeyboardToRussian(normalized),
                        russianKeyboardToLatin(normalized),
                        transliterateRussianToLatin(normalized),
                        transliterateLatinToRussian(normalized))
                .stream()
                .map(candidate -> candidate == null ? null : candidate.trim())
                .filter(candidate -> candidate != null && !candidate.isBlank())
                .distinct()
                .toList();
    }

    public static boolean matches(String searchableValue, String search) {
        if (search == null || search.isBlank()) return true;
        String normalizedValue = normalize(searchableValue);
        return normalizedValue != null
                && searchVariants(search).stream().anyMatch(normalizedValue::contains);
    }
}
