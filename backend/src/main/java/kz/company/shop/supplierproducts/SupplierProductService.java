package kz.company.shop.supplierproducts;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.mks.MksDto;
import kz.company.shop.mks.MksService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SupplierProductService {
    private static final Set<String> STATIC_FILTERS =
            Set.of(
                    "catalog",
                    "brand",
                    "batch",
                    "model",
                    "action",
                    "warehouse",
                    "available",
                    "novelty",
                    "minprice",
                    "maxprice",
                    "sorting");
    private final SupplierProductRepository repository;
    private final MksService mks;

    public SupplierProductService(SupplierProductRepository repository, MksService mks) {
        this.repository = repository;
        this.mks = mks;
    }

    public SupplierProductDto.ProductPage products(
            String supplier, String query, int page, int size, String sort, String direction) {
        if (page < 1 || page > 10000 || size < 1 || size > 100)
            throw invalid("Недопустимые параметры страницы.");
        if (supplier != null && !supplier.isBlank() && !supplier.equals("mks"))
            throw invalid("Неизвестный поставщик.");
        if (query != null && query.length() > 250)
            throw invalid("Слишком длинный поисковый запрос.");
        var columns =
                Map.of(
                        "name",
                        "name",
                        "sku",
                        "sku",
                        "supplierName",
                        "supplier_code",
                        "brand",
                        "brand",
                        "purchasePrice",
                        "purchase_price",
                        "retailPrice",
                        "retail_price",
                        "syncedAt",
                        "synced_at");
        if (!columns.containsKey(sort) || !Set.of("asc", "desc").contains(direction))
            throw invalid("Недопустимая сортировка.");
        return repository.products(
                supplier == null ? "" : supplier.strip(),
                query == null ? "" : query.strip(),
                page,
                size,
                columns.get(sort),
                direction);
    }

    public SupplierProductDto.Product product(long id) {
        return repository.product(id);
    }

    public List<SupplierProductDto.ImportJob> imports() {
        return repository.imports();
    }

    public SupplierProductDto.SyncStatus syncStatus() {
        return repository.syncStatus();
    }

    @Transactional
    public SupplierProductDto.ImportJob createImport(SupplierProductDto.ImportRequest request) {
        var selection = validate(request);
        long id = repository.create(selection, false);
        if (selection.scope().equals("SELECTED")) repository.enqueue(id, selection.productIds());
        repository.recount(id);
        return repository.job(id);
    }

    @Transactional
    public SupplierProductDto.ImportJob retry(long id) {
        return repository.retry(id);
    }

    SupplierProductDto.ImportRequest validate(SupplierProductDto.ImportRequest request) {
        if (request == null || !"mks".equals(request.supplierCode()))
            throw invalid("Неизвестный поставщик.");
        if (request.scope() == null
                || !Set.of("ALL", "FILTERED", "SELECTED").contains(request.scope()))
            throw invalid("Недопустимый режим импорта.");
        String query = request.query() == null ? "" : request.query().strip();
        if (query.length() > 250) throw invalid("Слишком длинный поисковый запрос.");
        Map<String, Object> filters = validateFilters(request.filters());
        var ids = request.productIds() == null ? List.<String>of() : request.productIds();
        if (ids.size() > 1000) throw invalid("Выберите не более 1000 товаров за один импорт.");
        for (String id : ids)
            if (id == null || !id.matches("[1-9][0-9]{0,18}"))
                throw invalid("Недопустимый идентификатор товара МКС.");
        var categories = request.categoryIds() == null ? List.<String>of() : request.categoryIds();
        if (categories.size() > 100)
            throw invalid("Выберите не более 100 категорий за один импорт.");
        for (String category : categories)
            if (category == null || !category.matches("[0-9]{1,19}"))
                throw invalid("Недопустимая категория МКС.");
        if (request.scope().equals("SELECTED")
                && (ids.isEmpty()
                        || !query.isEmpty()
                        || !filters.isEmpty()
                        || !categories.isEmpty()))
            throw invalid("Для импорта выбранных товаров передайте только идентификаторы.");
        if (!request.scope().equals("SELECTED") && !ids.isEmpty())
            throw invalid("Идентификаторы товаров допустимы только для выбранных товаров.");
        if (request.scope().equals("ALL")
                && (!query.isEmpty() || !filters.isEmpty() || !categories.isEmpty()))
            throw invalid("Импорт всего каталога не должен содержать фильтры.");
        return new SupplierProductDto.ImportRequest(
                "mks",
                request.scope(),
                new ArrayList<>(new LinkedHashSet<>(ids)),
                query,
                filters,
                new ArrayList<>(new LinkedHashSet<>(categories)));
    }

    private Map<String, Object> validateFilters(Map<String, Object> supplied) {
        if (supplied == null) return Map.of();
        if (supplied.size() > 100) throw invalid("Слишком много фильтров МКС.");
        Map<String, Object> result = new LinkedHashMap<>();
        for (var entry : supplied.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (key == null
                    || !(STATIC_FILTERS.contains(key)
                            || key.matches("filter\\.[A-Za-z0-9_-]{1,80}")
                            || key.matches("search_range\\.[A-Za-z0-9_-]{1,80}\\.(from|to)")))
                throw invalid("Неизвестный фильтр МКС.");
            if (value == null || "".equals(value)) continue;
            if (key.startsWith("filter.") && value instanceof List<?> list) {
                if (list.size() > 50
                        || list.stream()
                                .anyMatch(v -> !(v instanceof String text) || text.length() > 250))
                    throw invalid("Недопустимое значение фильтра МКС.");
                result.put(key, List.copyOf(list));
                continue;
            }
            if (!(value instanceof String || value instanceof Number || value instanceof Boolean)
                    || value.toString().length() > 250)
                throw invalid("Недопустимое значение фильтра МКС.");
            if (Set.of("available", "novelty").contains(key) && !(value instanceof Boolean))
                throw invalid("Недопустимый переключатель МКС.");
            if (key.equals("sorting")
                    && !value.toString().matches("(model|header|price)-(asc|desc)"))
                throw invalid("Недопустимая сортировка МКС.");
            if (Set.of("minprice", "maxprice").contains(key) || key.startsWith("search_range.")) {
                try {
                    BigDecimal n = new BigDecimal(value.toString());
                    if (n.signum() < 0 || n.precision() > 15 || Math.abs(n.scale()) > 8)
                        throw new NumberFormatException();
                } catch (NumberFormatException ex) {
                    throw invalid("Недопустимое числовое значение фильтра МКС.");
                }
            }
            result.put(key, value);
        }
        return result;
    }

    private AppExceptions.BadRequest invalid(String message) {
        return new AppExceptions.BadRequest(message);
    }

    @Scheduled(
            fixedDelayString = "${app.supplier-products.worker-delay-ms:10000}",
            initialDelayString = "${app.supplier-products.worker-initial-delay-ms:15000}",
            scheduler = "supplierImportScheduler")
    @Transactional
    public void tick() {
        if (!repository.lockWorker()) return;
        // All cursor/item writes commit together. A crash rolls the tick back; remote calls only
        // read.
        var due = repository.dueProducts();
        if (!due.isEmpty()) {
            long id =
                    repository.create(
                            new SupplierProductDto.ImportRequest(
                                    "mks", "SELECTED", due, "", Map.of(), List.of()),
                            true);
            repository.enqueue(id, due);
            repository.recount(id);
        }
        var jobs = repository.work();
        if (jobs.isEmpty()) return;
        var work = jobs.getFirst();
        if (!work.discoveryDone() && !work.nextDiscoveryAt().isAfter(Instant.now())) {
            try {
                discover(work);
            } catch (RuntimeException exception) {
                repository.discoveryFailed(work);
                repository.recount(work.id());
                return;
            }
        }
        for (var item : repository.items(work.id())) {
            MksDto.ProductDetails details;
            try {
                details = mks.product(item.externalId());
                if (details == null
                        || details.product() == null
                        || details.product().name() == null
                        || details.product().name().isBlank()
                        || !item.externalId().equals(details.product().id()))
                    throw invalid("МКС вернул некорректную карточку товара.");
            } catch (RuntimeException exception) {
                repository.itemFailed(item);
                continue;
            }
            // Database failures must roll back the transaction, rather than masquerade as supplier
            // errors.
            repository.upsert(item.externalId(), details);
            repository.itemCompleted(item.id());
        }
        repository.finish(work.id());
    }

    private void discover(SupplierProductRepository.Work work) {
        var selection = work.selection();
        var filters = new LinkedHashMap<>(selection.filters());
        List<String> categories = selection.categoryIds();
        if (!categories.isEmpty()) filters.put("catalog", categories.get(work.categoryIndex()));
        var result =
                mks.search(new MksDto.SearchRequest(selection.query(), work.page(), 100, filters));
        if (result == null || result.items() == null)
            throw invalid("МКС вернул некорректную страницу каталога.");
        List<String> ids = result.items().stream().map(MksDto.Product::id).toList();
        for (String id : ids)
            if (id == null || !id.matches("[1-9][0-9]{0,18}"))
                throw invalid("МКС вернул некорректный идентификатор.");
        String fingerprint = fingerprint(ids);
        if (!ids.isEmpty() && fingerprint.equals(work.fingerprint()))
            throw invalid("МКС повторяет страницу каталога.");
        // A provider's displayed total/hasMore may underestimate its catalog. Verify a short/empty
        // page.
        boolean categoryDone = ids.size() < 100;
        boolean done =
                categoryDone
                        && (categories.isEmpty() || work.categoryIndex() + 1 >= categories.size());
        if (!categoryDone && work.page() >= 10000)
            throw invalid("Достигнут предел страниц каталога. Уточните фильтры.");
        repository.enqueue(work.id(), ids);
        int nextCategory = categoryDone && !done ? work.categoryIndex() + 1 : work.categoryIndex();
        repository.discovery(
                work.id(),
                categoryDone ? 1 : work.page() + 1,
                nextCategory,
                categoryDone ? null : fingerprint,
                done);
    }

    private String fingerprint(List<String> ids) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(
                                            String.join(",", ids)
                                                    .getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
