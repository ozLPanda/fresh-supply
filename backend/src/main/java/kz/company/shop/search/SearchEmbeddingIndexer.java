package kz.company.shop.search;

import java.util.List;
import kz.company.shop.categories.entity.Category;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

@Service
public class SearchEmbeddingIndexer {
    private static final Logger log = LoggerFactory.getLogger(SearchEmbeddingIndexer.class);

    private final EmbeddingProperties properties;
    private final EmbeddingClient embeddingClient;
    private final SearchTextBuilder textBuilder;
    private final SearchEmbeddingRepository embeddingRepository;
    private final ProductRepository productRepository;
    private final CategoryRepository categoryRepository;

    public SearchEmbeddingIndexer(
            EmbeddingProperties properties,
            EmbeddingClient embeddingClient,
            SearchTextBuilder textBuilder,
            SearchEmbeddingRepository embeddingRepository,
            ProductRepository productRepository,
            CategoryRepository categoryRepository) {
        this.properties = properties;
        this.embeddingClient = embeddingClient;
        this.textBuilder = textBuilder;
        this.embeddingRepository = embeddingRepository;
        this.productRepository = productRepository;
        this.categoryRepository = categoryRepository;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void backfill() {
        if (!properties.isEnabled()) return;
        int indexedProducts = 0;
        int page = 0;
        while (true) {
            List<Product> products =
                    productRepository.findByDeletedAtIsNullOrderByCreatedAtDescIdDesc(
                            PageRequest.of(page, properties.getBackfillBatchSize()));
            if (products.isEmpty()) break;
            for (Product product : products) {
                if (indexProduct(product)) indexedProducts++;
            }
            page++;
        }
        int indexedCategories = 0;
        for (Category category :
                categoryRepository.findByDeletedAtIsNullOrderBySortOrderAscNameRuAsc()) {
            if (indexCategory(category)) indexedCategories++;
        }
        log.info(
                "Search embedding backfill finished: products={}, categories={}",
                indexedProducts,
                indexedCategories);
    }

    public boolean indexProduct(Product product) {
        if (!properties.isEnabled() || product == null || product.id == null) return false;
        try {
            Category category =
                    product.category != null
                            ? product.category
                            : product.categoryId == null
                                    ? null
                                    : categoryRepository.findById(product.categoryId).orElse(null);
            String text =
                    textBuilder.productText(
                            product,
                            category == null ? null : category.nameRu,
                            category == null ? null : category.nameKk);
            String hash = textBuilder.sha256(text);
            if (embeddingRepository
                    .productHash(product.id, properties.getModel())
                    .filter(hash::equals)
                    .isPresent()) {
                return false;
            }
            return embeddingClient
                    .embedPassage(text)
                    .map(
                            vector -> {
                                embeddingRepository.upsertProduct(
                                        product.id, properties.getModel(), hash, vector);
                                return true;
                            })
                    .orElse(false);
        } catch (RuntimeException ex) {
            log.warn("Product embedding indexing failed for {}: {}", product.id, ex.getMessage());
            return false;
        }
    }

    public boolean indexCategory(Category category) {
        if (!properties.isEnabled() || category == null || category.id == null) return false;
        try {
            Category parent =
                    category.parent != null
                            ? category.parent
                            : category.parentId == null
                                    ? null
                                    : categoryRepository.findById(category.parentId).orElse(null);
            String text =
                    textBuilder.categoryText(
                            category,
                            parent == null ? null : parent.nameRu,
                            parent == null ? null : parent.nameKk);
            String hash = textBuilder.sha256(text);
            if (embeddingRepository
                    .categoryHash(category.id, properties.getModel())
                    .filter(hash::equals)
                    .isPresent()) {
                return false;
            }
            return embeddingClient
                    .embedPassage(text)
                    .map(
                            vector -> {
                                embeddingRepository.upsertCategory(
                                        category.id, properties.getModel(), hash, vector);
                                return true;
                            })
                    .orElse(false);
        } catch (RuntimeException ex) {
            log.warn("Category embedding indexing failed for {}: {}", category.id, ex.getMessage());
            return false;
        }
    }
}
