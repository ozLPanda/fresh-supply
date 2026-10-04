package kz.company.shop.search;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.StringJoiner;
import kz.company.shop.categories.entity.Category;
import kz.company.shop.products.entity.Product;
import org.springframework.stereotype.Component;

@Component
public class SearchTextBuilder {
    public String productText(Product product, String categoryNameRu, String categoryNameKk) {
        StringJoiner joiner = new StringJoiner("\n");
        add(joiner, "SKU", product.sku);
        add(joiner, "Название RU", product.nameRu);
        add(joiner, "Название KK", product.nameKk);
        add(joiner, "Краткое описание RU", product.shortDescriptionRu);
        add(joiner, "Краткое описание KK", product.shortDescriptionKk);
        add(joiner, "Описание RU", product.descriptionRu);
        add(joiner, "Описание KK", product.descriptionKk);
        add(joiner, "Категория RU", categoryNameRu);
        add(joiner, "Категория KK", categoryNameKk);
        return joiner.toString();
    }

    public String categoryText(Category category, String parentNameRu, String parentNameKk) {
        StringJoiner joiner = new StringJoiner("\n");
        add(joiner, "Категория RU", category.nameRu);
        add(joiner, "Категория KK", category.nameKk);
        add(joiner, "Slug", category.slug);
        add(joiner, "Описание RU", category.descriptionRu);
        add(joiner, "Описание KK", category.descriptionKk);
        add(joiner, "Родитель RU", parentNameRu);
        add(joiner, "Родитель KK", parentNameKk);
        return joiner.toString();
    }

    public String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is not available", ex);
        }
    }

    private void add(StringJoiner joiner, String label, String value) {
        if (value == null || value.isBlank()) return;
        joiner.add(label + ": " + value.trim());
    }
}
