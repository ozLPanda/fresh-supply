package kz.company.shop.mks;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class MksService {
    private final String login;
    private final String password;
    private final MksTransport transport;
    private final MksParser parser;
    private JsonNode init;
    private Set<String> allowedFilterIds = Set.of();
    private volatile MksDto.Status status;

    @Autowired
    public MksService(
            ObjectMapper mapper,
            MksParser parser,
            @Value("${app.mks.login:}") String login,
            @Value("${app.mks.password:}") String password) {
        this(new MksTransport(mapper), parser, login, password);
    }

    MksService(MksTransport transport, MksParser parser, String login, String password) {
        this.transport = transport;
        this.parser = parser;
        this.login = login;
        this.password = password;
        boolean configured =
                login != null && !login.isBlank() && password != null && !password.isBlank();
        status =
                new MksDto.Status(
                        configured,
                        false,
                        null,
                        configured
                                ? "Подключение ещё не проверено."
                                : "Укажите APP_MKS_LOGIN и APP_MKS_PASSWORD в серверном .env и обновите backend.");
    }

    public MksDto.Status status() {
        return status;
    }

    public synchronized MksDto.Status connect() {
        if (!status.configured()) return status;
        try {
            openSession();
        } catch (MksTransport.Failure e) {
            disconnect(e.getMessage());
        }
        return status;
    }

    public synchronized MksDto.SearchResult search(MksDto.SearchRequest request) {
        if (!status.configured()) throw new AppExceptions.BadRequest(status.message());
        validateRequest(request);
        try {
            if (!status.connected()) openSession();
            for (int attempt = 0; ; attempt++) {
                try {
                    initializeDynamicFilterIds(request);
                    JsonNode response = transport.post("/api/filter/", payload(request));
                    var result = parser.parse(init, response, request);
                    allowedFilterIds =
                            result.filters().stream()
                                    .map(MksDto.Filter::id)
                                    .collect(java.util.stream.Collectors.toSet());
                    return result;
                } catch (MksTransport.Failure e) {
                    if (!e.authentication || attempt > 0) throw e;
                    openSession();
                }
            }
        } catch (MksTransport.Failure e) {
            disconnect(e.getMessage());
            throw new AppExceptions.BadRequest(e.getMessage());
        }
    }

    public synchronized MksDto.ProductDetails product(String id) {
        if (id == null || !id.matches("[1-9][0-9]{0,18}")) {
            throw new AppExceptions.BadRequest("Недопустимый идентификатор товара МКС.");
        }
        if (!status.configured()) throw new AppExceptions.BadRequest(status.message());
        try {
            if (!status.connected()) openSession();
            for (int attempt = 0; ; attempt++) {
                try {
                    return parser.parseProduct(transport.get("/api/product/" + id + "/"), id);
                } catch (MksTransport.Failure e) {
                    if (!e.authentication || attempt > 0) throw e;
                    openSession();
                }
            }
        } catch (MksTransport.Failure e) {
            disconnect(e.getMessage());
            throw new AppExceptions.BadRequest(e.getMessage());
        }
    }

    private void openSession() {
        transport.login(login, password);
        JsonNode loaded = transport.post("/api/filterinit/", Map.of("method", "filterinit"));
        parser.validateInit(loaded);
        init = loaded;
        status = new MksDto.Status(true, true, Instant.now(), "Сессия поставщика открыта.");
    }

    private void initializeDynamicFilterIds(MksDto.SearchRequest request) {
        if (request.filters() == null
                || request.filters().keySet().stream()
                        .noneMatch(
                                key ->
                                        key != null
                                                && (key.startsWith("filter.")
                                                        || key.startsWith("search_range."))
                                                && !allowedFilterIds.contains(key))) return;
        Map<String, Object> staticFilters = new LinkedHashMap<>();
        request.filters()
                .forEach(
                        (key, value) -> {
                            if (key != null
                                    && !key.startsWith("filter.")
                                    && !key.startsWith("search_range."))
                                staticFilters.put(key, value);
                        });
        var baseline = new MksDto.SearchRequest(request.query(), 1, request.size(), staticFilters);
        JsonNode response = transport.post("/api/filter/", payload(baseline));
        allowedFilterIds =
                parser.parse(init, response, baseline).filters().stream()
                        .map(MksDto.Filter::id)
                        .collect(java.util.stream.Collectors.toSet());
    }

    private void disconnect(String message) {
        transport.clearSession();
        init = null;
        status = new MksDto.Status(status.configured(), false, status.lastConnectedAt(), message);
    }

    private void validateRequest(MksDto.SearchRequest request) {
        if (request.page() < 1
                || request.page() > 10000
                || request.size() < 10
                || request.size() > 100
                || (request.query() != null && request.query().length() > 250)) {
            throw new AppExceptions.BadRequest("Недопустимые параметры поиска МКС.");
        }
        if (request.filters() != null && request.filters().size() > 100) {
            throw new AppExceptions.BadRequest("Слишком много фильтров МКС.");
        }
    }

    Map<String, Object> payload(MksDto.SearchRequest request) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("method", "filter");
        result.put("origin", "catalog");
        result.put("catalog", "0");
        result.put("available", false);
        result.put("novelty", false);
        for (String key : List.of("brand", "batch", "action")) result.put(key, "0");
        result.put("model", "");
        result.put("warehouse", 0);
        result.put("perpage", Integer.toString(request.size()));
        result.put("page", request.page());
        result.put("query", request.query() == null ? "" : request.query().strip());
        result.put("byprice", 0);
        result.put("minprice", false);
        result.put("maxprice", false);
        Map<String, Object> sorting = new LinkedHashMap<>();
        sorting.put("field", null);
        sorting.put("sort", null);
        result.put("sorting", sorting);
        result.put("tags", List.of());
        Map<String, Object> fields = new LinkedHashMap<>();
        Map<String, Object> ranges = new LinkedHashMap<>();
        result.put("filter", List.of());
        result.put("search_range", List.of());
        if (request.filters() == null) return result;
        Set<String> staticKeys =
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
        for (var entry : request.filters().entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (key == null || (!staticKeys.contains(key) && !allowedFilterIds.contains(key))) {
                throw new AppExceptions.BadRequest("Неизвестный фильтр МКС.");
            }
            if (value == null || "".equals(value)) continue;
            boolean boundedList =
                    key.startsWith("filter.")
                            && value instanceof List<?> values
                            && values.size() <= 50
                            && values.stream()
                                    .allMatch(
                                            item ->
                                                    item instanceof String string
                                                            && string.length() <= 250);
            if (!boundedList
                    && (!(value instanceof String
                                    || value instanceof Number
                                    || value instanceof Boolean)
                            || value.toString().length() > 250))
                throw new AppExceptions.BadRequest("Недопустимое значение фильтра МКС.");
            if (key.startsWith("search_range.")) {
                String[] parts = key.split("\\.");
                if (parts.length != 3
                        || !MksParser.validKey(parts[1])
                        || !Set.of("from", "to").contains(parts[2]))
                    throw new AppExceptions.BadRequest("Недопустимый диапазон МКС.");
                @SuppressWarnings("unchecked")
                Map<String, Object> range =
                        (Map<String, Object>)
                                ranges.computeIfAbsent(parts[1], ignored -> new LinkedHashMap<>());
                range.put(parts[2], number(value));
                result.put("search_range", ranges);
            } else if (key.startsWith("filter.")) {
                String field = key.substring(7);
                if (!MksParser.validKey(field))
                    throw new AppExceptions.BadRequest("Недопустимая характеристика МКС.");
                fields.put(field, value);
                result.put("filter", fields);
            } else if (key.equals("available") || key.equals("novelty")) {
                if (!(value instanceof Boolean))
                    throw new AppExceptions.BadRequest("Недопустимый переключатель МКС.");
                result.put(key, value);
            } else if (key.equals("minprice") || key.equals("maxprice")) {
                result.put(key, number(value));
                result.put("byprice", 1);
            } else if (key.equals("sorting")) {
                String[] parts = value.toString().split("-");
                if (parts.length != 2
                        || !Set.of("model", "header", "price").contains(parts[0])
                        || !Set.of("asc", "desc").contains(parts[1]))
                    throw new AppExceptions.BadRequest("Недопустимая сортировка МКС.");
                result.put("sorting", Map.of("field", parts[0], "sort", parts[1]));
            } else {
                result.put(key, value.toString());
            }
        }
        return result;
    }

    private BigDecimal number(Object value) {
        try {
            BigDecimal number = new BigDecimal(value.toString());
            if (number.signum() < 0 || number.precision() > 15 || Math.abs(number.scale()) > 8)
                throw new NumberFormatException();
            return number;
        } catch (NumberFormatException e) {
            throw new AppExceptions.BadRequest("Недопустимое числовое значение фильтра МКС.");
        }
    }
}
