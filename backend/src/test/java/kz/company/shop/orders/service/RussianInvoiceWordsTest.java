package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class RussianInvoiceWordsTest {
    @Test
    void spellsMoneyWithoutDroppingMinorCurrencyOrThousandGender() {
        assertThat(RussianInvoiceWords.money(new BigDecimal("58015.20")))
                .isEqualTo("пятьдесят восемь тысяч пятнадцать тенге 20 тиын");
        assertThat(RussianInvoiceWords.money(new BigDecimal("2001.005")))
                .isEqualTo("две тысячи один тенге 01 тиын");
        assertThat(RussianInvoiceWords.money(BigDecimal.ZERO)).isEqualTo("ноль тенге 00 тиын");
        assertThat(RussianInvoiceWords.money(new BigDecimal("999.995")))
                .isEqualTo("одна тысяча тенге 00 тиын");
    }

    @Test
    void spellsFractionalQuantitiesAndCorrectUnitDeclensions() {
        assertThat(RussianInvoiceWords.quantity(new BigDecimal("49.160"), true))
                .isEqualTo("сорок девять целых шестнадцать сотых килограмма");
        assertThat(RussianInvoiceWords.quantity(new BigDecimal("1.001"), true))
                .isEqualTo("одна целая одна тысячная килограмма");
        assertThat(RussianInvoiceWords.quantity(new BigDecimal("21"), false))
                .isEqualTo("двадцать одна штука");
        assertThat(RussianInvoiceWords.quantity(new BigDecimal("2"), false)).isEqualTo("две штуки");
        assertThat(RussianInvoiceWords.quantity(new BigDecimal("12"), true))
                .isEqualTo("двенадцать килограммов");
        assertThat(RussianInvoiceWords.quantity(new BigDecimal("100000000021"), true))
                .isEqualTo("сто миллиардов двадцать один килограмм");
    }
}
