package kz.company.shop.priceImports.service;

import jakarta.persistence.criteria.Predicate;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.categories.service.CategoryService;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.priceImports.dto.ImportCreatedProductActivationAnalysisDto;
import kz.company.shop.priceImports.dto.ImportCreatedProductActivationResultDto;
import kz.company.shop.priceImports.dto.ImportCreatedProductActivationSkipDto;
import kz.company.shop.priceImports.dto.ImportCreatedProductDto;
import kz.company.shop.priceImports.dto.ImportCreatedProductImportDto;
import kz.company.shop.priceImports.entity.PriceImportSession;
import kz.company.shop.priceImports.repository.PriceImportSessionRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import kz.company.shop.search.SearchEmbeddingIndexer;
import kz.company.shop.settings.service.ProjectSettingsService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ImportCreatedProductService {
    private static final int MAX_PAGE_SIZE = 200;
    private static final String NO_CATEGORY_NAME = "Нет категории";
    private static final List<String> DEFAULT_EXCLUDED_NAME_TERMS =
            List.of("не выбирать", "корзина");

    private final ProductRepository products;
    private final PriceImportSessionRepository imports;
    private final CategoryService categories;
    private final ProjectSettingsService settings;
    private final SearchEmbeddingIndexer searchEmbeddingIndexer;
    private final AuditService auditService;

    public ImportCreatedProductService(
            ProductRepository products,
            PriceImportSessionRepository imports,
            CategoryService categories,
            ProjectSettingsService settings,
            SearchEmbeddingIndexer searchEmbeddingIndexer,
            AuditService auditService) {
        this.products = products;
        this.imports = imports;
        this.categories = categories;
        this.settings = settings;
        this.searchEmbeddingIndexer = searchEmbeddingIndexer;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public PageResult<ImportCreatedProductDto> list(
            int page,
            int size,
            String search,
            UUID importId,
            Boolean active,
            String sort,
            String direction) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        Page<Product> result =
                products.findAll(
                        specification(search, importId, active),
                        PageRequest.of(safePage - 1, safeSize, resolveSort(sort, direction)));
        Map<UUID, PriceImportSession> sessions =
                imports
                        .findAllById(
                                result.getContent().stream()
                                        .map(product -> product.createdFromPriceImportId)
                                        .distinct()
                                        .toList())
                        .stream()
                        .collect(Collectors.toMap(session -> session.id, Function.identity()));
        Map<Long, String> categoryNames =
                categories.namesRu(
                        result.getContent().stream()
                                .map(product -> product.categoryId)
                                .filter(java.util.Objects::nonNull)
                                .distinct()
                                .toList());
        List<ImportCreatedProductDto> items =
                result.getContent().stream()
                        .map(
                                product ->
                                        toDto(
                                                product,
                                                sessions.get(product.createdFromPriceImportId),
                                                product.categoryId == null
                                                        ? NO_CATEGORY_NAME
                                                        : categoryNames.get(product.categoryId)))
                        .toList();
        return new PageResult<>(
                items,
                result.getNumber() + 1,
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public List<ImportCreatedProductImportDto> imports() {
        return imports.findAllWithCreatedProducts().stream()
                .map(
                        session ->
                                new ImportCreatedProductImportDto(
                                        session.id,
                                        session.fileName,
                                        completedAt(session),
                                        session.committedCreated == null
                                                ? 0
                                                : session.committedCreated))
                .toList();
    }

    @Transactional(readOnly = true)
    public ImportCreatedProductActivationAnalysisDto analyzeDraftActivation() {
        return analyze(products.findImportCreatedDrafts()).dto();
    }

    @Transactional
    public ImportCreatedProductActivationResultDto activateEligibleDrafts() {
        ActivationAnalysis analysis = analyze(products.findImportCreatedDrafts());
        if (!analysis.eligibleProducts().isEmpty()) {
            analysis.eligibleProducts().forEach(product -> product.active = true);
            List<Product> activated = products.saveAll(analysis.eligibleProducts());
            activated.forEach(searchEmbeddingIndexer::indexProduct);
            auditService.record(
                    "IMPORT_DRAFTS_ACTIVATE",
                    "PRODUCT",
                    null,
                    "Активировал "
                            + activated.size()
                            + " товаров, созданных импортом цен; пропущено "
                            + analysis.dto().skippedProducts().size());
        }
        return new ImportCreatedProductActivationResultDto(
                analysis.eligibleProducts().size(), analysis.dto().skippedProducts());
    }

    private Specification<Product> specification(String search, UUID importId, Boolean active) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(cb.isNull(root.get("deletedAt")));
            predicates.add(cb.isNotNull(root.get("createdFromPriceImportId")));
            if (importId != null) {
                predicates.add(cb.equal(root.get("createdFromPriceImportId"), importId));
            }
            if (active != null) {
                predicates.add(cb.equal(root.get("active"), active));
            }
            List<String> searchVariants = ProductSearchTextNormalizer.rawSearchVariants(search);
            if (!searchVariants.isEmpty()) {
                List<Predicate> matches = new ArrayList<>();
                for (String variant : searchVariants) {
                    String like = "%" + variant + "%";
                    matches.add(
                            cb.or(
                                    cb.like(cb.lower(root.get("sku")), like),
                                    cb.like(cb.lower(root.get("nameRu")), like),
                                    cb.like(cb.lower(root.get("nameKk")), like)));
                }
                predicates.add(cb.or(matches.toArray(Predicate[]::new)));
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
    }

    private Sort resolveSort(String sort, String direction) {
        Sort.Direction sortDirection =
                "asc".equalsIgnoreCase(direction) ? Sort.Direction.ASC : Sort.Direction.DESC;
        String property =
                switch (sort == null ? "" : sort.trim()) {
                    case "sku" -> "sku";
                    case "nameRu" -> "nameRu";
                    case "price" -> "price";
                    case "active" -> "active";
                    default -> "createdAt";
                };
        return Sort.by(new Sort.Order(sortDirection, property)).and(Sort.by(Sort.Order.desc("id")));
    }

    private ImportCreatedProductDto toDto(
            Product product, PriceImportSession session, String categoryName) {
        return new ImportCreatedProductDto(
                product.id,
                product.sku,
                product.nameRu,
                product.price,
                product.wholesalePrice,
                product.bulkWholesalePrice,
                product.skoPrice,
                product.active,
                product.categoryId,
                categoryName,
                product.createdFromPriceImportId,
                session == null ? null : session.fileName,
                session == null ? product.createdAt : completedAt(session));
    }

    private ActivationAnalysis analyze(List<Product> drafts) {
        List<String> excludedNameTerms = excludedNameTerms();
        List<Product> eligibleProducts = new ArrayList<>();
        List<ImportCreatedProductActivationSkipDto> skippedProducts = new ArrayList<>();
        for (Product product : drafts) {
            List<String> reasons = new ArrayList<>();
            String name = product.nameRu == null ? "" : product.nameRu.trim();
            if (name.isBlank()) {
                reasons.add("Не заполнено название");
            } else {
                List<String> matchedTerms = matchingExcludedTerms(name, excludedNameTerms);
                if (!matchedTerms.isEmpty()) {
                    reasons.add("Служебные слова: " + String.join(", ", matchedTerms));
                }
            }
            if (product.price == null || product.price.compareTo(BigDecimal.ZERO) <= 0) {
                reasons.add("Цена не больше 0");
            }
            if (reasons.isEmpty()) {
                eligibleProducts.add(product);
            } else {
                skippedProducts.add(
                        new ImportCreatedProductActivationSkipDto(
                                product.id, product.sku, product.nameRu, List.copyOf(reasons)));
            }
        }
        return new ActivationAnalysis(
                eligibleProducts,
                new ImportCreatedProductActivationAnalysisDto(
                        drafts.size(),
                        eligibleProducts.size(),
                        excludedNameTerms,
                        List.copyOf(skippedProducts)));
    }

    private List<String> excludedNameTerms() {
        LinkedHashSet<String> terms = new LinkedHashSet<>(DEFAULT_EXCLUDED_NAME_TERMS);
        List<String> configuredTerms = settings.priceImportExcludedNameTerms();
        if (configuredTerms != null) {
            configuredTerms.stream()
                    .filter(term -> term != null && !term.isBlank())
                    .map(term -> term.trim().toLowerCase(Locale.ROOT))
                    .forEach(terms::add);
        }
        return List.copyOf(terms);
    }

    private List<String> matchingExcludedTerms(String name, List<String> excludedNameTerms) {
        String normalizedName = name.toLowerCase(Locale.ROOT);
        return excludedNameTerms.stream().filter(normalizedName::contains).toList();
    }

    private Instant completedAt(PriceImportSession session) {
        return session.completedAt == null ? session.createdAt : session.completedAt;
    }

    private String normalize(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return normalized.isBlank() ? null : normalized;
    }

    private record ActivationAnalysis(
            List<Product> eligibleProducts, ImportCreatedProductActivationAnalysisDto dto) {}
}
