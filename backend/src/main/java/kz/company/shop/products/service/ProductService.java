package kz.company.shop.products.service;

import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.JoinType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.categories.service.CategoryService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.productImages.entity.ProductImage;
import kz.company.shop.productImages.repository.ProductImageRepository;
import kz.company.shop.products.dto.ProductAvailabilityRepairApplyRequest;
import kz.company.shop.products.dto.ProductAvailabilityRepairPreviewDto;
import kz.company.shop.products.dto.ProductAvailabilityRepairResultDto;
import kz.company.shop.products.dto.ProductAvailabilityStatusRequest.Status;
import kz.company.shop.products.dto.ProductCatalogAnalyticsDto;
import kz.company.shop.products.dto.ProductActivityChangeDto;
import kz.company.shop.products.dto.ProductDto;
import kz.company.shop.products.dto.ProductImageDto;
import kz.company.shop.products.dto.ProductListParams;
import kz.company.shop.products.dto.ProductPriceAnalyticsCategoryDto;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto;
import kz.company.shop.products.dto.ProductPriceAnalyticsDto.PriceType;
import kz.company.shop.products.dto.ProductPriceAnalyticsFilter;
import kz.company.shop.products.dto.ProductSkuLookupDto;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.search.EmbeddingClient;
import kz.company.shop.search.EmbeddingProperties;
import kz.company.shop.search.HeatingSearchRanker;
import kz.company.shop.search.SearchEmbeddingIndexer;
import kz.company.shop.search.SearchEmbeddingRepository;
import kz.company.shop.settings.service.ProjectSettingsService;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProductService {
    private static final int MIN_PAGE = 1;
    private static final int MIN_SIZE = 1;
    private static final int MAX_SIZE = 200;
    private static final List<String> KEYBOARD_ROWS =
            List.of(
                    "йцукенгшщзхъ",
                    "фывапролджэ",
                    "ячсмитьбю",
                    "qwertyuiop",
                    "asdfghjkl",
                    "zxcvbnm");

    private final ProductRepository repository;
    private final ProductImageRepository imageRepository;
    private final FileStorageService fileStorageService;
    private final CategoryService categoryService;
    private final AuditService auditService;
    private final EmbeddingProperties embeddingProperties;
    private final EmbeddingClient embeddingClient;
    private final SearchEmbeddingRepository searchEmbeddingRepository;
    private final SearchEmbeddingIndexer searchEmbeddingIndexer;
    private final ProjectSettingsService projectSettingsService;
    private final HeatingSearchRanker heatingSearchRanker;
    private final PricingService pricingService;

    public ProductService(
            ProductRepository repository,
            ProductImageRepository imageRepository,
            FileStorageService fileStorageService,
            CategoryService categoryService,
            AuditService auditService,
            EmbeddingProperties embeddingProperties,
            EmbeddingClient embeddingClient,
            SearchEmbeddingRepository searchEmbeddingRepository,
            SearchEmbeddingIndexer searchEmbeddingIndexer,
            ProjectSettingsService projectSettingsService,
            HeatingSearchRanker heatingSearchRanker,
            PricingService pricingService) {
        this.repository = repository;
        this.imageRepository = imageRepository;
        this.fileStorageService = fileStorageService;
        this.categoryService = categoryService;
        this.auditService = auditService;
        this.embeddingProperties = embeddingProperties;
        this.embeddingClient = embeddingClient;
        this.searchEmbeddingRepository = searchEmbeddingRepository;
        this.searchEmbeddingIndexer = searchEmbeddingIndexer;
        this.projectSettingsService = projectSettingsService;
        this.heatingSearchRanker = heatingSearchRanker;
        this.pricingService = pricingService;
    }

    @Transactional
    public PageResult<ProductDto> list(ProductListParams params) {
        return list(params, BigDecimal.ZERO);
    }

    @Transactional
    public PageResult<ProductDto> list(
            ProductListParams params, BigDecimal personalDiscountPercent) {
        int safePage = Math.max(params.page(), MIN_PAGE);
        int safeSize = Math.min(Math.max(params.size(), MIN_SIZE), MAX_SIZE);
        if (params.lexicalOnly() || params.tokenSearch()) {
            return specificationList(params, safePage, safeSize, personalDiscountPercent);
        }
        PageResult<ProductDto> semanticResult =
                semanticList(params, safePage, safeSize, personalDiscountPercent);
        if (semanticResult != null) return semanticResult;
        return specificationList(params, safePage, safeSize, personalDiscountPercent);
    }

    @Transactional(readOnly = true)
    public ProductCatalogAnalyticsDto analytics(ProductListParams params) {
        Specification<Product> matchingProducts = buildSpecification(params);
        return new ProductCatalogAnalyticsDto(
                repository.count(matchingProducts),
                repository.count(matchingProducts.and(withoutCategory())),
                repository.count(matchingProducts.and(matchesActive(true))),
                repository.count(matchingProducts.and(withoutImages())),
                repository.count(matchingProducts.and(withoutIncomingPrice())));
    }

    @Transactional(readOnly = true)
    public PageResult<ProductPriceAnalyticsDto> priceAnalytics(
            int page,
            int size,
            String rawSearch,
            Long categoryId,
            BigDecimal minMarkupPercent,
            BigDecimal maxMarkupPercent,
            Set<PriceType> priceTypes,
            boolean matchAllPriceTypes) {
        if (minMarkupPercent != null
                && maxMarkupPercent != null
                && minMarkupPercent.compareTo(maxMarkupPercent) > 0) {
            throw new AppExceptions.BadRequest(
                    "Минимальный процент не может быть больше максимального");
        }
        int safePage = Math.max(page, MIN_PAGE);
        int safeSize = Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
        String search = normalize(rawSearch);
        if (search == null) search = "";
        Set<PriceType> selectedPriceTypes =
                priceTypes == null || priceTypes.isEmpty()
                        ? EnumSet.allOf(PriceType.class)
                        : EnumSet.copyOf(priceTypes);
        ProductPriceAnalyticsFilter filter =
                new ProductPriceAnalyticsFilter(
                        minMarkupPercent, maxMarkupPercent, selectedPriceTypes, matchAllPriceTypes);
        Page<ProductPriceAnalyticsDto> result =
                repository
                        .findPriceAnalytics(
                                search, categoryId, filter, PageRequest.of(safePage - 1, safeSize))
                        .map(this::toPriceAnalyticsDto);
        return new PageResult<>(
                result.getContent(),
                result.getNumber() + 1,
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public List<ProductPriceAnalyticsCategoryDto> priceAnalyticsByCategory() {
        return repository.priceAnalyticsByCategory().stream()
                .map(this::toPriceAnalyticsCategoryDto)
                .toList();
    }

    private PageResult<ProductDto> specificationList(
            ProductListParams params,
            int safePage,
            int safeSize,
            BigDecimal personalDiscountPercent) {
        Specification<Product> specification = buildSpecification(params);
        boolean prioritizeExactWord = shouldPrioritizeExactWord(params);
        if (prioritizeExactWord) {
            specification = specification.and(prioritizeExactWord(params.search()));
        }
        PageRequest pageable =
                PageRequest.of(
                        safePage - 1,
                        safeSize,
                        prioritizeExactWord
                                ? Sort.unsorted()
                                : resolveSort(params.sort(), params.direction()));
        Page<ProductDto> result =
                repository
                        .findAll(specification, pageable)
                        .map(
                                product ->
                                        toDto(
                                                product,
                                                params.includeInternalPrices(),
                                                personalDiscountPercent));
        return new PageResult<>(
                result.getContent(),
                result.getNumber() + 1,
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    /**
     * For a one-word catalogue query, show products where that word is whole before partial
     * matches. For example, "Лен сантехнический" precedes names that merely contain "лен".
     */
    private boolean shouldPrioritizeExactWord(ProductListParams params) {
        return params.lexicalOnly()
                && searchTokens(params.search()).size() == 1
                && "nameRu".equals(normalizeSort(params.sort()))
                && !"desc".equalsIgnoreCase(params.direction());
    }

    private Specification<Product> prioritizeExactWord(String rawSearch) {
        String word = searchTokens(rawSearch).getFirst();
        return (root, query, cb) -> {
            // Count queries cannot have ORDER BY.
            if (!Long.class.equals(query.getResultType())) {
                var name = normalizedSearchExpression(cb, root.<String>get("nameRu"));
                var sku = normalizedSearchExpression(cb, root.<String>get("sku"));
                var spacedName = cb.concat(cb.concat(" ", name), " ");
                var rank =
                        cb.<Integer>selectCase()
                                .when(cb.or(cb.equal(name, word), cb.equal(sku, word)), 0)
                                .when(
                                        cb.or(
                                                cb.like(name, word + " %"),
                                                cb.like(sku, word + "%"),
                                                cb.like(spacedName, "% " + word + " %")),
                                        1)
                                .otherwise(2);
                query.orderBy(cb.asc(rank), cb.asc(name), cb.asc(root.get("id")));
            }
            return cb.conjunction();
        };
    }

    private PageResult<ProductDto> semanticList(
            ProductListParams params,
            int safePage,
            int safeSize,
            BigDecimal personalDiscountPercent) {
        String search = normalize(params.search());
        if (search == null || looksLikeExactSku(search) || looksLikeKeyboardMash(search))
            return null;
        if (!embeddingProperties.isEnabled() || !projectSettingsService.searchAiEnabled())
            return null;
        return embeddingClient
                .embedQuery(search)
                .map(
                        vector -> {
                            long total =
                                    searchEmbeddingRepository.countSemanticProducts(
                                            params,
                                            embeddingProperties.getModel(),
                                            vector,
                                            embeddingProperties.getSearchMaxDistance());
                            if (total == 0) return null;
                            int candidateLimit =
                                    safePage == 1
                                            ? Math.min(Math.max(safeSize * 10, 50), 100)
                                            : safeSize;
                            int candidateOffset = safePage == 1 ? 0 : (safePage - 1) * safeSize;
                            List<SearchEmbeddingRepository.ProductSearchRow> rows =
                                    searchEmbeddingRepository.searchProducts(
                                            params,
                                            embeddingProperties.getModel(),
                                            vector,
                                            embeddingProperties.getSearchMaxDistance(),
                                            candidateLimit,
                                            candidateOffset);
                            if (rows.isEmpty()) return null;

                            Map<Long, Integer> order = new LinkedHashMap<>();
                            for (int index = 0; index < rows.size(); index++) {
                                order.put(rows.get(index).productId(), index);
                            }
                            for (Long productId :
                                    searchEmbeddingRepository.searchProductsByNameTerms(
                                            params,
                                            heatingSearchRanker.candidateTerms(search),
                                            candidateLimit)) {
                                order.putIfAbsent(productId, order.size());
                            }
                            List<ProductDto> items =
                                    repository.findAllById(order.keySet()).stream()
                                            .filter(product -> product.deletedAt == null)
                                            .sorted(
                                                    Comparator.comparingInt(
                                                                    (Product product) ->
                                                                            heatingSearchRanker
                                                                                    .score(
                                                                                            search,
                                                                                            product))
                                                            .reversed()
                                                            .thenComparingDouble(
                                                                    (Product product) ->
                                                                            fuzzySearchScore(
                                                                                    search,
                                                                                    product))
                                                            .reversed()
                                                            .thenComparingInt(
                                                                    product ->
                                                                            order.getOrDefault(
                                                                                    product.id,
                                                                                    Integer
                                                                                            .MAX_VALUE)))
                                            .limit(safeSize)
                                            .map(
                                                    product ->
                                                            toDto(
                                                                    product,
                                                                    params.includeInternalPrices(),
                                                                    personalDiscountPercent))
                                            .toList();
                            int totalPages =
                                    (int) Math.max(1, Math.ceil((double) total / safeSize));
                            return new PageResult<>(items, safePage, safeSize, total, totalPages);
                        })
                .orElse(null);
    }

    public Map<Long, Long> countByCategory() {
        Map<Long, Long> counts = new LinkedHashMap<>();
        for (Object[] row : repository.countByCategoryId()) {
            if (row.length < 2 || row[0] == null || row[1] == null) continue;
            counts.put(((Number) row[0]).longValue(), ((Number) row[1]).longValue());
        }
        return counts;
    }

    @Transactional(readOnly = true)
    public List<ProductAvailabilityRepairPreviewDto> previewAvailabilityRepair(
            List<String> rawKeywords) {
        List<AvailabilityRepairKeyword> keywords = availabilityRepairKeywords(rawKeywords);
        return repository.findByDeletedAtIsNullOrderByNameRuAsc().stream()
                .filter(product -> hasAvailabilityRepairMarker(product, keywords))
                .map(product -> availabilityRepairPreview(product, keywords))
                .toList();
    }

    @Transactional
    public ProductAvailabilityRepairResultDto applyAvailabilityRepair(
            ProductAvailabilityRepairApplyRequest request) {
        List<AvailabilityRepairKeyword> keywords = availabilityRepairKeywords(request.keywords());
        Set<Long> requestedIds = new LinkedHashSet<>(request.productIds());
        if (requestedIds.isEmpty()) return new ProductAvailabilityRepairResultDto(0, 0);

        Map<Long, Product> productsById = new LinkedHashMap<>();
        repository
                .findByIdInAndDeletedAtIsNull(requestedIds)
                .forEach(product -> productsById.put(product.id, product));

        List<Product> updated = new ArrayList<>();
        for (Long productId : requestedIds) {
            Product product = productsById.get(productId);
            if (product == null || !hasAvailabilityRepairMarker(product, keywords)) continue;

            product.nameRu = cleanAvailabilityRepairMarkers(product.nameRu, keywords);
            product.active = true;
            product.madeToOrder = true;
            updated.add(product);
        }

        for (Product product : repository.saveAll(updated)) {
            searchEmbeddingIndexer.indexProduct(product);
            auditService.record(
                    "UPDATE",
                    "PRODUCT",
                    product.id,
                    "Перевёл товар «"
                            + product.nameRu
                            + "» в статус «Под заказ»");
        }
        return new ProductAvailabilityRepairResultDto(
                updated.size(), requestedIds.size() - updated.size());
    }

    public Map<String, ProductSkuLookupDto> findBySkus(List<String> rawSkus) {
        Set<String> skus = new LinkedHashSet<>();
        for (String rawSku : rawSkus) {
            if (rawSku == null) continue;
            String sku = rawSku.trim();
            if (!sku.isEmpty()) skus.add(sku);
        }
        if (skus.isEmpty()) return Map.of();

        Map<String, ProductSkuLookupDto> products = new LinkedHashMap<>();
        repository
                .findBySkuInAndDeletedAtIsNull(skus)
                .forEach(
                        product -> {
                            products.put(
                                    product.sku,
                                    new ProductSkuLookupDto(product.id, product.nameRu));
                        });
        return products;
    }

    public Product getEntity(Long id) {
        return repository
                .findByIdAndDeletedAtIsNull(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Товар не найден"));
    }

    @Transactional
    public ProductDto get(Long id) {
        return toDto(getEntity(id), true, BigDecimal.ZERO);
    }

    @Transactional
    public ProductDto getPublic(Long id) {
        return getPublic(id, BigDecimal.ZERO);
    }

    @Transactional
    public ProductDto getPublic(Long id, BigDecimal personalDiscountPercent) {
        Product product = getEntity(id);
        if (!product.active) throw new AppExceptions.NotFound("Товар не найден");
        return toDto(product, false, personalDiscountPercent);
    }

    @Transactional
    public ProductDto create(ProductDto dto) {
        if (repository.existsBySku(dto.sku()))
            throw new AppExceptions.BadRequest("Артикул уже используется");
        Product product = new Product();
        apply(product, dto);
        Product saved = repository.save(product);
        searchEmbeddingIndexer.indexProduct(saved);
        auditService.record("CREATE", "PRODUCT", saved.id, "Создал товар «" + saved.nameRu + "»");
        return toDto(saved, true, BigDecimal.ZERO);
    }

    @Transactional
    public ProductDto update(Long id, ProductDto dto) {
        Product product = getEntity(id);
        ProductAuditState previous = productAuditState(product);
        repository
                .findBySkuAndDeletedAtIsNull(dto.sku())
                .filter(existing -> !existing.id.equals(id))
                .ifPresent(
                        existing -> {
                            throw new AppExceptions.BadRequest("Артикул уже используется");
                        });
        apply(product, dto);
        Product saved = repository.save(product);
        searchEmbeddingIndexer.indexProduct(saved);
        List<ProductActivityChangeDto> changes = productAuditChanges(previous, saved);
        auditService.record(
                "UPDATE",
                "PRODUCT",
                saved.id,
                productUpdateDescription(saved, changes),
                changes);
        return toDto(saved, true, BigDecimal.ZERO);
    }

    @Transactional
    public ProductDto updateAvailabilityStatus(Long id, Status status) {
        Product product = getEntity(id);
        switch (status) {
            case HIDDEN -> {
                product.active = false;
                product.madeToOrder = false;
                product.deliveryDaysFrom = null;
                product.deliveryDaysTo = null;
            }
            case MADE_TO_ORDER -> {
                product.active = true;
                product.madeToOrder = true;
            }
            case AVAILABLE -> {
                product.active = true;
                product.madeToOrder = false;
                product.deliveryDaysFrom = null;
                product.deliveryDaysTo = null;
            }
        }
        Product saved = repository.save(product);
        auditService.record(
                "UPDATE",
                "PRODUCT",
                saved.id,
                "Изменил доступность товара «"
                        + saved.nameRu
                        + "» на «"
                        + availabilityStatusLabel(status)
                        + "»");
        return toDto(saved, true, BigDecimal.ZERO);
    }

    @Transactional
    public void delete(Long id) {
        Product product = getEntity(id);
        product.deletedAt = Instant.now();
        repository.save(product);
        auditService.record(
                "DELETE", "PRODUCT", product.id, "Удалил товар «" + product.nameRu + "»");
    }

    private String availabilityStatusLabel(Status status) {
        return switch (status) {
            case HIDDEN -> "Скрыт";
            case MADE_TO_ORDER -> "Под заказ";
            case AVAILABLE -> "В наличии";
        };
    }

    public ProductImageDto imageDto(ProductImage image) {
        return new ProductImageDto(
                image.id,
                image.fileName,
                image.originalFileName,
                image.filePath,
                imageContentHash(image),
                image.sortOrder,
                image.mainImage);
    }

    /**
     * Removes stale database references to files that have already disappeared from object storage.
     * A missing legacy image must not make the whole product catalogue unavailable.
     */
    private List<ProductImageDto> imageDtos(Product product) {
        List<ProductImage> images = imageRepository.findByProductIdOrderBySortOrderAsc(product.id);
        List<ProductImage> staleImages = new ArrayList<>();
        List<ProductImageDto> result = new ArrayList<>();

        for (ProductImage image : images) {
            ProductImageDto dto = imageDto(image);
            if (dto.contentHash() == null) {
                staleImages.add(image);
                continue;
            }
            result.add(dto);
        }

        if (!staleImages.isEmpty()) {
            boolean mainImageWasRemoved = staleImages.stream().anyMatch(image -> image.mainImage);
            imageRepository.deleteAll(staleImages);

            List<ProductImage> remaining =
                    images.stream().filter(image -> !staleImages.contains(image)).toList();
            if (mainImageWasRemoved && !remaining.isEmpty()) {
                remaining.getFirst().mainImage = true;
                imageRepository.saveAll(remaining);
                return remaining.stream().map(this::imageDto).toList();
            }
        }

        return result;
    }

    private Specification<Product> buildSpecification(ProductListParams params) {
        return Specification.where(notDeleted())
                .and(
                        params.tokenSearch()
                                ? matchesSearchTokens(params.search())
                                : matchesSearch(params.search()))
                .and(matchesCategory(params.category()))
                .and(matchesMinPrice(params.minPrice()))
                .and(matchesMaxPrice(params.maxPrice()))
                .and(matchesStock(params.inStock()))
                .and(matchesActive(params.active()))
                .and(excludesImportCreated(params.excludeImportCreated()))
                .and(matchesMissingIncomingPrice(params.missingIncomingPrice()));
    }

    private Specification<Product> notDeleted() {
        return (root, query, cb) -> cb.isNull(root.get("deletedAt"));
    }

    private Specification<Product> withoutCategory() {
        return (root, query, cb) -> cb.isNull(root.get("categoryId"));
    }

    private Specification<Product> withoutIncomingPrice() {
        return (root, query, cb) -> cb.isNull(root.get("incomingPrice"));
    }

    private Specification<Product> matchesMissingIncomingPrice(boolean missingIncomingPrice) {
        return missingIncomingPrice ? withoutIncomingPrice() : null;
    }

    private Specification<Product> withoutImages() {
        return (root, query, cb) -> {
            var images = query.subquery(Long.class);
            var image = images.from(kz.company.shop.productImages.entity.ProductImage.class);
            images.select(image.get("id"))
                    .where(cb.equal(image.get("product").get("id"), root.get("id")));
            return cb.not(cb.exists(images));
        };
    }

    private Specification<Product> matchesSearch(String rawSearch) {
        List<String> variants = searchVariants(rawSearch);
        if (variants.isEmpty()) return null;
        return (root, query, cb) -> {
            var category = root.join("category", JoinType.LEFT);
            return cb.or(
                    matchesNormalizedSearch(cb, root.<String>get("sku"), variants),
                    matchesNormalizedSearch(cb, root.<String>get("nameRu"), variants),
                    matchesNormalizedSearch(cb, root.<String>get("nameKk"), variants),
                    matchesNormalizedSearch(
                            cb, cb.coalesce(root.<String>get("shortDescriptionRu"), ""), variants),
                    matchesNormalizedSearch(
                            cb, cb.coalesce(root.<String>get("shortDescriptionKk"), ""), variants),
                    matchesNormalizedSearch(
                            cb, cb.coalesce(root.<String>get("descriptionRu"), ""), variants),
                    matchesNormalizedSearch(
                            cb, cb.coalesce(root.<String>get("descriptionKk"), ""), variants),
                    matchesNormalizedSearch(
                            cb, cb.coalesce(category.<String>get("nameRu"), ""), variants),
                    matchesNormalizedSearch(
                            cb, cb.coalesce(category.<String>get("nameKk"), ""), variants));
        };
    }

    /**
     * The admin catalogue searches every entered term independently. This makes technical
     * dimensions searchable regardless of their delimiter: 150 210, 150/210, and 150-210.
     */
    private Specification<Product> matchesSearchTokens(String rawSearch) {
        List<List<String>> tokenVariants = searchTokenVariants(rawSearch);
        if (tokenVariants.isEmpty()) return null;

        return (root, query, cb) -> {
            var category = root.join("category", JoinType.LEFT);
            List<jakarta.persistence.criteria.Predicate> tokenPredicates = new ArrayList<>();
            for (List<String> variants : tokenVariants) {
                tokenPredicates.add(
                        cb.or(
                                matchesNormalizedSearch(cb, root.<String>get("sku"), variants),
                                matchesNormalizedSearch(cb, root.<String>get("nameRu"), variants),
                                matchesNormalizedSearch(cb, root.<String>get("nameKk"), variants),
                                matchesNormalizedSearch(
                                        cb,
                                        cb.coalesce(root.<String>get("shortDescriptionRu"), ""),
                                        variants),
                                matchesNormalizedSearch(
                                        cb,
                                        cb.coalesce(root.<String>get("shortDescriptionKk"), ""),
                                        variants),
                                matchesNormalizedSearch(
                                        cb,
                                        cb.coalesce(root.<String>get("descriptionRu"), ""),
                                        variants),
                                matchesNormalizedSearch(
                                        cb,
                                        cb.coalesce(root.<String>get("descriptionKk"), ""),
                                        variants),
                                matchesNormalizedSearch(
                                        cb,
                                        cb.coalesce(category.<String>get("nameRu"), ""),
                                        variants),
                                matchesNormalizedSearch(
                                        cb,
                                        cb.coalesce(category.<String>get("nameKk"), ""),
                                        variants)));
            }
            return cb.and(tokenPredicates.toArray(jakarta.persistence.criteria.Predicate[]::new));
        };
    }

    private Specification<Product> matchesCategory(String category) {
        String normalizedCategory = category == null ? null : category.trim();
        if (normalizedCategory == null || normalizedCategory.isBlank()) return null;
        return (root, query, cb) -> {
            var categoryJoin = root.join("category", JoinType.LEFT);
            try {
                Long categoryId = Long.parseLong(normalizedCategory);
                return cb.equal(root.get("categoryId"), categoryId);
            } catch (NumberFormatException ignored) {
                return cb.equal(
                        cb.lower(categoryJoin.get("slug")),
                        normalizedCategory.toLowerCase(Locale.ROOT));
            }
        };
    }

    private Specification<Product> matchesMinPrice(BigDecimal minPrice) {
        if (minPrice == null) return null;
        return (root, query, cb) -> cb.greaterThanOrEqualTo(root.get("price"), minPrice);
    }

    private Specification<Product> matchesMaxPrice(BigDecimal maxPrice) {
        if (maxPrice == null) return null;
        return (root, query, cb) -> cb.lessThanOrEqualTo(root.get("price"), maxPrice);
    }

    private Specification<Product> matchesStock(Boolean inStock) {
        if (!Boolean.TRUE.equals(inStock)) return null;
        return (root, query, cb) -> cb.isTrue(root.get("active"));
    }

    private Specification<Product> matchesActive(Boolean active) {
        if (active == null) return null;
        return (root, query, cb) ->
                active ? cb.isTrue(root.get("active")) : cb.isFalse(root.get("active"));
    }

    private Specification<Product> excludesImportCreated(Boolean excludeImportCreated) {
        if (!Boolean.TRUE.equals(excludeImportCreated)) return null;
        return (root, query, cb) ->
                cb.or(
                        cb.isNull(root.get("createdFromPriceImportId")),
                        cb.isTrue(root.get("active")));
    }

    private Sort resolveSort(String sort, String direction) {
        String normalizedSort = normalizeSort(sort);
        Sort.Direction sortDirection =
                "desc".equalsIgnoreCase(direction) ? Sort.Direction.DESC : Sort.Direction.ASC;
        Sort resolved =
                switch (normalizedSort) {
                    case "price" -> Sort.by(new Sort.Order(sortDirection, "price"));
                    case "nameRu" -> Sort.by(new Sort.Order(sortDirection, "nameRu").ignoreCase());
                    case "sku" -> Sort.by(new Sort.Order(sortDirection, "sku").ignoreCase());
                    case "active" -> Sort.by(new Sort.Order(sortDirection, "active"));
                    case "categoryNameRu" ->
                            Sort.by(new Sort.Order(sortDirection, "category.nameRu").ignoreCase())
                                    .and(
                                            Sort.by(
                                                    new Sort.Order(Sort.Direction.ASC, "nameRu")
                                                            .ignoreCase()));
                    case "popular" ->
                            Sort.by(new Sort.Order(Sort.Direction.DESC, "active"))
                                    .and(Sort.by(new Sort.Order(Sort.Direction.DESC, "createdAt")));
                    case "createdAt" -> Sort.by(new Sort.Order(sortDirection, "createdAt"));
                    default ->
                            Sort.by(new Sort.Order(Sort.Direction.DESC, "createdAt"))
                                    .and(
                                            Sort.by(
                                                    new Sort.Order(Sort.Direction.ASC, "nameRu")
                                                            .ignoreCase()));
                };
        return resolved.and(Sort.by(Sort.Direction.ASC, "id"));
    }

    private String normalizeSort(String sort) {
        if (sort == null || sort.isBlank()) return "createdAt";
        return sort.trim();
    }

    private String normalize(String value) {
        if (value == null) return null;
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return normalized.isBlank() ? null : normalized;
    }

    private String normalizeSearch(String value) {
        return ProductSearchTextNormalizer.normalize(value);
    }

    private jakarta.persistence.criteria.Predicate matchesNormalizedSearch(
            CriteriaBuilder cb, Expression<String> value, List<String> variants) {
        Expression<String> normalizedValue = normalizedSearchExpression(cb, value);
        return cb.or(
                variants.stream()
                        .map(variant -> cb.like(normalizedValue, "%" + variant + "%"))
                        .toArray(jakarta.persistence.criteria.Predicate[]::new));
    }

    private Expression<String> normalizedSearchExpression(
            CriteriaBuilder cb, Expression<String> value) {
        return cb.function(
                "translate",
                String.class,
                cb.lower(value),
                cb.literal(ProductSearchTextNormalizer.CYRILLIC_HOMOGLYPHS),
                cb.literal(ProductSearchTextNormalizer.LATIN_HOMOGLYPHS));
    }

    private List<String> searchVariants(String value) {
        return ProductSearchTextNormalizer.searchVariants(value);
    }

    private List<List<String>> searchTokenVariants(String value) {
        String normalized = normalize(value);
        if (normalized == null) return List.of();
        return Arrays.stream(normalized.split("[^\\p{L}\\p{N}]+"))
                .filter(token -> !token.isBlank())
                .map(this::searchVariants)
                .filter(variants -> !variants.isEmpty())
                .toList();
    }

    private List<String> searchTokens(String value) {
        String normalized = normalizeSearch(value);
        if (normalized == null) return List.of();
        return Arrays.stream(normalized.split("[^\\p{L}\\p{N}]+"))
                .filter(token -> !token.isBlank())
                .distinct()
                .toList();
    }

    private boolean looksLikeExactSku(String search) {
        return search.matches("(?=.*\\d)[a-z0-9][a-z0-9._/-]{0,47}");
    }

    private boolean looksLikeKeyboardMash(String search) {
        for (String word : search.split("[^\\p{L}]+")) {
            if (word.length() < 4) continue;
            if (word.matches("(.)\\1{3,}")) return true;
            for (String row : KEYBOARD_ROWS) {
                for (int start = 0; start <= word.length() - 4; start++) {
                    if (row.contains(word.substring(start, start + 4))) return true;
                }
            }
        }
        return false;
    }

    private double fuzzySearchScore(String query, Product product) {
        List<String> queryWords = searchWords(query);
        if (queryWords.isEmpty()) return 0;
        List<String> productWords =
                searchWords(String.join(" ", product.nameRu, product.nameKk, product.sku));
        if (productWords.isEmpty()) return 0;

        double sum = 0;
        for (String queryWord : queryWords) {
            double best = 0;
            for (String productWord : productWords) {
                best = Math.max(best, wordSimilarity(queryWord, productWord));
            }
            if (best < 0.72) return 0;
            sum += best;
        }
        return sum / queryWords.size();
    }

    private List<String> searchWords(String text) {
        String normalized = normalizeSearch(text);
        if (normalized == null) return List.of();
        return List.of(normalized.split("[^\\p{L}\\p{N}]+")).stream()
                .map(word -> word.replaceAll("(\\p{L})\\1+", "$1"))
                .filter(word -> word.length() >= 3)
                .toList();
    }

    private double wordSimilarity(String left, String right) {
        int maxLength = Math.max(left.length(), right.length());
        if (maxLength == 0) return 0;
        return 1 - (double) levenshteinDistance(left, right) / maxLength;
    }

    private int levenshteinDistance(String left, String right) {
        int[] previous = new int[right.length() + 1];
        int[] current = new int[right.length() + 1];
        for (int index = 0; index <= right.length(); index++) previous[index] = index;
        for (int leftIndex = 1; leftIndex <= left.length(); leftIndex++) {
            current[0] = leftIndex;
            for (int rightIndex = 1; rightIndex <= right.length(); rightIndex++) {
                int substitution =
                        previous[rightIndex - 1]
                                + (left.charAt(leftIndex - 1) == right.charAt(rightIndex - 1)
                                        ? 0
                                        : 1);
                current[rightIndex] =
                        Math.min(
                                Math.min(previous[rightIndex] + 1, current[rightIndex - 1] + 1),
                                substitution);
            }
            int[] swap = previous;
            previous = current;
            current = swap;
        }
        return previous[right.length()];
    }

    private ProductDto toDto(
            Product product, boolean includeInternalPrices, BigDecimal personalDiscountPercent) {
        boolean hasPersonalDiscount =
                !includeInternalPrices
                        && personalDiscountPercent != null
                        && personalDiscountPercent.compareTo(BigDecimal.ZERO) > 0;
        BigDecimal displayedPrice =
                hasPersonalDiscount
                        ? pricingService.discountedRetailPrice(
                                product.price, personalDiscountPercent)
                        : product.price;
        return new ProductDto(
                product.id,
                product.sku,
                product.nameRu,
                product.nameKk,
                product.shortDescriptionRu,
                product.shortDescriptionKk,
                product.descriptionRu,
                product.descriptionKk,
                displayedPrice,
                product.wholesalePrice,
                product.bulkWholesalePrice,
                includeInternalPrices ? product.skoPrice : null,
                includeInternalPrices ? product.gskoPrice : null,
                product.categoryId,
                categoryService.nameRu(product.categoryId),
                product.active,
                product.madeToOrder,
                product.deliveryDaysFrom,
                product.deliveryDaysTo,
                imageDtos(product),
                hasPersonalDiscount ? product.price : null,
                hasPersonalDiscount ? personalDiscountPercent : null,
                includeInternalPrices ? product.incomingPrice : null);
    }

    private ProductPriceAnalyticsDto toPriceAnalyticsDto(Product product) {
        BigDecimal incomingPrice = product.incomingPrice;
        List<ProductPriceAnalyticsDto.PriceLevel> priceLevels =
                List.of(
                        priceLevel(PriceType.RETAIL, product.price, incomingPrice),
                        priceLevel(PriceType.WHOLESALE, product.wholesalePrice, incomingPrice),
                        priceLevel(
                                PriceType.BULK_WHOLESALE,
                                product.bulkWholesalePrice,
                                incomingPrice),
                        priceLevel(PriceType.SKO, product.skoPrice, incomingPrice));
        boolean hasPriceBelowIncoming =
                priceLevels.stream().anyMatch(ProductPriceAnalyticsDto.PriceLevel::belowIncoming);
        return new ProductPriceAnalyticsDto(
                product.id,
                product.sku,
                product.nameRu,
                categoryService.nameRu(product.categoryId),
                product.active,
                incomingPrice,
                priceLevels,
                hasPriceBelowIncoming);
    }

    private ProductPriceAnalyticsCategoryDto toPriceAnalyticsCategoryDto(Object[] row) {
        return new ProductPriceAnalyticsCategoryDto(
                number(row[0]) == null ? null : number(row[0]).longValue(),
                String.valueOf(row[1]),
                number(row[2]).longValue(),
                List.of(
                        priceLevelSummary(PriceType.RETAIL, row, 3),
                        priceLevelSummary(PriceType.WHOLESALE, row, 7),
                        priceLevelSummary(PriceType.BULK_WHOLESALE, row, 11),
                        priceLevelSummary(PriceType.SKO, row, 15)));
    }

    private ProductPriceAnalyticsCategoryDto.PriceLevelSummary priceLevelSummary(
            PriceType type, Object[] row, int index) {
        return new ProductPriceAnalyticsCategoryDto.PriceLevelSummary(
                type,
                number(row[index]).longValue(),
                decimal(row[index + 1]),
                decimal(row[index + 2]),
                decimal(row[index + 3]));
    }

    private Number number(Object value) {
        return value instanceof Number number ? number : null;
    }

    private BigDecimal decimal(Object value) {
        return value instanceof BigDecimal decimal
                ? decimal
                : value instanceof Number number ? BigDecimal.valueOf(number.doubleValue()) : null;
    }

    private ProductPriceAnalyticsDto.PriceLevel priceLevel(
            PriceType type, BigDecimal price, BigDecimal incomingPrice) {
        boolean belowIncoming =
                price != null && incomingPrice != null && price.compareTo(incomingPrice) < 0;
        BigDecimal markupPercent =
                price == null || incomingPrice == null || incomingPrice.signum() == 0
                        ? null
                        : price.subtract(incomingPrice)
                                .multiply(BigDecimal.valueOf(100))
                                .divide(incomingPrice, 2, java.math.RoundingMode.HALF_UP);
        return new ProductPriceAnalyticsDto.PriceLevel(type, price, markupPercent, belowIncoming);
    }

    private String imageContentHash(ProductImage image) {
        if (image.contentHash == null || image.contentHash.isBlank()) {
            try {
                image.contentHash = fileStorageService.contentHash(image.fileName);
            } catch (AppExceptions.NotFound ignored) {
                return null;
            }
        }
        return image.contentHash;
    }

    private boolean hasAvailabilityRepairMarker(
            Product product, List<AvailabilityRepairKeyword> keywords) {
        return product.nameRu != null
                && !matchingAvailabilityRepairKeywords(product.nameRu, keywords).isEmpty()
                && !cleanAvailabilityRepairMarkers(product.nameRu, keywords).isBlank();
    }

    private ProductAvailabilityRepairPreviewDto availabilityRepairPreview(
            Product product, List<AvailabilityRepairKeyword> keywords) {
        return new ProductAvailabilityRepairPreviewDto(
                product.id,
                product.sku,
                product.nameRu,
                cleanAvailabilityRepairMarkers(product.nameRu, keywords),
                product.active,
                product.madeToOrder,
                matchingAvailabilityRepairKeywords(product.nameRu, keywords));
    }

    private List<AvailabilityRepairKeyword> availabilityRepairKeywords(List<String> rawKeywords) {
        List<AvailabilityRepairKeyword> keywords = new ArrayList<>();
        for (String rawKeyword : rawKeywords) {
            if (rawKeyword == null) continue;
            for (String value : rawKeyword.split("[\\n,]+")) {
                String keyword = value.trim();
                if (keyword.isEmpty()
                        || keywords.stream()
                                .anyMatch(item -> item.value().equalsIgnoreCase(keyword))) continue;
                String expression =
                        String.join(
                                "\\s+",
                                Arrays.stream(keyword.split("\\s+")).map(Pattern::quote).toList());
                keywords.add(
                        new AvailabilityRepairKeyword(
                                keyword,
                                Pattern.compile(
                                        "(?iu)(?<![\\p{L}\\p{N}])"
                                                + expression
                                                + "(?![\\p{L}\\p{N}])[\\s:—–-]*")));
            }
        }
        if (keywords.isEmpty())
            throw new AppExceptions.BadRequest("Укажите хотя бы одно ключевое слово для анализа");
        return keywords;
    }

    private List<String> matchingAvailabilityRepairKeywords(
            String value, List<AvailabilityRepairKeyword> keywords) {
        return keywords.stream()
                .filter(keyword -> keyword.pattern().matcher(value).find())
                .map(AvailabilityRepairKeyword::value)
                .toList();
    }

    private String cleanAvailabilityRepairMarkers(
            String value, List<AvailabilityRepairKeyword> keywords) {
        String cleaned = value;
        for (AvailabilityRepairKeyword keyword : keywords) {
            cleaned = keyword.pattern().matcher(cleaned).replaceAll("");
        }
        return cleaned.replaceAll("\\s{2,}", " ").trim();
    }

    private record AvailabilityRepairKeyword(String value, Pattern pattern) {}

    private void apply(Product product, ProductDto dto) {
        if (dto.price().compareTo(BigDecimal.ZERO) <= 0)
            throw new AppExceptions.BadRequest("Основная цена обязательна");
        product.sku = dto.sku();
        product.nameRu = dto.nameRu();
        product.nameKk = dto.nameKk();
        product.shortDescriptionRu = dto.shortDescriptionRu();
        product.shortDescriptionKk = dto.shortDescriptionKk();
        product.descriptionRu = dto.descriptionRu();
        product.descriptionKk = dto.descriptionKk();
        product.price = dto.price();
        product.wholesalePrice = dto.wholesalePrice();
        product.bulkWholesalePrice = dto.bulkWholesalePrice();
        product.skoPrice = dto.skoPrice();
        product.gskoPrice = dto.gskoPrice();
        validateOptionalPrice("Приходная цена", dto.incomingPrice());
        product.incomingPrice = dto.incomingPrice();
        product.categoryId =
                dto.categoryId() == null ? null : categoryService.getEntity(dto.categoryId()).id;
        product.active = dto.active();
        if ((dto.deliveryDaysFrom() != null && dto.deliveryDaysFrom() < 1)
                || (dto.deliveryDaysTo() != null && dto.deliveryDaysTo() < 1)) {
            throw new AppExceptions.BadRequest("Срок доставки должен быть не меньше одного дня");
        }
        if (dto.deliveryDaysFrom() != null
                && dto.deliveryDaysTo() != null
                && dto.deliveryDaysFrom() > dto.deliveryDaysTo()) {
            throw new AppExceptions.BadRequest(
                    "Срок доставки «от» не может быть больше срока «до»");
        }
        product.madeToOrder = dto.madeToOrder();
        product.deliveryDaysFrom = dto.madeToOrder() ? dto.deliveryDaysFrom() : null;
        product.deliveryDaysTo = dto.madeToOrder() ? dto.deliveryDaysTo() : null;
    }

    private void validateOptionalPrice(String label, BigDecimal value) {
        if (value != null && value.compareTo(BigDecimal.ZERO) <= 0) {
            throw new AppExceptions.BadRequest(label + " должна быть больше нуля");
        }
    }

    /**
     * Audit logs created before this change contain only a generic update description. For new
     * edits, retain the card fields that staff need to recognise directly in the history table.
     */
    private ProductAuditState productAuditState(Product product) {
        return new ProductAuditState(
                product.sku,
                product.nameRu,
                product.nameKk,
                product.shortDescriptionRu,
                product.shortDescriptionKk,
                product.descriptionRu,
                product.descriptionKk,
                product.price,
                product.wholesalePrice,
                product.bulkWholesalePrice,
                product.skoPrice,
                product.gskoPrice,
                product.incomingPrice,
                categoryService.nameRu(product.categoryId),
                availabilityLabel(product),
                deliveryLabel(product));
    }

    private List<ProductActivityChangeDto> productAuditChanges(
            ProductAuditState previous, Product current) {
        List<ProductActivityChangeDto> changes = new ArrayList<>();
        appendChange(changes, "Артикул", previous.sku(), current.sku);
        appendChange(changes, "Название RU", previous.nameRu(), current.nameRu);
        appendChange(changes, "Название KZ", previous.nameKk(), current.nameKk);
        appendChange(changes, "Краткое описание RU", previous.shortDescriptionRu(), current.shortDescriptionRu);
        appendChange(changes, "Краткое описание KZ", previous.shortDescriptionKk(), current.shortDescriptionKk);
        appendChange(changes, "Описание RU", previous.descriptionRu(), current.descriptionRu);
        appendChange(changes, "Описание KZ", previous.descriptionKk(), current.descriptionKk);
        appendChange(changes, "Розничная цена", money(previous.price()), money(current.price));
        appendChange(changes, "Оптовая цена", money(previous.wholesalePrice()), money(current.wholesalePrice));
        appendChange(changes, "Крупный опт", money(previous.bulkWholesalePrice()), money(current.bulkWholesalePrice));
        appendChange(changes, "Цена СКО", money(previous.skoPrice()), money(current.skoPrice));
        appendChange(changes, "Цена ГСКО", money(previous.gskoPrice()), money(current.gskoPrice));
        appendChange(changes, "Приходная цена", money(previous.incomingPrice()), money(current.incomingPrice));
        appendChange(changes, "Категория", previous.categoryName(), categoryService.nameRu(current.categoryId));
        appendChange(changes, "Доступность", previous.availability(), availabilityLabel(current));
        appendChange(changes, "Срок доставки", previous.delivery(), deliveryLabel(current));
        return changes;
    }

    private String productUpdateDescription(Product current, List<ProductActivityChangeDto> changes) {
        String description = changes.isEmpty()
                ? "Обновил товар «" + current.nameRu + "»"
                : "Изменил товар «" + current.nameRu + "»";
        return description.length() <= 500 ? description : description.substring(0, 497) + "…";
    }

    private void appendChange(
            List<ProductActivityChangeDto> changes, String field, String previous, String current) {
        if (!Objects.equals(previous, current)) {
            changes.add(new ProductActivityChangeDto(field, compactAuditValue(previous), compactAuditValue(current)));
        }
    }

    private String money(BigDecimal value) {
        return value == null ? "—" : value.stripTrailingZeros().toPlainString() + " ₸";
    }

    private String availabilityLabel(Product product) {
        if (!product.active) return "Скрыт";
        return product.madeToOrder ? "Под заказ" : "В наличии";
    }

    private String deliveryLabel(Product product) {
        if (!product.madeToOrder) return "—";
        if (product.deliveryDaysFrom == null && product.deliveryDaysTo == null) return "Не указан";
        if (product.deliveryDaysFrom == null) return "до " + product.deliveryDaysTo + " дн.";
        if (product.deliveryDaysTo == null) return "от " + product.deliveryDaysFrom + " дн.";
        return product.deliveryDaysFrom + "–" + product.deliveryDaysTo + " дн.";
    }

    private String compactAuditValue(String value) {
        if (value == null || value.isBlank()) return "—";
        String normalized = value.replaceAll("\\s+", " ").trim();
        return normalized.length() <= 160 ? normalized : normalized.substring(0, 157) + "…";
    }

    private record ProductAuditState(
            String sku,
            String nameRu,
            String nameKk,
            String shortDescriptionRu,
            String shortDescriptionKk,
            String descriptionRu,
            String descriptionKk,
            BigDecimal price,
            BigDecimal wholesalePrice,
            BigDecimal bulkWholesalePrice,
            BigDecimal skoPrice,
            BigDecimal gskoPrice,
            BigDecimal incomingPrice,
            String categoryName,
            String availability,
            String delivery) {}
}
