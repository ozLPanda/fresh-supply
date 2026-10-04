package kz.company.shop.search;

import static org.assertj.core.api.Assertions.assertThat;

import kz.company.shop.categories.entity.Category;
import kz.company.shop.products.entity.Product;
import org.junit.jupiter.api.Test;

class SearchTextBuilderTest {
    private final SearchTextBuilder builder = new SearchTextBuilder();

    @Test
    void buildsProductPassageTextFromRussianKazakhAndCategoryFields() {
        Product product = new Product();
        product.sku = "PUMP-42";
        product.nameRu = "Циркуляционный насос";
        product.nameKk = "Айналым сорғысы";
        product.shortDescriptionRu = "Для отопления";

        String text = builder.productText(product, "Насосы", "Сорғылар");

        assertThat(text)
                .contains("SKU: PUMP-42")
                .contains("Название RU: Циркуляционный насос")
                .contains("Название KK: Айналым сорғысы")
                .contains("Категория RU: Насосы")
                .contains("Категория KK: Сорғылар");
    }

    @Test
    void buildsCategoryPassageTextAndStableContentHash() {
        Category category = new Category();
        category.nameRu = "Котлы";
        category.nameKk = "Қазандықтар";
        category.slug = "boilers";
        category.descriptionRu = "Газовые и электрические котлы";

        String text = builder.categoryText(category, "Отопление", "Жылыту");

        assertThat(text)
                .contains("Категория RU: Котлы")
                .contains("Категория KK: Қазандықтар")
                .contains("Slug: boilers")
                .contains("Родитель RU: Отопление");
        assertThat(builder.sha256(text)).isEqualTo(builder.sha256(text));
        assertThat(builder.sha256(text)).hasSize(64);
    }
}
