package kz.company.shop.orders.service;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/** Russian wording for the decimal quantities and KZT totals printed in delivery notes. */
final class RussianInvoiceWords {
    private static final String[] ONES = {
        "", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"
    };
    private static final String[] TEENS = {
        "десять",
        "одиннадцать",
        "двенадцать",
        "тринадцать",
        "четырнадцать",
        "пятнадцать",
        "шестнадцать",
        "семнадцать",
        "восемнадцать",
        "девятнадцать"
    };
    private static final String[] TENS = {
        "",
        "",
        "двадцать",
        "тридцать",
        "сорок",
        "пятьдесят",
        "шестьдесят",
        "семьдесят",
        "восемьдесят",
        "девяносто"
    };
    private static final String[] HUNDREDS = {
        "",
        "сто",
        "двести",
        "триста",
        "четыреста",
        "пятьсот",
        "шестьсот",
        "семьсот",
        "восемьсот",
        "девятьсот"
    };
    private static final String[][] GROUPS = {
        {"", "", ""},
        {"тысяча", "тысячи", "тысяч"},
        {"миллион", "миллиона", "миллионов"},
        {"миллиард", "миллиарда", "миллиардов"},
        {"триллион", "триллиона", "триллионов"},
        {"квадриллион", "квадриллиона", "квадриллионов"}
    };

    private RussianInvoiceWords() {}

    static String money(BigDecimal value) {
        BigDecimal amount = value.setScale(2, RoundingMode.HALF_UP);
        if (amount.signum() < 0) return "минус " + money(amount.negate());
        BigInteger whole = amount.toBigInteger();
        int minor = amount.remainder(BigDecimal.ONE).movePointRight(2).intValueExact();
        return integer(whole, false)
                + " тенге "
                + String.format(java.util.Locale.ROOT, "%02d", minor)
                + " тиын";
    }

    static String quantity(BigDecimal value, boolean kilograms) {
        BigDecimal amount = value.setScale(3, RoundingMode.HALF_UP).stripTrailingZeros();
        if (amount.signum() < 0) return "минус " + quantity(amount.negate(), kilograms);
        BigInteger whole = amount.toBigInteger();
        int scale = Math.max(0, amount.scale());
        if (scale == 0) {
            String[] unit =
                    kilograms
                            ? new String[] {"килограмм", "килограмма", "килограммов"}
                            : new String[] {"штука", "штуки", "штук"};
            return integer(whole, !kilograms)
                    + " "
                    + form(whole.mod(BigInteger.valueOf(100)).intValue(), unit);
        }
        int numerator = amount.remainder(BigDecimal.ONE).movePointRight(scale).intValueExact();
        String[] fraction =
                switch (scale) {
                    case 1 -> new String[] {"десятая", "десятых", "десятых"};
                    case 2 -> new String[] {"сотая", "сотых", "сотых"};
                    default -> new String[] {"тысячная", "тысячных", "тысячных"};
                };
        return integer(whole, true)
                + " "
                + form(
                        whole.mod(BigInteger.valueOf(100)).intValue(),
                        new String[] {"целая", "целых", "целых"})
                + " "
                + integer(BigInteger.valueOf(numerator), true)
                + " "
                + form(numerator, fraction)
                + (kilograms ? " килограмма" : " штуки");
    }

    static String capitalize(String value) {
        return value.isEmpty()
                ? value
                : Character.toUpperCase(value.charAt(0)) + value.substring(1);
    }

    private static String integer(BigInteger number, boolean feminine) {
        if (number.signum() == 0) return "ноль";
        List<String> groups = new ArrayList<>();
        int group = 0;
        while (number.signum() > 0) {
            BigInteger[] parts = number.divideAndRemainder(BigInteger.valueOf(1000));
            int n = parts[1].intValue();
            if (n != 0) {
                if (group >= GROUPS.length)
                    throw new IllegalArgumentException("Слишком большая сумма для накладной");
                String words = triplet(n, group == 1 || group == 0 && feminine);
                if (group > 0) words += " " + form(n, GROUPS[group]);
                groups.add(0, words);
            }
            number = parts[0];
            group++;
        }
        return String.join(" ", groups);
    }

    private static String triplet(int number, boolean feminine) {
        List<String> words = new ArrayList<>();
        if (number >= 100) words.add(HUNDREDS[number / 100]);
        int rest = number % 100;
        if (rest >= 10 && rest <= 19) words.add(TEENS[rest - 10]);
        else {
            if (rest >= 20) words.add(TENS[rest / 10]);
            int last = rest % 10;
            if (last > 0)
                words.add(
                        feminine && last == 1
                                ? "одна"
                                : feminine && last == 2 ? "две" : ONES[last]);
        }
        return String.join(" ", words);
    }

    private static String form(int number, String[] forms) {
        int lastTwo = Math.abs(number % 100);
        if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
        return switch (lastTwo % 10) {
            case 1 -> forms[0];
            case 2, 3, 4 -> forms[1];
            default -> forms[2];
        };
    }
}
