package kz.company.shop.mks;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.jsoup.Jsoup;
import org.springframework.stereotype.Component;

/** Maps the authenticated MKS protocol to a catalog-only DTO. */
@Component
public class MksParser {
    public void validateInit(JsonNode init) {
        if (!init.has("catalog_tree") || !init.get("catalog_tree").isContainerNode()) {
            throw schemaFailure();
        }
    }

    public MksDto.SearchResult parse(
            JsonNode init, JsonNode response, MksDto.SearchRequest request) {
        JsonNode envelope = response.path("products");
        JsonNode data = envelope.has("data") ? envelope.path("data") : envelope;
        if (!data.isContainerNode()) throw schemaFailure();
        List<MksDto.Product> products = new ArrayList<>();
        collectProducts(data, products, 0);
        if (!data.isEmpty() && products.isEmpty()) throw schemaFailure();
        List<String> warnings = new ArrayList<>();
        Map<String, MksDto.Filter> filters = new LinkedHashMap<>();
        addOptions(filters, "catalog", "Категория", init.path("catalog_tree"), warnings);
        addOptions(filters, "brand", "Бренд", response.path("brands").path("data"), warnings);
        addOptions(filters, "batch", "Серия", response.path("batches").path("data"), warnings);
        addOptions(filters, "model", "Линейка", response.path("models").path("data"), warnings);
        JsonNode warehouses =
                response.has("actualWms") ? response.path("actualWms") : init.path("warehouses");
        addOptions(filters, "warehouse", "Склад", warehouses, warnings);
        JsonNode actions =
                response.has("actions") ? response.path("actions") : init.path("actions");
        addOptions(filters, "action", "Акция", actions, warnings);
        add(filters, "available", "В наличии у поставщика", "boolean", List.of());
        add(filters, "novelty", "Новинки", "boolean", List.of());
        add(filters, "minprice", "Цена от", "number", List.of());
        add(filters, "maxprice", "Цена до", "number", List.of());
        add(
                filters,
                "sorting",
                "Сортировка",
                "select",
                List.of(
                        new MksDto.Option("model-asc", "Артикул: по возрастанию"),
                        new MksDto.Option("model-desc", "Артикул: по убыванию"),
                        new MksDto.Option("header-asc", "Название: А–Я"),
                        new MksDto.Option("header-desc", "Название: Я–А"),
                        new MksDto.Option("price-asc", "Цена: по возрастанию"),
                        new MksDto.Option("price-desc", "Цена: по убыванию")));
        JsonNode params = response.path("params");
        for (JsonNode descriptor : params.path("params_vars")) {
            String id = text(descriptor, "id");
            String label = text(descriptor, "header");
            if (id == null || !validKey(id) || label == null) continue;
            JsonNode values = params.path("params_vals").path(id);
            Map<String, String> options = new LinkedHashMap<>();
            if (collectOptions(values, options, "", 0) && !options.isEmpty()) {
                add(filters, "filter." + id, label, "select", optionList(options));
            } else if (!values.isEmpty()) {
                warnings.add("Не удалось прочитать значения характеристики «" + label + "».");
            }
        }
        Map<String, String> rangeLabels = new LinkedHashMap<>();
        for (JsonNode descriptor : params.path("simple_params")) {
            String id = text(descriptor, "id");
            String label = text(descriptor, "header");
            if (id != null && label != null) rangeLabels.put(id, label);
        }
        JsonNode maxmin = params.path("maxmin");
        if (maxmin.isObject()) {
            maxmin.fields()
                    .forEachRemaining(
                            entry -> {
                                String key = entry.getKey();
                                if (!validKey(key)) return;
                                String label = rangeLabels.get(key);
                                if (label == null) label = text(entry.getValue(), "header");
                                // Unknown names are not exposed as technical numeric IDs in the
                                // user interface.
                                if (label == null) return;
                                add(
                                        filters,
                                        "search_range." + key + ".from",
                                        label + ": от",
                                        "number",
                                        List.of());
                                add(
                                        filters,
                                        "search_range." + key + ".to",
                                        label + ": до",
                                        "number",
                                        List.of());
                            });
        }
        JsonNode pagination = envelope.path("pagination");
        Long total = nonnegativeLong(pagination.path("total"));
        if (total == null) total = nonnegativeLong(envelope.path("count"));
        boolean inconsistentCount =
                total != null
                        && !products.isEmpty()
                        && total < (long) (request.page() - 1) * request.size() + products.size();
        if (inconsistentCount) {
            total = null;
            warnings.add(
                    "МКС передал неточное общее количество товаров. Переход между страницами доступен по размеру выборки.");
        }
        Integer totalPages = null;
        if (total != null) {
            long pages = (total + request.size() - 1) / request.size();
            totalPages = (int) Math.min(Integer.MAX_VALUE, Math.max(1, pages));
        }
        boolean hasMore;
        if (inconsistentCount) {
            hasMore = products.size() >= request.size();
        } else if (pagination.has("next")) {
            JsonNode next = pagination.path("next");
            hasMore =
                    next.isBoolean()
                            ? next.asBoolean()
                            : next.canConvertToInt() && next.asInt() > request.page();
        } else if (total != null) {
            hasMore = (long) request.page() * request.size() < total;
        } else {
            hasMore = products.size() >= request.size();
            warnings.add(
                    "МКС не передал общее количество товаров; следующая страница определяется по размеру выборки.");
        }
        warnings.add(
                "Остатки МКС обновляются на утро и могут меняться в течение дня. Уточните цену и наличие перед подтверждением заказа.");
        return new MksDto.SearchResult(
                List.copyOf(products),
                request.page(),
                request.size(),
                total,
                totalPages,
                hasMore,
                List.copyOf(filters.values()),
                List.copyOf(warnings));
    }

