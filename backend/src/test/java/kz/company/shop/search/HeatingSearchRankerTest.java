package kz.company.shop.search;

import static org.assertj.core.api.Assertions.assertThat;

import kz.company.shop.products.entity.Product;
import org.junit.jupiter.api.Test;

class HeatingSearchRankerTest {
    private final HeatingSearchRanker ranker = new HeatingSearchRanker();

    @Test
    void everydayHomeStoveRequestPrefersLongBurningBoilerOverElectricAndAccessories() {
        assertThat(ranker.score("печь для дома", product("Горняк Котёл длительного горения")))
                .isGreaterThan(ranker.score("печь для дома", product("Электрический котёл ЭВП-9")));
        assertThat(ranker.score("печь для дома", product("Электрический котёл ЭВП-9")))
                .isGreaterThan(ranker.score("печь для дома", product("Бак печной 50 л")));
    }

    @Test
    void explicitElectricRequestPrefersElectricBoiler() {
        assertThat(ranker.score("электрическая печь", product("Электрический котёл ЭВП-9")))
                .isGreaterThan(
                        ranker.score(
                                "электрическая печь", product("Горняк Котёл длительного горения")));
    }

    @Test
    void requestsMissingProfessionalTermsStillAddTheRightEquipmentType() {
        assertThat(ranker.candidateTerms("печка чтобы дом грела")).contains("котел", "горняк");
        assertThat(ranker.candidateTerms("электрическая печь")).contains("электр", "эвп");
    }

    @Test
    void accessoryRequestDoesNotHideMatchingAccessory() {
        assertThat(ranker.score("бак для печи", product("Бак печной 50 л"))).isZero();
    }

    private Product product(String name) {
        Product product = new Product();
        product.nameRu = name;
        product.nameKk = "";
        return product;
    }
}
