package kz.company.shop.priceStatistics.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import kz.company.shop.categories.entity.Category;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.priceImports.dto.PriceImportPreviewDto;
import kz.company.shop.priceImports.entity.PriceImportSession;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.CategoryStat;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.CategoryTrend;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ImportDetail;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ImportSummary;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.PeriodAnalytics;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.PriceChange;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.PriceTrendPoint;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.PriceTypeSummary;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ProductStat;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ProductTrend;
import kz.company.shop.priceStatistics.dto.PriceStatisticsDto.ProductTrendHistory;
import kz.company.shop.priceStatistics.dto.ProductPriceHistoryDto;
import kz.company.shop.priceStatistics.entity.PriceChangeSnapshot;
import kz.company.shop.priceStatistics.entity.PriceStatisticsImport;
import kz.company.shop.priceStatistics.entity.PriceStatisticsScope;
import kz.company.shop.priceStatistics.entity.PriceType;
import kz.company.shop.priceStatistics.repository.PriceChangeSnapshotRepository;
import kz.company.shop.priceStatistics.repository.PriceStatisticsImportRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.warehouse.entity.PriceSettingGroup;
import kz.company.shop.warehouse.entity.StockDocument;
import kz.company.shop.warehouse.entity.StockDocumentLine;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import kz.company.shop.warehouse.entity.StockDocumentStatus;
import kz.company.shop.warehouse.entity.StockDocumentType;
import kz.company.shop.warehouse.repository.PriceSettingGroupRepository;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.StockDocumentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PriceStatisticsService {
    private static final int PERCENT_SCALE = 6;
    private static final Duration UPDATE_GROUP_WINDOW = Duration.ofMinutes(10);

    private final PriceStatisticsImportRepository imports;
    private final PriceChangeSnapshotRepository snapshots;
    private final ProductRepository products;
    private final CategoryRepository categories;
    private final StockDocumentRepository documents;
    private final StockDocumentLineRepository documentLines;
    private final PriceSettingGroupRepository priceSettingGroups;

    public PriceStatisticsService(
            PriceStatisticsImportRepository imports,
            PriceChangeSnapshotRepository snapshots,
            ProductRepository products,
            CategoryRepository categories,
            StockDocumentRepository documents,
            StockDocumentLineRepository documentLines,
            PriceSettingGroupRepository priceSettingGroups) {
        this.imports = imports;
        this.snapshots = snapshots;
        this.products = products;
        this.categories = categories;
        this.documents = documents;
        this.documentLines = documentLines;
        this.priceSettingGroups = priceSettingGroups;
    }

    /**
     * Persists an immutable price-change snapshot for a successfully committed import. Repeated
     * calls for the same import session are safe and do not duplicate statistics.
     */
    @Transactional
    public void recordCompletedImport(PriceImportSession session, PriceImportPreviewDto preview) {
        if (imports.existsByImportSessionId(session.id)) return;

        Set<String> skus =
                preview.rows().stream()
                        .map(PriceImportPreviewDto.Row::sku)
                        .filter(sku -> sku != null && !sku.isBlank())
                        .collect(Collectors.toCollection(LinkedHashSet::new));
        Map<String, Product> productsBySku =
                products.findBySkuInAndDeletedAtIsNull(skus).stream()
                        .collect(Collectors.toMap(product -> product.sku, Function.identity()));
        Set<Long> categoryIds =
                productsBySku.values().stream()
                        .map(product -> product.categoryId)
                        .filter(id -> id != null)
                        .collect(Collectors.toSet());
        Map<Long, Category> categoriesById =
                categories.findAllById(categoryIds).stream()
                        .filter(category -> category.id != null)
                        .collect(
                                Collectors.toMap(
                                        category -> category.id,
                                        Function.identity(),
                                        (first, duplicate) -> first));

        PriceStatisticsImport statisticsImport = new PriceStatisticsImport();
        statisticsImport.importSessionId = session.id;
        statisticsImport.fileName = session.fileName;
        statisticsImport.createdByName = session.createdByName;
        statisticsImport.completedAt =
                session.completedAt == null ? Instant.now() : session.completedAt;
        PriceStatisticsImport savedImport = imports.save(statisticsImport);

        List<PriceChangeSnapshot> changes = new ArrayList<>();
        for (PriceImportPreviewDto.Row row : preview.rows()) {
            Product product = productsBySku.get(row.sku());
            if (product == null) continue;
            Category category =
                    product.categoryId == null ? null : categoriesById.get(product.categoryId);
            addChange(
                    changes,
                    savedImport.id,
                    product,
                    category,
                    row,
                    PriceType.RETAIL,
                    row.oldPrice(),
                    row.newPrice());
            addChange(
                    changes,
                    savedImport.id,
                    product,
                    category,
                    row,
                    PriceType.WHOLESALE,
                    row.oldWholesalePrice(),
                    row.newWholesalePrice());
            addChange(
                    changes,
                    savedImport.id,
                    product,
                    category,
                    row,
                    PriceType.BULK_WHOLESALE,
                    row.oldBulkWholesalePrice(),
                    row.newBulkWholesalePrice());
            addChange(
                    changes,
                    savedImport.id,
                    product,
                    category,
                    row,
                    PriceType.SKO,
                    row.oldSkoPrice(),
                    row.newSkoPrice());
            addChange(
                    changes,
                    savedImport.id,
                    product,
                    category,
                    row,
                    PriceType.INCOMING,
                    row.oldIncomingPrice(),
                    row.newIncomingPrice());
        }
        if (!changes.isEmpty()) snapshots.saveAll(changes);

        savedImport.changedProducts =
                (int) changes.stream().map(change -> change.sku).distinct().count();
        savedImport.changedPricePoints = changes.size();
        savedImport.averageChangePercent =
                averageValues(changes.stream().map(change -> change.changePercent).toList());
        imports.save(savedImport);
    }

    @Transactional(readOnly = true)
    public PageResult<ImportSummary> imports(int page, int size) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        List<UpdateGroup> allGroups = groupedUpdates();
        int from = Math.min((safePage - 1) * safeSize, allGroups.size());
        int to = Math.min(from + safeSize, allGroups.size());
        return new PageResult<>(
                allGroups.subList(from, to).stream().map(this::summary).toList(),
                safePage,
                safeSize,
                allGroups.size(),
                allGroups.isEmpty() ? 0 : (allGroups.size() + safeSize - 1) / safeSize);
    }

    @Transactional(readOnly = true)
    public ImportDetail detail(UUID importId) {
        return new ImportDetail(summary(getUpdateGroup(importId)));
    }

    @Transactional(readOnly = true)
    public List<CategoryStat> categories(UUID importId) {
        return categories(importId, PriceStatisticsScope.SALES);
    }

    @Transactional(readOnly = true)
    public List<CategoryStat> categories(UUID importId, PriceStatisticsScope scope) {
        List<PriceChangeEvent> importChanges =
                filterByScope(changes(getUpdateGroup(importId)), scope);
        return categoryStats(importChanges);
    }

    private List<CategoryStat> categoryStats(List<PriceChangeEvent> importChanges) {
        Map<Long, String> categoryNames = resolveCategoryNames(importChanges);
        Map<CategoryKey, List<PriceChangeEvent>> grouped =
                importChanges.stream()
                        .collect(
                                Collectors.groupingBy(
                                        change ->
                                                new CategoryKey(
                                                        change.categoryId,
                                                        resolvedCategoryName(change, categoryNames)
                                                                        == null
                                                                ? "Без категории"
                                                                : resolvedCategoryName(
                                                                        change, categoryNames)),
                                        LinkedHashMap::new,
                                        Collectors.toList()));
        return grouped.entrySet().stream()
                .map(
                        entry ->
                                new CategoryStat(
                                        entry.getKey().id(),
                                        entry.getKey().name(),
                                        distinctProducts(entry.getValue()),
                                        entry.getValue().size(),
                                        average(entry.getValue())))
                .sorted(
                        Comparator.comparing(
                                CategoryStat::categoryName, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    @Transactional(readOnly = true)
    public PageResult<ProductStat> products(
            UUID importId, int page, int size, Long categoryId, String query) {
        return products(importId, page, size, categoryId, query, PriceStatisticsScope.SALES);
    }

    @Transactional(readOnly = true)
    public PageResult<ProductStat> products(
            UUID importId,
            int page,
            int size,
            Long categoryId,
            String query,
            PriceStatisticsScope scope) {
        List<PriceChangeEvent> importChanges =
                filterByScope(changes(getUpdateGroup(importId)), scope);
        return productStats(importChanges, page, size, categoryId, query);
    }

    private PageResult<ProductStat> productStats(
            List<PriceChangeEvent> importChanges,
            int page,
            int size,
            Long categoryId,
            String query) {
        String normalizedQuery = query == null ? "" : query.trim().toLowerCase();
        Map<Long, String> categoryNames = resolveCategoryNames(importChanges);
        Map<ProductKey, List<PriceChangeEvent>> grouped =
                importChanges.stream()
                        .filter(
                                change ->
                                        categoryId == null || categoryId.equals(change.categoryId))
                        .filter(
                                change ->
                                        normalizedQuery.isBlank()
                                                || change.sku
                                                        .toLowerCase()
                                                        .contains(normalizedQuery)
                                                || change.productName
                                                        .toLowerCase()
                                                        .contains(normalizedQuery))
                        .collect(
                                Collectors.groupingBy(
                                        change ->
                                                new ProductKey(
                                                        change.productId,
                                                        change.sku,
                                                        change.productName,
                                                        change.categoryId,
                                                        resolvedCategoryName(
                                                                change, categoryNames)),
                                        LinkedHashMap::new,
                                        Collectors.toList()));
        List<ProductStat> all =
                grouped.entrySet().stream()
                        .map(entry -> productStat(entry.getKey(), entry.getValue()))
                        .sorted(
                                Comparator.comparing(
                                        ProductStat::productName, String.CASE_INSENSITIVE_ORDER))
                        .toList();
        int safePage = Math.max(page, 1);
        int safeSize = Math.min(Math.max(size, 1), 100);
        int from = Math.min((safePage - 1) * safeSize, all.size());
        int to = Math.min(from + safeSize, all.size());
        int totalPages = all.isEmpty() ? 0 : (all.size() + safeSize - 1) / safeSize;
        return new PageResult<>(all.subList(from, to), safePage, safeSize, all.size(), totalPages);
    }

    @Transactional(readOnly = true)
    public ProductPriceHistoryDto retailHistory(Long productId, String rawPeriod) {
        products.findByIdAndDeletedAtIsNull(productId)
                .orElseThrow(() -> new AppExceptions.NotFound("Товар не найден"));
        String period = normalizeHistoryPeriod(rawPeriod);
        Instant from = historyStart(period);
        List<ProductPriceHistoryDto.Point> points = new ArrayList<>();
        var importedHistory =
                from == null
                        ? snapshots.findRetailHistoryByProductId(productId)
                        : snapshots.findRetailHistoryByProductIdSince(productId, from);
        importedHistory.forEach(
                point ->
                        points.add(
                                new ProductPriceHistoryDto.Point(
                                        point.getChangedAt(),
                                        point.getOldPrice(),
                                        point.getNewPrice(),
                                        point.getChangePercent())));
        groupedWarehousePriceSettings().stream()
                .flatMap(group -> group.changes().stream())
                .filter(
                        event ->
                                productId.equals(event.productId)
                                        && event.priceType == PriceType.RETAIL
                                        && (from == null || !event.changedAt.isBefore(from)))
                .forEach(
                        point ->
                                points.add(
                                        new ProductPriceHistoryDto.Point(
                                                point.changedAt,
                                                point.oldPrice,
                                                point.newPrice,
                                                point.changePercent)));
        points.sort(Comparator.comparing(ProductPriceHistoryDto.Point::changedAt));
        return new ProductPriceHistoryDto(period, points);
    }

    @Transactional(readOnly = true)
    public PeriodAnalytics periodAnalytics(PriceType priceType, String rawPeriod) {
        PriceType safePriceType = priceType == null ? PriceType.RETAIL : priceType;
        String period = normalizeHistoryPeriod(rawPeriod);
        Instant from = historyStart(period);
        List<PriceChangeEvent> changes =
                allPriceChangeEvents(from).stream()
                        .filter(change -> change.priceType == safePriceType)
                        .toList();
        if (changes.isEmpty()) {
            return new PeriodAnalytics(
                    safePriceType.name(), period, 0, 0, 0, 0, null, List.of(), List.of());
        }
        Map<Long, String> categoryNames = resolveCategoryNames(changes);
        List<ProductTrend> productTrends =
                changes.stream()
                        .collect(
                                Collectors.groupingBy(
                                        change ->
                                                new ProductKey(
                                                        change.productId,
                                                        change.sku,
                                                        change.productName,
                                                        change.categoryId,
                                                        resolvedCategoryName(
                                                                change, categoryNames)),
                                        LinkedHashMap::new,
                                        Collectors.toList()))
                        .entrySet()
                        .stream()
                        .map(
                                entry ->
                                        productTrend(entry.getKey(), entry.getValue()))
                        .sorted(
                                Comparator.comparing(
                                                ProductTrend::averageAbsoluteChangePercent,
                                                Comparator.nullsLast(Comparator.reverseOrder()))
                                        .thenComparing(
                                                ProductTrend::updateCount,
                                                Comparator.reverseOrder()))
                        .toList();
        List<CategoryTrend> categoryTrends = categoryTrends(productTrends);
        int increasedProducts =
                (int)
                        productTrends.stream()
                                .filter(trend -> trend.netChangePercent().signum() > 0)
                                .count();
        int decreasedProducts =
                (int)
                        productTrends.stream()
                                .filter(trend -> trend.netChangePercent().signum() < 0)
                                .count();
        int unstableProducts =
                (int) productTrends.stream().filter(trend -> trend.updateCount() >= 2).count();
        return new PeriodAnalytics(
                safePriceType.name(),
                period,
                productTrends.size(),
                increasedProducts,
                decreasedProducts,
                unstableProducts,
                productTrends.isEmpty()
                        ? null
                        : averageValues(
                                productTrends.stream()
                                        .map(ProductTrend::netChangePercent)
                                        .toList()),
                productTrends,
                categoryTrends);
    }

    /**
     * Internal drill-down for the analytics screen. The public price-history API deliberately
     * remains retail-only; this method is exposed only from the protected admin controller.
     */
    @Transactional(readOnly = true)
    public ProductTrendHistory productTrendHistory(
            Long productId, PriceType priceType, String rawPeriod) {
        Product product =
                products.findByIdAndDeletedAtIsNull(productId)
                        .orElseThrow(() -> new AppExceptions.NotFound("Товар не найден"));
        PriceType safePriceType = priceType == null ? PriceType.RETAIL : priceType;
        String period = normalizeHistoryPeriod(rawPeriod);
        Instant from = historyStart(period);
        List<PriceTrendPoint> points =
                allPriceChangeEvents(from)
                        .stream()
                        .filter(
                                change ->
                                        productId.equals(change.productId)
                                                && change.priceType == safePriceType)
                        .sorted(Comparator.comparing(change -> change.changedAt))
                        .map(
                                change ->
                                        new PriceTrendPoint(
                                                change.changedAt,
                                                change.oldPrice,
                                                change.newPrice,
                                                change.changePercent,
                                                change.source,
                                                change.sourceName))
                        .toList();
        return new ProductTrendHistory(
                product.id, product.sku, product.nameRu, safePriceType.name(), period, points);
    }

    private void addChange(
            List<PriceChangeSnapshot> changes,
            Long statisticsImportId,
            Product product,
            Category category,
            PriceImportPreviewDto.Row row,
            PriceType type,
            BigDecimal oldPrice,
            BigDecimal newPrice) {
        if (oldPrice == null
                || oldPrice.compareTo(BigDecimal.ZERO) <= 0
                || newPrice == null
                || newPrice.compareTo(oldPrice) == 0) return;
        PriceChangeSnapshot change = new PriceChangeSnapshot();
        change.statisticsImportId = statisticsImportId;
        change.productId = product.id;
        change.sku = row.sku();
        change.productName = row.productName();
        change.categoryId = product.categoryId;
        change.categoryName = category == null ? null : category.nameRu;
        change.priceType = type;
        change.oldPrice = oldPrice;
        change.newPrice = newPrice;
        change.changePercent = percent(oldPrice, newPrice);
        changes.add(change);
    }

    private List<PriceChangeEvent> filterByScope(
            List<PriceChangeEvent> changes, PriceStatisticsScope scope) {
        PriceStatisticsScope safeScope = scope == null ? PriceStatisticsScope.SALES : scope;
        return changes.stream()
                .filter(
                        change ->
                                safeScope == PriceStatisticsScope.INCOMING
                                        ? change.priceType == PriceType.INCOMING
                                        : change.priceType != PriceType.INCOMING)
                .toList();
    }

    private BigDecimal percent(BigDecimal oldPrice, BigDecimal newPrice) {
        if (oldPrice == null || oldPrice.compareTo(BigDecimal.ZERO) == 0 || newPrice == null) {
            return BigDecimal.ZERO.setScale(PERCENT_SCALE);
        }
        return newPrice.subtract(oldPrice)
                .multiply(BigDecimal.valueOf(100))
                .divide(oldPrice, PERCENT_SCALE, RoundingMode.HALF_UP);
    }

    private BigDecimal changePercent(BigDecimal oldPrice, BigDecimal newPrice) {
        if (oldPrice == null || oldPrice.compareTo(BigDecimal.ZERO) == 0 || newPrice == null) {
            return null;
        }
        return percent(oldPrice, newPrice);
    }

    private BigDecimal average(List<PriceChangeEvent> changes) {
        return averageValues(
                changes.stream()
                        .map(change -> change.changePercent)
                        .filter(java.util.Objects::nonNull)
                        .toList());
    }

    private BigDecimal averageValues(List<BigDecimal> values) {
        if (values.isEmpty()) return BigDecimal.ZERO.setScale(PERCENT_SCALE);
        BigDecimal sum = values.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        return sum.divide(BigDecimal.valueOf(values.size()), PERCENT_SCALE, RoundingMode.HALF_UP);
    }

    private int distinctProducts(List<PriceChangeEvent> changes) {
        return (int) changes.stream().map(change -> change.sku).distinct().count();
    }

    private Map<Long, String> resolveCategoryNames(List<PriceChangeEvent> changes) {
        Set<Long> categoryIds =
                changes.stream()
                        .filter(change -> isBlank(change.categoryName))
                        .map(change -> change.categoryId)
                        .filter(categoryId -> categoryId != null)
                        .collect(Collectors.toSet());
        if (categoryIds.isEmpty()) return Map.of();

        return categories.findNamesRuByIdIn(categoryIds).stream()
                .filter(category -> category.getId() != null && !isBlank(category.getNameRu()))
                .collect(
                        Collectors.toMap(
                                CategoryRepository.NameRuProjection::getId,
                                CategoryRepository.NameRuProjection::getNameRu));
    }

    private String resolvedCategoryName(
            PriceChangeEvent change, Map<Long, String> categoryNames) {
        if (!isBlank(change.categoryName)) return change.categoryName;
        return change.categoryId == null ? null : categoryNames.get(change.categoryId);
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private ProductStat productStat(ProductKey key, List<PriceChangeEvent> productChanges) {
        List<PriceChange> changes =
                productChanges.stream()
                        .sorted(Comparator.comparing(change -> change.priceType))
                        .map(
                                change ->
                                        new PriceChange(
                                                change.priceType.name(),
                                                change.oldPrice,
                                                change.newPrice,
                                                change.changePercent))
                        .toList();
        return new ProductStat(
                key.productId(),
                key.sku(),
                key.productName(),
                key.categoryId(),
                key.categoryName(),
                changes.size(),
                average(productChanges),
                changes);
    }

    private ProductTrend productTrend(
            ProductKey key,
            List<PriceChangeEvent> productChanges) {
        List<PriceChangeEvent> ordered =
                productChanges.stream()
                        .sorted(Comparator.comparing(change -> change.changedAt))
                        .toList();
        PriceChangeEvent first = ordered.get(0);
        PriceChangeEvent last = ordered.get(ordered.size() - 1);
        List<BigDecimal> absoluteChanges =
                ordered.stream()
                        .map(change -> change.changePercent)
                        .filter(java.util.Objects::nonNull)
                        .map(BigDecimal::abs)
                        .toList();
        return new ProductTrend(
                key.productId(),
                key.sku(),
                key.productName(),
                key.categoryId(),
                key.categoryName() == null ? "Без категории" : key.categoryName(),
                first.oldPrice,
                last.newPrice,
                percent(first.oldPrice, last.newPrice),
                ordered.size(),
                (int)
                        ordered.stream()
                                .filter(
                                        change ->
                                                change.changePercent != null
                                                        && change.changePercent.signum() > 0)
                                .count(),
                (int)
                        ordered.stream()
                                .filter(
                                        change ->
                                                change.changePercent != null
                                                        && change.changePercent.signum() < 0)
                                .count(),
                averageValues(absoluteChanges),
                absoluteChanges.stream().max(Comparator.naturalOrder()).orElse(BigDecimal.ZERO));
    }

    private List<CategoryTrend> categoryTrends(List<ProductTrend> productTrends) {
        return productTrends.stream()
                .collect(
                        Collectors.groupingBy(
                                trend -> new CategoryKey(trend.categoryId(), trend.categoryName()),
                                LinkedHashMap::new,
                                Collectors.toList()))
                .entrySet()
                .stream()
                .map(
                        entry -> {
                            List<ProductTrend> trends = entry.getValue();
                            return new CategoryTrend(
                                    entry.getKey().id(),
                                    entry.getKey().name(),
                                    trends.size(),
                                    (int)
                                            trends.stream()
                                                    .filter(
                                                            trend ->
                                                                    trend.netChangePercent()
                                                                                    .signum()
                                                                            > 0)
                                                    .count(),
                                    (int)
                                            trends.stream()
                                                    .filter(
                                                            trend ->
                                                                    trend.netChangePercent()
                                                                                    .signum()
                                                                            < 0)
                                                    .count(),
                                    trends.stream().mapToInt(ProductTrend::updateCount).sum(),
                                    averageValues(
                                            trends.stream()
                                                    .map(ProductTrend::netChangePercent)
                                                    .toList()),
                                    averageValues(
                                            trends.stream()
                                                    .map(ProductTrend::averageAbsoluteChangePercent)
                                                    .toList()),
                                    trends.stream()
                                            .map(ProductTrend::maximumAbsoluteChangePercent)
                                            .max(Comparator.naturalOrder())
                                            .orElse(BigDecimal.ZERO));
                        })
                .sorted(
                        Comparator.comparing(
                                        CategoryTrend::averageVolatilityPercent,
                                        Comparator.reverseOrder())
                                .thenComparing(
                                        CategoryTrend::updateCount, Comparator.reverseOrder()))
                .toList();
    }

    private ImportSummary summary(UpdateGroup group) {
        List<PriceChangeEvent> groupChanges = changes(group);
        List<PriceTypeSummary> priceTypes =
                List.of(PriceType.values()).stream()
                        .map(
                                priceType -> {
                                    List<PriceChangeEvent> typeChanges =
                                            groupChanges.stream()
                                                    .filter(change -> change.priceType == priceType)
                                                    .toList();
                                    return new PriceTypeSummary(
                                            priceType.name(),
                                            distinctProducts(typeChanges),
                                            typeChanges.size(),
                                            typeChanges.isEmpty() ? null : average(typeChanges));
                                })
                        .toList();
        PriceTypeSummary retail =
                priceTypes.stream()
                        .filter(summary -> summary.priceType().equals(PriceType.RETAIL.name()))
                        .findFirst()
                        .orElse(null);
        return new ImportSummary(
                group.id(),
                group.startedAt(),
                group.completedAt(),
                group.fileNames(),
                group.createdByNames(),
                group.updateCount(),
                distinctProducts(groupChanges),
                groupChanges.size(),
                retail == null ? null : retail.averageChangePercent(),
                priceTypes,
                group.source(),
                group.sourceName());
    }

    private List<UpdateGroup> groupedUpdates() {
        List<UpdateGroup> updates = new ArrayList<>();
        groupedManualImports().forEach(group -> updates.add(manualUpdateGroup(group)));
        updates.addAll(groupedWarehousePriceSettings());
        return updates.stream()
                .sorted(Comparator.comparing(UpdateGroup::completedAt).reversed())
                .toList();
    }

    private List<ManualImportGroup> groupedManualImports() {
        List<PriceStatisticsImport> all = imports.findAllByOrderByCompletedAtAsc();
        if (all.isEmpty()) return List.of();

        List<ManualImportGroup> grouped = new ArrayList<>();
        List<PriceStatisticsImport> current = new ArrayList<>();
        for (PriceStatisticsImport statisticsImport : all) {
            if (current.isEmpty()
                    || Duration.between(current.get(0).completedAt, statisticsImport.completedAt)
                                    .compareTo(UPDATE_GROUP_WINDOW)
                            <= 0) {
                current.add(statisticsImport);
                continue;
            }
            grouped.add(manualImportGroup(current));
            current = new ArrayList<>();
            current.add(statisticsImport);
        }
        grouped.add(manualImportGroup(current));
        return grouped;
    }

    private ManualImportGroup manualImportGroup(List<PriceStatisticsImport> groupImports) {
        return new ManualImportGroup(
                groupImports.get(0).importSessionId,
                List.copyOf(groupImports),
                groupImports.get(0).completedAt,
                groupImports.get(groupImports.size() - 1).completedAt);
    }

    private UpdateGroup manualUpdateGroup(ManualImportGroup group) {
        Map<Long, PriceStatisticsImport> importsById =
                group.imports().stream()
                        .collect(Collectors.toMap(item -> item.id, Function.identity()));
        List<PriceChangeEvent> events =
                snapshots.findByStatisticsImportIdIn(new ArrayList<>(importsById.keySet())).stream()
                        .map(
                                change -> {
                                    PriceStatisticsImport statisticsImport =
                                            importsById.get(change.statisticsImportId);
                                    return manualPriceChangeEvent(
                                            change, statisticsImport, group.completedAt());
                                })
                        .toList();
        return new UpdateGroup(
                group.id(),
                "IMPORT",
                "Ручной импорт",
                group.imports().stream().map(item -> item.fileName).toList(),
                group.imports().stream().map(item -> item.createdByName).distinct().toList(),
                group.imports().size(),
                group.startedAt(),
                group.completedAt(),
                events);
    }

    private List<UpdateGroup> groupedWarehousePriceSettings() {
        List<StockDocument> postedDocuments =
                documents.findAll().stream()
                        .filter(
                                document ->
                                        document.documentType == StockDocumentType.PRICE_SETTING
                                                && document.status == StockDocumentStatus.POSTED
                                                && document.deletedAt == null
                                                && document.priceType != null)
                        .toList();
        if (postedDocuments.isEmpty()) return List.of();

        Set<UUID> groupIds =
                postedDocuments.stream()
                        .map(document -> document.priceSettingGroupId)
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet());
        Map<UUID, PriceSettingGroup> groupsById =
                priceSettingGroups.findAllById(groupIds).stream()
                        .collect(Collectors.toMap(group -> group.id, Function.identity()));
        Map<UUID, List<StockDocument>> documentsByUpdateId =
                postedDocuments.stream()
                        .collect(
                                Collectors.groupingBy(
                                        document ->
                                                document.priceSettingGroupId == null
                                                        ? document.id
                                                        : document.priceSettingGroupId,
                                        LinkedHashMap::new,
                                        Collectors.toList()));
        return documentsByUpdateId.entrySet().stream()
                .map(
                        entry -> {
                            UUID updateId = entry.getKey();
                            List<StockDocument> updateDocuments = entry.getValue();
                            PriceSettingGroup priceSettingGroup = groupsById.get(updateId);
                            String sourceName =
                                    priceSettingGroup == null
                                            ? documentSourceName(updateDocuments.get(0))
                                            : priceSettingGroup.name;
                            Instant startedAt =
                                    updateDocuments.stream()
                                            .map(this::postedAt)
                                            .min(Comparator.naturalOrder())
                                            .orElseThrow();
                            Instant completedAt =
                                    updateDocuments.stream()
                                            .map(this::postedAt)
                                            .max(Comparator.naturalOrder())
                                            .orElseThrow();
                            return new UpdateGroup(
                                    updateId,
                                    "WAREHOUSE_PRICE_SETTING",
                                    sourceName,
                                    updateDocuments.stream()
                                            .map(this::documentSourceName)
                                            .toList(),
                                    List.of(),
                                    updateDocuments.size(),
                                    startedAt,
                                    completedAt,
                                    warehousePriceChanges(updateDocuments, sourceName));
                        })
                .toList();
    }

    private List<PriceChangeEvent> warehousePriceChanges(
            List<StockDocument> updateDocuments, String sourceName) {
        Map<UUID, StockDocument> documentsById =
                updateDocuments.stream()
                        .collect(Collectors.toMap(document -> document.id, Function.identity()));
        List<StockDocumentLine> lines =
                updateDocuments.stream()
                        .flatMap(document -> documentLines.findByDocumentIdOrderById(document.id).stream())
                        .toList();
        Set<Long> productIds =
                lines.stream().map(line -> line.productId).collect(Collectors.toSet());
        Map<Long, Product> productsById =
                products.findAllById(productIds).stream()
                        .collect(Collectors.toMap(product -> product.id, Function.identity()));
        return lines.stream()
                .map(
                        line -> {
                            StockDocument document = documentsById.get(line.documentId);
                            Product product = productsById.get(line.productId);
                            PriceType priceType = analyticsPriceType(document.priceType);
                            if (document == null
                                    || product == null
                                    || priceType == null
                                    || line.unitPrice == null
                                    || (line.previousUnitPrice != null
                                            && line.unitPrice.compareTo(line.previousUnitPrice) == 0)) {
                                return null;
                            }
                            return new PriceChangeEvent(
                                    product.id,
                                    product.sku,
                                    product.nameRu,
                                    product.categoryId,
                                    null,
                                    priceType,
                                    line.previousUnitPrice,
                                    line.unitPrice,
                                    changePercent(line.previousUnitPrice, line.unitPrice),
                                    postedAt(document),
                                    "WAREHOUSE_PRICE_SETTING",
                                    warehouseEventSourceName(sourceName, document));
                        })
                .filter(java.util.Objects::nonNull)
                .toList();
    }

    private PriceType analyticsPriceType(StockDocumentPriceType priceType) {
        if (priceType == null) return null;
        return switch (priceType) {
            case RETAIL -> PriceType.RETAIL;
            case WHOLESALE -> PriceType.WHOLESALE;
            case BULK_WHOLESALE -> PriceType.BULK_WHOLESALE;
            case SKO -> PriceType.SKO;
            case GSKO -> PriceType.GSKO;
            case INCOMING -> PriceType.INCOMING;
        };
    }

    private Instant postedAt(StockDocument document) {
        return kz.company.shop.warehouse.service.WarehouseDocumentMoment.instant(document);
    }

    private String documentSourceName(StockDocument document) {
        return isBlank(document.documentNumber)
                ? "Документ установки цен"
                : "Документ " + document.documentNumber;
    }

    private String warehouseEventSourceName(String groupName, StockDocument document) {
        String documentName = documentSourceName(document);
        return groupName.equals(documentName) ? groupName : groupName + " · " + documentName;
    }

    private UpdateGroup getUpdateGroup(UUID importId) {
        return groupedUpdates().stream()
                .filter(group -> group.id().equals(importId))
                .findFirst()
                .orElseThrow(() -> new AppExceptions.NotFound("Группа обновления цен не найдена"));
    }

    private List<PriceChangeEvent> changes(UpdateGroup group) {
        return group.changes();
    }

    private List<PriceChangeEvent> allPriceChangeEvents(Instant from) {
        List<PriceStatisticsImport> allImports = imports.findAllByOrderByCompletedAtAsc();
        Map<Long, PriceStatisticsImport> importsById =
                allImports.stream().collect(Collectors.toMap(item -> item.id, Function.identity()));
        List<PriceChangeEvent> events = new ArrayList<>();
        if (!importsById.isEmpty()) {
            snapshots.findByStatisticsImportIdIn(new ArrayList<>(importsById.keySet())).stream()
                    .map(
                            change ->
                                    manualPriceChangeEvent(
                                            change,
                                            importsById.get(change.statisticsImportId),
                                            null))
                    .forEach(events::add);
        }
        groupedWarehousePriceSettings().stream()
                .flatMap(group -> group.changes().stream())
                .forEach(events::add);
        return events.stream()
                .filter(event -> from == null || !event.changedAt.isBefore(from))
                .toList();
    }

    private PriceChangeEvent manualPriceChangeEvent(
            PriceChangeSnapshot change,
            PriceStatisticsImport statisticsImport,
            Instant fallbackCompletedAt) {
        Instant completedAt =
                statisticsImport == null ? fallbackCompletedAt : statisticsImport.completedAt;
        String sourceName = statisticsImport == null ? "Ручной импорт" : statisticsImport.fileName;
        return new PriceChangeEvent(
                change.productId,
                change.sku,
                change.productName,
                change.categoryId,
                change.categoryName,
                change.priceType,
                change.oldPrice,
                change.newPrice,
                change.changePercent,
                completedAt,
                "IMPORT",
                sourceName);
    }

    private String normalizeHistoryPeriod(String rawPeriod) {
        if (rawPeriod == null || rawPeriod.isBlank()) return "all";
        String normalized = rawPeriod.trim().toLowerCase().replace("-", "").replace("_", "");
        return switch (normalized) {
            case "week", "month", "year", "all" -> normalized;
            case "5years", "fiveyears" -> "5years";
            default ->
                    throw new AppExceptions.BadRequest(
                            "Недопустимый период истории цен: " + rawPeriod);
        };
    }

    private Instant historyStart(String period) {
        Instant now = Instant.now();
        return switch (period) {
            case "week" -> now.minus(Duration.ofDays(7));
            case "month" -> now.minus(Duration.ofDays(31));
            case "year" -> now.minus(Duration.ofDays(365));
            case "5years" -> now.minus(Duration.ofDays(365 * 5L));
            default -> null;
        };
    }

    private record CategoryKey(Long id, String name) {}

    private record ManualImportGroup(
            UUID id, List<PriceStatisticsImport> imports, Instant startedAt, Instant completedAt) {}

    private record UpdateGroup(
            UUID id,
            String source,
            String sourceName,
            List<String> fileNames,
            List<String> createdByNames,
            int updateCount,
            Instant startedAt,
            Instant completedAt,
            List<PriceChangeEvent> changes) {}

    private record PriceChangeEvent(
            Long productId,
            String sku,
            String productName,
            Long categoryId,
            String categoryName,
            PriceType priceType,
            BigDecimal oldPrice,
            BigDecimal newPrice,
            BigDecimal changePercent,
            Instant changedAt,
            String source,
            String sourceName) {}

    private record ProductKey(
            Long productId, String sku, String productName, Long categoryId, String categoryName) {}
}