    private void collectProducts(JsonNode node, List<MksDto.Product> result, int depth) {
        if (depth > 6 || result.size() > 1000) throw schemaFailure();
        if (node.isObject() && node.has("id")) {
            String id = text(node, "id");
            String name = text(node, "header");
            if (id == null || name == null) throw schemaFailure();
            BigDecimal remains = price(node.path("remains"));
            String availability =
                    remains == null
                            ? null
                            : remains.signum() > 0
                                    ? "В наличии: " + remains.stripTrailingZeros().toPlainString()
                                    : "Нет в наличии";
            String picture = text(node, "picture");
            String type = text(node, "picturetype");
            String image =
                    picture != null
                                    && picture.matches("[1-9][0-9]{0,18}")
                                    && type != null
                                    && type.matches("(?i)jpg|jpeg|png|webp|gif")
                            ? MksTransport.SUPPLIER + "/dbpics/" + picture + "-50." + type
                            : null;
            String sku = text(node, "articul");
            result.add(
                    new MksDto.Product(
                            id,
                            sku == null ? "" : sku,
                            name,
                            text(node, "brand"),
                            text(node, "model"),
                            price(node.path("price")),
                            availability,
                            null,
                            image,
                            null));
            return;
        }
        if (!node.isContainerNode()) throw schemaFailure();
        for (JsonNode child : node) collectProducts(child, result, depth + 1);
    }

    public MksDto.ProductDetails parseProduct(JsonNode node, String requestedId) {
        if (!node.isObject() || !requestedId.equals(text(node, "id"))) throw schemaFailure();
        var products = new ArrayList<MksDto.Product>();
        collectProducts(node, products, 0);
        var images = new LinkedHashSet<String>();
        String mainImage = fullImage(text(node, "picture"), text(node, "picturetype"));
        if (mainImage != null) images.add(mainImage);
        if (node.path("images").isArray()) {
            for (JsonNode image : node.path("images")) {
                String url = fullImage(text(image, "image_id"), text(image, "type"));
                if (url != null) images.add(url);
                if (images.size() >= 20) break;
            }
        }
        var characteristics = new ArrayList<MksDto.Characteristic>();
        if (node.path("params").isObject()) {
            for (JsonNode param : node.path("params")) {
                String name = plainText(param, "header");
                String value = plainText(param, "value");
                if (name != null && value != null) {
                    characteristics.add(new MksDto.Characteristic(name, value));
                }
                if (characteristics.size() >= 100) break;
            }
        }
        String description = plainText(node, "descript");
        if (description == null) description = plainText(node, "body");
        return new MksDto.ProductDetails(
                products.getFirst(),
                text(node, "barcode"),
                price(node.path("price_rrc")),
                price(node.path("price_mrc")),
                text(node, "batch"),
                text(node, "min_count"),
                text(node, "inner_count"),
                text(node, "outer_count"),
                List.copyOf(images),
                List.copyOf(characteristics),
                description,
                plainText(node, "advantages"),
                plainText(node, "usage"));
    }

