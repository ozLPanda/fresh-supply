package kz.company.shop.warehouse.ai;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;

/** Extracts pricing instructions while leaving historical group notes untouched in storage. */
final class AiPriceRuleText {
    private static final Pattern DMITRY_HISTORY = Pattern.compile("(?iu)(?:^|\\s)для\\s+Дмитрия(?=\\s|$)");

    private AiPriceRuleText() {}

    static String forAnalysis(String commonRules) {
        if (commonRules == null || commonRules.isBlank()) return "";
        String text = Jsoup.parseBodyFragment(commonRules).text();
        Matcher history = DMITRY_HISTORY.matcher(text);
        return (history.find() ? text.substring(0, history.start()) : text).trim();
    }
}
