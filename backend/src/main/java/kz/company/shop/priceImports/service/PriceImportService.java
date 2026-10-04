package kz.company.shop.priceImports.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.priceImports.dto.PriceImportCommitDto;
import kz.company.shop.priceImports.dto.PriceImportPreviewDto;
import kz.company.shop.priceImports.dto.PriceImportPreviewDto.Row;
import kz.company.shop.priceImports.dto.PriceImportPreviewDto.SourceFile;
import kz.company.shop.priceImports.dto.PriceImportPreviewDto.Summary;
import kz.company.shop.priceImports.entity.ImportPriceType;
import kz.company.shop.priceImports.entity.PriceImportSession;
import kz.company.shop.priceImports.entity.PriceImportStatus;
import kz.company.shop.priceImports.repository.PriceImportSessionRepository;
import kz.company.shop.priceStatistics.service.PriceStatisticsService;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.settings.service.ProjectSettingsService;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class PriceImportService {
    private static final String CHANGED = "CHANGED";
    private static final String UNCHANGED = "UNCHANGED";
    private static final String NOT_FOUND = "NOT_FOUND";
    private static final String TO_CREATE = "TO_CREATE";
    private static final String INVALID = "INVALID";
    private static final String DUPLICATE = "DUPLICATE";
    private static final String PRICE_SETTING = "PRICE_SETTING";
    private static final List<String> DEFAULT_EXCLUDED_NAME_TERMS =
            List.of("не выбирать", "корзина");
    private static final Pattern MADE_TO_ORDER_PREFIX =
            Pattern.compile(
                    "^[\\s\\p{Zs}]*(?:на[\\s\\p{Zs}]*заказ|нет[\\s\\p{Zs}]*в[\\s\\p{Zs}]*на[\\s\\p{Zs}]*личи(?:и)?)(?:[\\s\\p{Zs}:—–-]+|(?=.)|$)",
                    Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern EXCLUDED_NAME_PREFIX =
            Pattern.compile(
                    "^[\\s\\p{Zs}]*не[\\s\\p{Zs}]*выб(?:ирать|ираем|ир|ерать|ераем|ер|рать)(?:[\\s\\p{Zs}:—–-]+|(?=.)|$)",
                    Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern ARTICLE_MARKER =
            Pattern.compile(
                    "(?:\\s*\\(\\s*арт(?:икул)?\\.?\\s*[-:№]?\\s*\\d+\\s*\\)|\\s+арт(?:икул)?\\.?\\s*[-:№]?\\s*\\d+\\b)",
                    Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final int MAX_BATCH_FILES = ImportPriceType.values().length;

    private final PriceImportPythonRunner pythonRunner;
    private final PriceImportSessionRepository sessionRepository;
    private final ProductRepository productRepository;
    private final AuditService auditService;
    private final PriceStatisticsService priceStatisticsService;
    private final ObjectMapper objectMapper;
    private final ProjectSettingsService projectSettingsService;
    private final StockDocumentLineRepository stockDocumentLines;

    public PriceImportService(
            PriceImportPythonRunner pythonRunner,
            PriceImportSessionRepository sessionRepository,
            ProductRepository productRepository,
            AuditService auditService,
            PriceStatisticsService priceStatisticsService,
            ObjectMapper objectMapper,
            ProjectSettingsService projectSettingsService,
            StockDocumentLineRepository stockDocumentLines) {
        this.pythonRunner = pythonRunner;
        this.sessionRepository = sessionRepository;
        this.productRepository = productRepository;
        this.auditService = auditService;
        this.priceStatisticsService = priceStatisticsService;
        this.objectMapper = objectMapper;
        this.projectSettingsService = projectSettingsService;
        this.stockDocumentLines = stockDocumentLines;
    }

    @Transactional
    public PriceImportPreviewDto analyze(MultipartFile file, CurrentUser actor) {
        return analyze(file, actor, false);
    }

    @Transactional
    public PriceImportPreviewDto analyze(
            MultipartFile file, CurrentUser actor, boolean createMissingProducts) {
        return analyze(file, actor, createMissingProducts, true, (ImportPriceType) null);
    }

    /** Compatibility bridge for already compiled callers of the former 1C tier API. */
    @Deprecated
    @Transactional
    public PriceImportPreviewDto analyze(
            MultipartFile file,
            CurrentUser actor,
            boolean createMissingProducts,
            PriceTier oneCPriceTier) {
        PriceImportPythonRunner.Analysis analysis = pythonRunner.analyze(file, oneCPriceTier);
        return analyzeAnalysis(
                file,
                actor,
                createMissingProducts,
                true,
                analysis,
                oneCPriceTier == null ? null : ImportPriceType.valueOf(oneCPriceTier.name()));
    }

    @Transactional
    public PriceImportPreviewDto analyze(
            MultipartFile file,
            CurrentUser actor,
            boolean createMissingProducts,
            ImportPriceType oneCPriceTier) {
        return analyze(file, actor, createMissingProducts, true, oneCPriceTier);
    }

    @Transactional
    public PriceImportPreviewDto analyze(
            MultipartFile file,
            CurrentUser actor,
            boolean createMissingProducts,
            boolean updateAvailabilityAndMadeToOrder,
            ImportPriceType oneCPriceTier) {
        PriceImportPythonRunner.Analysis analysis =
                oneCPriceTier == null
                        ? pythonRunner.analyze(file)
                        : pythonRunner.analyze(file, oneCPriceTier);
        return analyzeAnalysis(
                file,
                actor,
                createMissingProducts,
                updateAvailabilityAndMadeToOrder,
                analysis,
                oneCPriceTier);
    }

    /**
     * Analyses one 1C price file per price type as a single reviewable import session. The mapping
     * is derived on the server from the original file names; browser-provided tier values are not
     * trusted.
     */
    @Transactional
    public PriceImportPreviewDto analyzeBatch(
            List<MultipartFile> files, CurrentUser actor, boolean createMissingProducts) {
        return analyzeBatch(files, actor, createMissingProducts, true);
    }

    @Transactional
    public PriceImportPreviewDto analyzeBatch(
            List<MultipartFile> files,
            CurrentUser actor,
            boolean createMissingProducts,
            boolean updateAvailabilityAndMadeToOrder) {
        if (files == null || files.isEmpty()) {
            throw new AppExceptions.BadRequest("Выберите хотя бы один файл 1С");
        }
        if (files.size() > MAX_BATCH_FILES) {
            throw new AppExceptions.BadRequest(
                    "В одном пакете можно загрузить не больше " + MAX_BATCH_FILES + " файлов");
        }

        List<BatchFileAnalysis> analyzedFiles = new ArrayList<>();
        Set<ImportPriceType> usedTypes = new LinkedHashSet<>();
        int totalRows = 0;
        for (MultipartFile file : files) {
            String fileName = safeDisplayFileName(file == null ? null : file.getOriginalFilename());
            if (!fileName.toLowerCase(Locale.ROOT).endsWith(".mxl")) {
                throw new AppExceptions.BadRequest(
                        "Пакетный импорт поддерживает только файлы 1С .mxl: " + fileName);
            }
            ImportPriceType priceType = priceTypeFromFileName(fileName);
            if (priceType == null) {
                throw new AppExceptions.BadRequest(
                        "Не удалось определить тип цены по имени файла «"
                                + fileName
                                + "». Используйте в имени: розница, оптовая, крупно_оптовая, ско или приходная");
            }
            if (!usedTypes.add(priceType)) {
                throw new AppExceptions.BadRequest(
                        "Для типа «"
                                + priceTypeLabel(priceType)
                                + "» загружено больше одного файла. Оставьте один актуальный файл");
            }
            PriceImportPythonRunner.Analysis analysis = pythonRunner.analyze(file, priceType);
            totalRows += analysis.rows().size();
            if (totalRows > pythonRunner.maxRows()) {
                throw new AppExceptions.BadRequest(
                        "В пакете слишком много строк для одного импорта: " + totalRows);
            }
            analyzedFiles.add(new BatchFileAnalysis(fileName, priceType, analysis));
        }

        List<SourceFile> sourceFiles =
                analyzedFiles.stream()
                        .map(
                                file ->
                                        new SourceFile(
                                                file.fileName(),
                                                file.priceType(),
                                                file.analysis().rows().size()))
                        .toList();
        return analyzeRows(
                sourceFiles.stream().map(SourceFile::fileName).collect(Collectors.joining(", ")),
                actor,
                createMissingProducts,
                updateAvailabilityAndMadeToOrder,
                mergeBatchRows(analyzedFiles),
                writeBatchAnalysis(analyzedFiles),
                sourceFiles);
    }

    private PriceImportPreviewDto analyzeAnalysis(
            MultipartFile file,
            CurrentUser actor,
            boolean createMissingProducts,
            boolean updateAvailabilityAndMadeToOrder,
            PriceImportPythonRunner.Analysis analysis,
            ImportPriceType oneCPriceTier) {
        String fileName = safeDisplayFileName(file.getOriginalFilename());
        List<SourceFile> sourceFiles =
                oneCPriceTier == null
                        ? List.of()
                        : List.of(new SourceFile(fileName, oneCPriceTier, analysis.rows().size()));
        return analyzeRows(
                fileName,
                actor,
                createMissingProducts,
                updateAvailabilityAndMadeToOrder,
                analysis.rows(),
                analysis.rawJson(),
                sourceFiles);
    }

    private PriceImportPreviewDto analyzeRows(
            String fileName,
            CurrentUser actor,
            boolean createMissingProducts,
            boolean updateAvailabilityAndMadeToOrder,
            List<PriceImportPythonRunner.SourceRow> importedRows,
            String rawAnalysis,
            List<SourceFile> sourceFiles) {
        List<String> excludedNameTerms = excludedNameTerms();
        Set<String> allSkus =
                importedRows.stream()
                        .map(PriceImportPythonRunner.SourceRow::sku)
                        .map(this::normalizeSku)
                        .filter(sku -> sku != null)
                        .collect(Collectors.toCollection(LinkedHashSet::new));
        Map<String, Product> products = productsBySku(allSkus);
        Set<Long> priceSettingProductIds =
                products.values().stream()
                        .map(product -> product.id)
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet());
        Set<Long> productsInPriceSettings =
                priceSettingProductIds.isEmpty()
                        ? Set.of()
                        : stockDocumentLines.findProductIdsInPostedPriceSettings(priceSettingProductIds);
        List<PriceImportPythonRunner.SourceRow> sourceRows =
                importedRows.stream()
                        .filter(
                                source ->
                                        !hasExcludedName(source.name(), excludedNameTerms)
                                                || products.containsKey(normalizeSku(source.sku())))
                        .toList();
        if (sourceRows.isEmpty()) {
            throw new AppExceptions.BadRequest(
                    "В файле не найдены товары для импорта. Проверьте заголовки и исключения по названию");
        }
        Map<String, Long> occurrences = skuOccurrences(sourceRows);
        List<Row> rows = new ArrayList<>();
        for (PriceImportPythonRunner.SourceRow source : sourceRows) {
            rows.add(
                    toPreviewRow(
                            source,
                            occurrences,
                            products,
                            createMissingProducts,
                            excludedNameTerms,
                            updateAvailabilityAndMadeToOrder,
                            productsInPriceSettings));
        }
        Summary summary = summarize(rows);

        PriceImportSession session = new PriceImportSession();
        session.fileName = safeDisplayFileName(fileName);
        session.status = PriceImportStatus.ANALYZED;
        session.totalRows = rows.size();
        session.changedRows = summary.changed();
        session.unchangedRows = summary.unchanged();
        session.notFoundRows = summary.notFound() + summary.toCreate();
        session.invalidRows = summary.invalid();
        session.duplicateRows = summary.duplicate();
        session.analysisJson = rawAnalysis;
        session.previewJson = "{}";
        session.createdByUserId = actor.id();
        session.createdByName = actor.name();
        PriceImportSession saved = sessionRepository.save(session);

        PriceImportPreviewDto preview =
                new PriceImportPreviewDto(
                        saved.id,
                        saved.fileName,
                        saved.status.name(),
                        createMissingProducts,
                        updateAvailabilityAndMadeToOrder,
                        rows.size(),
                        summary,
                        List.copyOf(rows),
                        List.copyOf(sourceFiles));
        saved.previewJson = writePreview(preview);
        sessionRepository.save(saved);
        return preview;
    }

    @Transactional(readOnly = true)
    public PriceImportPreviewDto get(UUID id) {
        PriceImportSession session = getSession(id);
        PriceImportPreviewDto preview = readPreview(session.previewJson);
        return withStatus(preview, session.status);
    }

    @Transactional
    public PriceImportCommitDto commit(UUID id) {
        return commit(id, null);
    }

    /**
     * Applies either all preview rows (when {@code selectedRowIndexes} is {@code null}) or the
     * explicitly selected zero-based preview-row indexes. This keeps the original no-body API
     * request backward compatible.
     */
    @Transactional
    public PriceImportCommitDto commit(UUID id, List<Integer> selectedRowIndexes) {
        PriceImportSession session =
                sessionRepository
                        .findByIdForUpdate(id)
                        .orElseThrow(
                                () -> new AppExceptions.NotFound("Сессия импорта цен не найдена"));
        if (session.status == PriceImportStatus.COMPLETED) {
            return commitResult(session);
        }
        PriceImportPreviewDto preview = readPreview(session.previewJson);
        List<Row> rowsToCommit = selectedRows(preview.rows(), selectedRowIndexes);
        Set<String> skus =
                rowsToCommit.stream()
                        .filter(this::isImportable)
                        .map(Row::sku)
                        .filter(sku -> sku != null && !sku.isBlank())
                        .collect(Collectors.toCollection(LinkedHashSet::new));
        Map<String, Product> products = productsBySku(skus);
        Set<Long> productsInPriceSettings =
                products.values().stream()
                        .map(product -> product.id)
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet());
        Set<Long> priceSettingProductIds =
                productsInPriceSettings.isEmpty()
                        ? Set.of()
                        : stockDocumentLines.findProductIdsInPostedPriceSettings(productsInPriceSettings);
        List<Product> changedProducts = new ArrayList<>();
        List<Product> createdProducts = new ArrayList<>();
        int created = 0;
        int updated = 0;
        int unchanged = 0;
        int skipped = 0;

        for (Row row : rowsToCommit) {
            if (!isImportable(row)) {
                skipped++;
                continue;
            }
            Product product = products.get(row.sku());
            if (TO_CREATE.equals(row.status())) {
                if (product != null) {
                    throw new AppExceptions.BadRequest(
                            "Товар с артикулом "
                                    + row.sku()
                                    + " появился после анализа. Загрузите файл повторно");
                }
                createdProducts.add(createDraftProduct(row, session.id));
                created++;
                continue;
            }
            if (product == null) {
                skipped++;
                continue;
            }
            boolean pricesLockedByPriceSetting = priceSettingProductIds.contains(product.id);
            if ((CHANGED.equals(row.status()) || PRICE_SETTING.equals(row.status()))
                    && !matchesPreviewSnapshot(product, row, pricesLockedByPriceSetting)) {
                throw new AppExceptions.BadRequest(
                        "Цены товара с артикулом "
                                + row.sku()
                                + " изменились после анализа. Загрузите файл повторно");
            }
            if (applyImportValues(
                    product,
                    row,
                    preview.updateAvailabilityAndMadeToOrder(),
                    pricesLockedByPriceSetting)) {
                changedProducts.add(product);
                updated++;
            } else {
                unchanged++;
            }
        }
        if (!changedProducts.isEmpty()) productRepository.saveAll(changedProducts);
        if (!createdProducts.isEmpty()) productRepository.saveAll(createdProducts);

        session.status = PriceImportStatus.COMPLETED;
        session.committedCreated = created;
        session.committedUpdated = updated;
        session.committedUnchanged = unchanged;
        session.committedSkipped = skipped;
        session.completedAt = Instant.now();
        sessionRepository.save(session);
        priceStatisticsService.recordCompletedImport(
                session, previewWithRows(preview, rowsToCommit));
        auditService.record(
                "IMPORT",
                "PRODUCT_PRICE_IMPORT",
                null,
                "Импорт цен "
                        + session.id
                        + ": обновлено "
                        + updated
                        + ", без изменений "
                        + unchanged
                        + ", пропущено "
                        + skipped);
        return new PriceImportCommitDto(
                session.id, session.status.name(), created, updated, unchanged, skipped);
    }

    private List<Row> selectedRows(List<Row> rows, List<Integer> selectedRowIndexes) {
        if (selectedRowIndexes == null) return rows;
        if (selectedRowIndexes.isEmpty()) {
            throw new AppExceptions.BadRequest("Выберите хотя бы одну позицию для импорта");
        }

        Set<Integer> indexes = new LinkedHashSet<>();
        for (Integer index : selectedRowIndexes) {
            if (index == null || index < 0 || index >= rows.size()) {
                throw new AppExceptions.BadRequest("Выбрана несуществующая строка предпросмотра");
            }
            indexes.add(index);
        }
        return indexes.stream().map(rows::get).toList();
    }

    private PriceImportPreviewDto previewWithRows(PriceImportPreviewDto preview, List<Row> rows) {
        return new PriceImportPreviewDto(
                preview.id(),
                preview.fileName(),
                preview.status(),
                preview.createMissingProducts(),
                preview.updateAvailabilityAndMadeToOrder(),
                rows.size(),
                preview.summary(),
                rows,
                preview.sourceFiles());
    }

    private boolean isImportable(Row row) {
        if (row.errors() != null && !row.errors().isEmpty()) return false;
        return CHANGED.equals(row.status())
                || UNCHANGED.equals(row.status())
                || PRICE_SETTING.equals(row.status())
                || TO_CREATE.equals(row.status());
    }

    private Row toPreviewRow(
            PriceImportPythonRunner.SourceRow source,
            Map<String, Long> occurrences,
            Map<String, Product> products,
            boolean createMissingProducts,
            List<String> excludedNameTerms,
            boolean updateAvailabilityAndMadeToOrder,
            Set<Long> productsInPriceSettings) {
        String sku = normalizeSku(source.sku());
        Product product = sku == null ? null : products.get(sku);
        boolean excludedByName = hasExcludedName(source.name(), excludedNameTerms);
        boolean madeToOrder = hasMadeToOrderPrefix(source.name());
        boolean pricesLockedByPriceSetting =
                product != null && productsInPriceSettings.contains(product.id);
        List<String> errors = new ArrayList<>(source.errors());
        if (sku == null) errors.add("Не указан артикул");
        validatePrice("Розничная цена", source.price(), errors);
        validatePrice("Оптовая цена", source.wholesalePrice(), errors);
        validatePrice("Крупнооптовая цена", source.bulkWholesalePrice(), errors);
        validatePrice("Цена СКО", source.skoPrice(), errors);
        validatePrice("Приходная цена", source.incomingPrice(), errors);

        String status;
        if (sku != null && occurrences.getOrDefault(duplicateKey(sku), 0L) > 1) {
            status = DUPLICATE;
            errors.add("Артикул повторяется в файле");
        } else if (!errors.isEmpty()) {
            status = INVALID;
        } else if (product == null && source.missingRetailPrice()) {
            status = NOT_FOUND;
        } else if (product == null && createMissingProducts && !isAsciiNumericSku(sku)) {
            status = INVALID;
            errors.add("Автосоздание доступно только для артикулов из цифр 0-9");
        } else if (product == null && createMissingProducts && sku.length() > 120) {
            status = INVALID;
            errors.add("Артикул не должен превышать 120 символов");
        } else if (product == null && createMissingProducts && source.price() == null) {
            status = INVALID;
            errors.add("Для автосоздания товара необходима розничная цена");
        } else if (product == null) {
            status = createMissingProducts ? TO_CREATE : NOT_FOUND;
        } else if (pricesLockedByPriceSetting) {
            status = PRICE_SETTING;
        } else if (hasChanges(
                product,
                source,
                excludedByName,
                madeToOrder,
                updateAvailabilityAndMadeToOrder,
                false)) {
            status = CHANGED;
        } else {
            status = UNCHANGED;
        }

        Boolean oldActive = product == null ? null : product.active;
        Boolean oldMadeToOrder = product == null ? null : product.madeToOrder;
        Boolean newActive = oldActive;
        Boolean newMadeToOrder = oldMadeToOrder;
        if (product != null
                && updateAvailabilityAndMadeToOrder
                && (CHANGED.equals(status) || UNCHANGED.equals(status) || PRICE_SETTING.equals(status))) {
            if (source.missingRetailPrice() || excludedByName) {
                newActive = false;
            } else {
                newActive = true;
                newMadeToOrder = madeToOrder;
            }
        }

        return new Row(
                source.sourceRow(),
                source.sourceSheet(),
                status,
                sku,
                product != null ? product.nameRu : source.name(),
                product == null ? null : product.price,
                normalizePrice(source.price()),
                product == null ? null : product.wholesalePrice,
                normalizePrice(source.wholesalePrice()),
                product == null ? null : product.bulkWholesalePrice,
                normalizePrice(source.bulkWholesalePrice()),
                product == null ? null : product.skoPrice,
                normalizePrice(source.skoPrice()),
                errors.stream()
                        .filter(error -> error != null && !error.isBlank())
                        .distinct()
                        .toList(),
                product == null ? null : product.nameRu,
                normalizedImportedName(source.name()),
                source.missingRetailPrice(),
                excludedByName,
                product == null ? null : product.incomingPrice,
                normalizePrice(source.incomingPrice()),
                madeToOrder,
                pricesLockedByPriceSetting,
                oldActive,
                oldMadeToOrder,
                newActive,
                newMadeToOrder);
    }

    private Map<String, Long> skuOccurrences(List<PriceImportPythonRunner.SourceRow> rows) {
        return rows.stream()
                .map(PriceImportPythonRunner.SourceRow::sku)
                .map(this::normalizeSku)
                .filter(sku -> sku != null)
                .map(this::duplicateKey)
                .collect(
                        Collectors.groupingBy(
                                Function.identity(), LinkedHashMap::new, Collectors.counting()));
    }

    private List<PriceImportPythonRunner.SourceRow> mergeBatchRows(
            List<BatchFileAnalysis> analyzedFiles) {
        Map<String, BatchRow> rows = new LinkedHashMap<>();
        for (BatchFileAnalysis file : analyzedFiles) {
            for (PriceImportPythonRunner.SourceRow source : file.analysis().rows()) {
                String sku = normalizeSku(source.sku());
                String key =
                        sku == null
                                ? "missing:"
                                        + file.fileName()
                                        + ":"
                                        + source.sourceSheet()
                                        + ":"
                                        + source.sourceRow()
                                : duplicateKey(sku);
                BatchRow merged = rows.get(key);
                if (merged == null) {
                    rows.put(key, new BatchRow(sku, source, file.fileName()));
                } else {
                    merged.merge(source, file.fileName());
                }
            }
        }
        return rows.values().stream().map(BatchRow::toSourceRow).toList();
    }

    private String writeBatchAnalysis(List<BatchFileAnalysis> analyzedFiles) {
        try {
            return objectMapper.writeValueAsString(
                    Map.of(
                            "schemaVersion",
                            1,
                            "batch",
                            true,
                            "files",
                            analyzedFiles.stream()
                                    .map(
                                            file ->
                                                    Map.of(
                                                            "fileName",
                                                            file.fileName(),
                                                            "priceType",
                                                            file.priceType().name(),
                                                            "analysis",
                                                            file.analysis().rawJson()))
                                    .toList()));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Не удалось сохранить анализ пакета прайс-листов", exception);
        }
    }

    private ImportPriceType priceTypeFromFileName(String fileName) {
        String baseName = fileName.replaceFirst("(?i)\\.mxl$", "").toLowerCase(Locale.ROOT);
        if (baseName.contains("приход")) return ImportPriceType.INCOMING;
        if (baseName.contains("крупн") && baseName.contains("оптов")) {
            return ImportPriceType.BULK_WHOLESALE;
        }
        if (baseName.matches(".*(?:^|[._\\-\\s])(?:ско|sko)(?:$|[._\\-\\s]).*")) {
            return ImportPriceType.SKO;
        }
        if (baseName.contains("розниц") || baseName.contains("рознич")) {
            return ImportPriceType.RETAIL;
        }
        if (baseName.contains("оптов")) return ImportPriceType.WHOLESALE;
        return null;
    }

    private static String priceTypeLabel(ImportPriceType priceType) {
        return switch (priceType) {
            case RETAIL -> "розничная";
            case WHOLESALE -> "оптовая";
            case BULK_WHOLESALE -> "крупнооптовая";
            case SKO -> "СКО";
            case INCOMING -> "приходная";
        };
    }

    private Map<String, Product> productsBySku(Set<String> skus) {
        if (skus.isEmpty()) return Map.of();
        return productRepository.findBySkuInAndDeletedAtIsNull(skus).stream()
                .collect(Collectors.toMap(product -> product.sku, Function.identity()));
    }

    private boolean matchesPreviewSnapshot(
            Product product, Row row, boolean pricesLockedByPriceSetting) {
        return (row.newProductName() == null || sameName(product.nameRu, row.oldProductName()))
                && (pricesLockedByPriceSetting
                        || ((row.missingRetailPrice()
                                        ? samePrice(product.price, row.oldPrice())
                                        : row.newPrice() == null
                                                || samePrice(product.price, row.oldPrice()))
                                && (row.newWholesalePrice() == null
                                        || samePrice(
                                                product.wholesalePrice, row.oldWholesalePrice()))
                                && (row.newBulkWholesalePrice() == null
                                        || samePrice(
                                                product.bulkWholesalePrice,
                                                row.oldBulkWholesalePrice()))
                                && (row.newSkoPrice() == null
                                        || samePrice(product.skoPrice, row.oldSkoPrice()))
                                && (row.newIncomingPrice() == null
                                        || samePrice(
                                                product.incomingPrice, row.oldIncomingPrice()))));
    }

    private boolean samePrice(BigDecimal left, BigDecimal right) {
        if (left == null || right == null) return left == right;
        return left.compareTo(right) == 0;
    }

    private boolean hasChanges(
            Product product,
            PriceImportPythonRunner.SourceRow source,
            boolean excludedByName,
            boolean madeToOrder,
            boolean updateAvailabilityAndMadeToOrder,
            boolean pricesLockedByPriceSetting) {
        return hasNameChange(product, source.name())
                || (updateAvailabilityAndMadeToOrder
                        && ((source.missingRetailPrice() && (product.price != null || product.active))
                                || (excludedByName && product.active)
                                || (!source.missingRetailPrice()
                                        && !excludedByName
                                        && (!product.active || product.madeToOrder != madeToOrder))))
                || (!pricesLockedByPriceSetting
                        && (differs(source.price(), product.price)
                                || differs(source.wholesalePrice(), product.wholesalePrice)
                                || differs(source.bulkWholesalePrice(), product.bulkWholesalePrice)
                                || differs(source.skoPrice(), product.skoPrice)
                                || differs(source.incomingPrice(), product.incomingPrice)));
    }

    private boolean applyImportValues(
            Product product, Row row, boolean updateAvailabilityAndMadeToOrder, boolean pricesLockedByPriceSetting) {
        boolean changed = false;
        String importedName = normalizedImportedName(row.newProductName());
        boolean madeToOrder = row.madeToOrder() || hasMadeToOrderPrefix(row.newProductName());
        if (importedName != null && !sameName(product.nameRu, importedName)) {
            product.nameRu = importedName;
            product.nameKk = importedName;
            changed = true;
        }
        if (row.missingRetailPrice()) {
            if (!pricesLockedByPriceSetting && product.price != null) {
                product.price = null;
                changed = true;
            }
            if (updateAvailabilityAndMadeToOrder && product.active) {
                product.active = false;
                changed = true;
            }
        } else if (!pricesLockedByPriceSetting
                && row.newPrice() != null
                && differs(row.newPrice(), product.price)) {
            product.price = row.newPrice();
            changed = true;
        }
        if (updateAvailabilityAndMadeToOrder && row.excludedByName() && product.active) {
            product.active = false;
            changed = true;
        }
        if (updateAvailabilityAndMadeToOrder && !row.missingRetailPrice() && !row.excludedByName()) {
            if (!product.active) {
                product.active = true;
                changed = true;
            }
            if (product.madeToOrder != madeToOrder) {
                product.madeToOrder = madeToOrder;
                changed = true;
            }
        }
        if (!pricesLockedByPriceSetting
                && row.newWholesalePrice() != null
                && differs(row.newWholesalePrice(), product.wholesalePrice)) {
            product.wholesalePrice = row.newWholesalePrice();
            changed = true;
        }
        if (!pricesLockedByPriceSetting
                && row.newBulkWholesalePrice() != null
                && differs(row.newBulkWholesalePrice(), product.bulkWholesalePrice)) {
            product.bulkWholesalePrice = row.newBulkWholesalePrice();
            changed = true;
        }
        if (!pricesLockedByPriceSetting
                && row.newSkoPrice() != null
                && differs(row.newSkoPrice(), product.skoPrice)) {
            product.skoPrice = row.newSkoPrice();
            changed = true;
        }
        if (!pricesLockedByPriceSetting
                && row.newIncomingPrice() != null
                && differs(row.newIncomingPrice(), product.incomingPrice)) {
            product.incomingPrice = row.newIncomingPrice();
            changed = true;
        }
        return changed;
    }

    private boolean hasNameChange(Product product, String sourceName) {
        String importedName = normalizedImportedName(sourceName);
        return importedName != null && !sameName(product.nameRu, importedName);
    }

    private boolean sameName(String left, String right) {
        String normalizedLeft = normalizedImportedName(left);
        String normalizedRight = normalizedImportedName(right);
        return normalizedLeft == null
                ? normalizedRight == null
                : normalizedLeft.equals(normalizedRight);
    }

    private String normalizedImportedName(String value) {
        if (value == null) return null;
        String normalized =
                ARTICLE_MARKER
                        .matcher(MADE_TO_ORDER_PREFIX.matcher(value).replaceFirst(""))
                        .replaceAll("")
                        .trim()
                        .replaceAll("\\s+", " ");
        if (normalized.isBlank()) return null;
        return normalized.length() > 260 ? normalized.substring(0, 260) : normalized;
    }

    private Product createDraftProduct(Row row, UUID importSessionId) {
        Product product = new Product();
        product.sku = row.sku();
        product.createdFromPriceImportId = importSessionId;
        String previewedName =
                row.newProductName() == null ? row.productName() : row.newProductName();
        boolean madeToOrder = row.madeToOrder() || hasMadeToOrderPrefix(previewedName);
        String productName = normalizedImportedName(previewedName);
        if (productName == null) productName = "";
        if (productName.isBlank()) productName = "Товар " + row.sku();
        if (productName.length() > 260) productName = productName.substring(0, 260);
        product.nameRu = productName;
        product.nameKk = productName;
        product.price = row.newPrice();
        product.wholesalePrice = row.newWholesalePrice();
        product.bulkWholesalePrice = row.newBulkWholesalePrice();
        product.skoPrice = row.newSkoPrice();
        product.incomingPrice = row.newIncomingPrice();
        product.categoryId = null;
        product.active = false;
        product.madeToOrder = madeToOrder;
        return product;
    }

    private boolean hasMadeToOrderPrefix(String value) {
        return value != null && MADE_TO_ORDER_PREFIX.matcher(value).find();
    }

    private boolean differs(BigDecimal imported, BigDecimal current) {
        return imported != null && (current == null || imported.compareTo(current) != 0);
    }

    private void validatePrice(String label, BigDecimal value, List<String> errors) {
        if (value == null) return;
        if (value.compareTo(BigDecimal.ZERO) <= 0) {
            errors.add(label + " должна быть больше нуля");
            return;
        }
        BigDecimal normalized = value.stripTrailingZeros();
        if (Math.max(normalized.scale(), 0) > 2
                || normalized.precision() - normalized.scale() > 12) {
            errors.add(label + " должна помещаться в формат 12 целых и 2 дробных знака");
        }
    }

    private BigDecimal normalizePrice(BigDecimal value) {
        return value;
    }

    private Summary summarize(List<Row> rows) {
        return new Summary(
                count(rows, CHANGED),
                count(rows, UNCHANGED),
                count(rows, NOT_FOUND),
                count(rows, TO_CREATE),
                count(rows, INVALID),
                count(rows, DUPLICATE),
                count(rows, PRICE_SETTING));
    }

    private int count(List<Row> rows, String status) {
        return (int) rows.stream().filter(row -> status.equals(row.status())).count();
    }

    private List<String> excludedNameTerms() {
        LinkedHashSet<String> terms = new LinkedHashSet<>(DEFAULT_EXCLUDED_NAME_TERMS);
        List<String> configured = projectSettingsService.priceImportExcludedNameTerms();
        if (configured != null) {
            configured.stream()
                    .filter(term -> term != null && !term.isBlank())
                    .map(term -> term.trim().toLowerCase(Locale.ROOT))
                    .forEach(terms::add);
        }
        return List.copyOf(terms);
    }

    private boolean hasExcludedName(String name, List<String> excludedNameTerms) {
        if (name == null || name.isBlank()) return false;
        String normalizedName = name.toLowerCase(Locale.ROOT);
        return EXCLUDED_NAME_PREFIX.matcher(name).find()
                || excludedNameTerms.stream().anyMatch(normalizedName::contains);
    }

    private String normalizeSku(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        if (normalized.isBlank()) return null;

        if (normalized.chars().allMatch(character -> character >= '0' && character <= '9')) {
            int firstSignificantDigit = 0;
            while (firstSignificantDigit < normalized.length() - 1
                    && normalized.charAt(firstSignificantDigit) == '0') {
                firstSignificantDigit++;
            }
            return normalized.substring(firstSignificantDigit);
        }

        return normalized;
    }

    private boolean isAsciiNumericSku(String sku) {
        return sku != null
                && !sku.isBlank()
                && sku.chars().allMatch(character -> character >= '0' && character <= '9');
    }

    private String duplicateKey(String sku) {
        return sku.toLowerCase(Locale.ROOT);
    }

    private String safeDisplayFileName(String original) {
        String value = original == null ? "prices.xlsx" : original.replace('\\', '/');
        value = value.substring(value.lastIndexOf('/') + 1).trim();
        if (value.isBlank()) return "prices.xlsx";
        return value.length() > 260 ? value.substring(value.length() - 260) : value;
    }

    private String writePreview(PriceImportPreviewDto preview) {
        try {
            return objectMapper.writeValueAsString(preview);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Не удалось сохранить предпросмотр импорта", exception);
        }
    }

    private PriceImportPreviewDto readPreview(String json) {
        try {
            return objectMapper.readValue(json, PriceImportPreviewDto.class);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Предпросмотр импорта повреждён", exception);
        }
    }

    private PriceImportPreviewDto withStatus(
            PriceImportPreviewDto preview, PriceImportStatus status) {
        return new PriceImportPreviewDto(
                preview.id(),
                preview.fileName(),
                status.name(),
                preview.createMissingProducts(),
                preview.updateAvailabilityAndMadeToOrder(),
                preview.totalRows(),
                preview.summary(),
                preview.rows(),
                preview.sourceFiles());
    }

    private PriceImportSession getSession(UUID id) {
        return sessionRepository
                .findById(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Сессия импорта цен не найдена"));
    }

    private PriceImportCommitDto commitResult(PriceImportSession session) {
        return new PriceImportCommitDto(
                session.id,
                session.status.name(),
                valueOrZero(session.committedCreated),
                valueOrZero(session.committedUpdated),
                valueOrZero(session.committedUnchanged),
                valueOrZero(session.committedSkipped));
    }

    private int valueOrZero(Integer value) {
        return value == null ? 0 : value;
    }

    private record BatchFileAnalysis(
            String fileName, ImportPriceType priceType, PriceImportPythonRunner.Analysis analysis) {}

    private static final class BatchRow {
        private final String sku;
        private final int sourceRow;
        private final List<String> sources = new ArrayList<>();
        private final List<String> errors = new ArrayList<>();
        private String name;
        private BigDecimal price;
        private BigDecimal wholesalePrice;
        private BigDecimal bulkWholesalePrice;
        private BigDecimal skoPrice;
        private BigDecimal incomingPrice;
        private boolean missingRetailPrice;

        private BatchRow(String sku, PriceImportPythonRunner.SourceRow source, String fileName) {
            this.sku = sku;
            this.sourceRow = source.sourceRow();
            merge(source, fileName);
        }

        private void merge(PriceImportPythonRunner.SourceRow source, String fileName) {
            sources.add(fileName + " — " + source.sourceSheet() + ":" + source.sourceRow());
            if ((name == null || name.isBlank()) && source.name() != null && !source.name().isBlank()) {
                name = source.name();
            }
            if (source.price() != null) price = source.price();
            if (source.wholesalePrice() != null) wholesalePrice = source.wholesalePrice();
            if (source.bulkWholesalePrice() != null) bulkWholesalePrice = source.bulkWholesalePrice();
            if (source.skoPrice() != null) skoPrice = source.skoPrice();
            if (source.incomingPrice() != null) incomingPrice = source.incomingPrice();
            missingRetailPrice = missingRetailPrice || source.missingRetailPrice();
            if (source.errors() != null) errors.addAll(source.errors());
        }

        private PriceImportPythonRunner.SourceRow toSourceRow() {
            return new PriceImportPythonRunner.SourceRow(
                    String.join(", ", sources),
                    sourceRow,
                    sku,
                    name,
                    price,
                    wholesalePrice,
                    bulkWholesalePrice,
                    skoPrice,
                    missingRetailPrice,
                    errors.stream().filter(error -> error != null && !error.isBlank()).distinct().toList(),
                    incomingPrice);
        }
    }
}