    private String fullImage(String id, String type) {
        return id != null
                        && id.matches("[1-9][0-9]{0,18}")
                        && type != null
                        && type.matches("(?i)jpg|jpeg|png|webp|gif")
                ? MksTransport.SUPPLIER + "/dbpics/" + id + "." + type
                : null;
    }

    private String plainText(JsonNode node, String field) {
        JsonNode value = node.path(field);
        if (!value.isTextual() && !value.isNumber()) return null;
        String source = value.asText();
        source = source.substring(0, Math.min(source.length(), 30000));
        var document = Jsoup.parse(source);
        document.select("script,style").remove();
        document.select("p,div,li,tr,h1,h2,h3,h4,h5,h6").forEach(element -> element.appendText("\n"));
        String result = document.body().wholeText()
                .replace('\u00a0', ' ')
                .replaceAll("[\\t ]+", " ")
                .replaceAll(" *\n *", "\n")
                .replaceAll("\n{3,}", "\n\n")
                .strip();
        return result.isEmpty() ? null : result;
    }

    private void addOptions(
            Map<String, MksDto.Filter> filters,
            String id,
            String label,
            JsonNode source,
            List<String> warnings) {
        if (source.isMissingNode() || source.isNull() || source.isEmpty()) return;
        Map<String, String> options = new LinkedHashMap<>();
        boolean understood = collectOptions(source, options, "", 0);
        if (!options.isEmpty()) add(filters, id, label, "select", optionList(options));
        if (!understood)
            warnings.add("Часть значений фильтра «" + label + "» имеет неподдерживаемый формат.");
    }

    private List<MksDto.Option> optionList(Map<String, String> options) {
        return options.entrySet().stream()
                .map(entry -> new MksDto.Option(entry.getKey(), entry.getValue()))
                .toList();
    }

    private boolean collectOptions(
            JsonNode node, Map<String, String> result, String key, int depth) {
        if (depth > 6 || result.size() > 2000) return false;
        if (node.isObject()) {
            String label = text(node, "header");
            if (label == null) label = text(node, "name");
            String id = text(node, "id");
            if (id == null && !key.isBlank()) id = key;
            if (label != null && id != null) result.putIfAbsent(id, label);
            boolean understood = label != null;
            var fields = node.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                if (field.getValue().isContainerNode()) {
                    understood |=
                            collectOptions(field.getValue(), result, field.getKey(), depth + 1);
                } else if (label == null && field.getValue().isTextual()) {
                    result.putIfAbsent(field.getKey(), field.getValue().asText());
                    understood = true;
                }
            }
            return understood || node.isEmpty();
        }
        if (node.isArray()) {
            boolean understood = true;
            for (var child : node) understood &= collectOptions(child, result, "", depth + 1);
            return understood;
        }
        return false;
    }

    private void add(
            Map<String, MksDto.Filter> target,
            String id,
            String label,
            String type,
            List<MksDto.Option> options) {
        target.put(id, new MksDto.Filter(id, label, type, options));
    }

    static boolean validKey(String key) {
        return key.matches("[A-Za-z0-9_-]{1,80}");
    }

    private String text(JsonNode source, String field) {
        JsonNode value = source.path(field);
        if (!value.isValueNode() || value.isNull() || value.isBoolean()) return null;
        String text = value.asText().strip();
        return text.isEmpty() ? null : text.substring(0, Math.min(text.length(), 1000));
    }

    private Long nonnegativeLong(JsonNode value) {
        if (value.isBoolean() || value.isNull() || value.isMissingNode()) return null;
        try {
            long number = Long.parseLong(value.asText());
            return number >= 0 && number <= 1000000000L ? number : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private BigDecimal price(JsonNode value) {
        if (!value.isNumber() && !value.isTextual()) return null;
        String text = value.asText().replace(" ", "").replace("\u00a0", "").replace(",", ".");
        if (text.length() > 30) return null;
        try {
            BigDecimal result = new BigDecimal(text);
            return result.signum() >= 0 && result.precision() <= 20 && Math.abs(result.scale()) <= 8
                    ? result
                    : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private MksTransport.Failure schemaFailure() {
        return new MksTransport.Failure(
                false,
                "Формат каталога МКС отличается от ожидаемого. Требуется сверка адаптера с авторизованным каталогом.");
    }
}
