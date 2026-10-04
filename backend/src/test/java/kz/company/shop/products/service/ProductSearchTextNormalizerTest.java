package kz.company.shop.products.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ProductSearchTextNormalizerTest {
    @Test
    void treatsMixedCyrillicAndLatinLookAlikesAsTheSameSearchText() {
        assertThat(ProductSearchTextNormalizer.normalize("mstcom"))
                .isEqualTo(ProductSearchTextNormalizer.normalize("MSTсom"));
    }

    @Test
    void keepsPartialCyrillicSearchEquivalentWhenTheLettersAreMixed() {
        assertThat(ProductSearchTextNormalizer.normalize(" Лен сант "))
                .isEqualTo(ProductSearchTextNormalizer.normalize("Лeн сaнт"));
    }

    @Test
    void readsLatinKeyboardInputAsRussianText() {
        assertThat(ProductSearchTextNormalizer.latinKeyboardToRussian("ujhyzr rjntk"))
                .isEqualTo("горняк котел");
    }

    @Test
    void keepsKeyboardLayoutVariantsReadableForOrdinaryDatabaseSearch() {
        assertThat(ProductSearchTextNormalizer.rawSearchVariants("cthutq"))
                .contains("cthutq", "сергей");
    }

    @Test
    void readsRussianKeyboardInputAsLatinText() {
        assertThat(ProductSearchTextNormalizer.russianKeyboardToLatin("ьыесщь")).isEqualTo("mstcom");
    }

    @Test
    void transliteratesRussianAndLatinProductNames() {
        assertThat(ProductSearchTextNormalizer.transliterateRussianToLatin("арамис"))
                .isEqualTo("aramis");
        assertThat(ProductSearchTextNormalizer.transliterateLatinToRussian("aramis"))
                .isEqualTo("арамис");
    }

    @Test
    void matchesTransliteratedProductSearchInBothDirections() {
        assertThat(ProductSearchTextNormalizer.matches("aramis", "арамис")).isTrue();
        assertThat(ProductSearchTextNormalizer.matches("Арамис", "aramis")).isTrue();
    }

    @Test
    void treatsEAndYoAsEquivalentInBothDirections() {
        assertThat(ProductSearchTextNormalizer.normalize("Все"))
                .isEqualTo(ProductSearchTextNormalizer.normalize("Всё"));
        assertThat(ProductSearchTextNormalizer.matches("Котел", "котёл")).isTrue();
        assertThat(ProductSearchTextNormalizer.matches("Котёл", "котел")).isTrue();
    }
}
