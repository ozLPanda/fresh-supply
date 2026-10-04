package kz.company.shop.orders.ai;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Human approval evidence for shared buyer aliases; model-generated claims are not evidence. */
public final class OrderAssistantAliasApproval {
    private static final Set<String> AFFIRMATIVES =
            Set.of("да", "подтверждаю", "да, верно", "да, подтверждаю");
    private static final Set<String> NEGATIVES =
            Set.of(
                    "нет",
                    "не надо",
                    "не нужно",
                    "не сохраняй",
                    "не запоминай",
                    "отмена",
                    "нет, не надо");
    private static final Pattern NON_AFFIRMATIVE =
            Pattern.compile(
                    "(?U)(?<!\\p{L})(?:не|нет|если|возможно|наверное|пример|допустим|пока)(?!\\p{L})");

    private OrderAssistantAliasApproval() {}

    /** Accept only a complete affirmative mapping, never a header or a quoted example. */
    public static boolean explicitMapping(String alias, String officialName, String message) {
        String source = normalize(alias);
        String buyer = normalize(officialName);
        String statement = normalize(message);
        if (source.isEmpty() || buyer.isEmpty() || statement.isEmpty()) return false;
        if (statement.contains("?")
                || NON_AFFIRMATIVE.matcher(statement).find()
                || "\"'«“‘`".indexOf(statement.charAt(0)) >= 0) return false;

        // Literal entity names may contain punctuation, parentheses or quotes. Quote them as
        // regex data while requiring the entire message to have this affirmative grammar.
        // Questions, negations, conditions and surrounding quoted statements cannot match.
        String connector = "(?:\\s+(?:—|–|-)\\s+(?:это\\s+)?|\\s*=\\s*|\\s*->\\s*|\\s+это\\s+)";
        String expression =
                "(?:покупатель\\s+)?"
                        + Pattern.quote(source)
                        + connector
                        + "(?:покупатель\\s+)?"
                        + Pattern.quote(buyer)
                        + "[.!]?";
        return Pattern.matches(expression, statement);
    }

    /** This dedicated server message must be the last chat turn before a short confirmation. */
    public static String question(String alias, String officialName) {
        return "Запомнить «"
                + display(alias)
                + "» как название покупателя «"
                + display(officialName)
                + "» для всех сотрудников? Ответьте «да» или «нет».";
    }

    public static boolean confirmed(
            String alias,
            String officialName,
            List<OrderAssistantDto.Chat> history,
            String message) {
        if (normalize(alias).isEmpty()
                || normalize(officialName).isEmpty()
                || history == null
                || history.isEmpty()
                || !AFFIRMATIVES.contains(answer(message))) return false;
        OrderAssistantDto.Chat last = history.get(history.size() - 1);
        return last != null
                && "assistant".equals(last.role())
                && question(alias, officialName).equals(last.content());
    }

    public static boolean rejected(String message) {
        return NEGATIVES.contains(answer(message));
    }

    private static String answer(String message) {
        return normalize(message).replaceFirst("[.!]$", "");
    }

    private static String normalize(String value) {
        return display(value).toLowerCase(Locale.ROOT).replace('ё', 'е');
    }

    private static String display(String value) {
        return value == null ? "" : value.replaceAll("(?U)\\s+", " ").trim();
    }
}
