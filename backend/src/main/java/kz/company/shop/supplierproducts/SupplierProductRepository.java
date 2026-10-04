package kz.company.shop.supplierproducts;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.mks.MksDto;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SupplierProductRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public SupplierProductRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    record Work(
            long id,
            String scope,
            SupplierProductDto.ImportRequest selection,
            int page,
            boolean discoveryDone,
            int discoveryAttempts,
            Instant nextDiscoveryAt,
            int categoryIndex,
            String fingerprint) {}

    record Item(long id, String externalId, int attempts) {}

    String json(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot serialize supplier data", e);
        }
    }

    private <T> T parse(String json, Class<T> type) {
        try {
            return mapper.readValue(json, type);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Invalid persisted supplier data", e);
        }
    }

    static Instant instant(ResultSet row, String name) throws SQLException {
        Timestamp value = row.getTimestamp(name);
        return value == null ? null : value.toInstant();
    }

    private SupplierProductDto.Product productRow(ResultSet row, int index) throws SQLException {
        var details = parse(row.getString("details"), MksDto.ProductDetails.class);
        return new SupplierProductDto.Product(
                row.getLong("id"),
                row.getString("supplier_code"),
                "МКС",
                row.getString("external_id"),
                row.getString("sku"),
                row.getString("name"),
                row.getString("description"),
                row.getString("image_url"),
                details.images() == null ? List.of() : details.images(),
                row.getBigDecimal("purchase_price"),
                row.getBigDecimal("retail_price"),
                row.getString("brand"),
                row.getString("availability"),
                details,
                instant(row, "synced_at"));
    }

    private SupplierProductDto.ImportJob jobRow(ResultSet row, int index) throws SQLException {
        return new SupplierProductDto.ImportJob(
                row.getLong("id"),
                row.getString("supplier_code"),
                "МКС",
                row.getString("scope"),
                row.getString("status"),
                row.getLong("discovered"),
                row.getLong("processed"),
                row.getLong("failed"),
                row.getLong("pending"),
                row.getString("error"),
                instant(row, "created_at"),
                instant(row, "updated_at"));
    }

    SupplierProductDto.ProductPage products(
            String supplier, String query, int page, int size, String column, String direction) {
        String where =
                " where (? = '' or supplier_code = ?) and (? = '' or name ilike ? escape '!' or sku ilike ? escape '!' or external_id ilike ? escape '!')";
        String pattern = "%" + query.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
        Object[] filters = {supplier, supplier, query, pattern, pattern, pattern};
        long total =
                jdbc.queryForObject(
                        "select count(*) from supplier_products" + where, Long.class, filters);
        var items =
                jdbc.query(
                        "select * from supplier_products"
                                + where
                                + " order by "
                                + column
                                + " "
                                + direction
                                + " nulls last, id desc limit ? offset ?",
                        this::productRow,
                        supplier,
                        supplier,
                        query,
                        pattern,
                        pattern,
                        pattern,
                        size,
                        (page - 1) * size);
        return new SupplierProductDto.ProductPage(
                items, page, size, total, (total + size - 1) / size);
    }

    SupplierProductDto.Product product(long id) {
        return jdbc
                .query("select * from supplier_products where id = ?", this::productRow, id)
                .stream()
                .findFirst()
                .orElseThrow(() -> new AppExceptions.NotFound("Товар поставщика не найден."));
    }

    List<SupplierProductDto.ImportJob> imports() {
        return jdbc.query(
                "select * from supplier_import_jobs where status in ('QUEUED', 'DISCOVERING', 'RUNNING') or id in (select id from supplier_import_jobs where status in ('COMPLETED', 'FAILED') order by id desc limit 20) order by id desc",
                this::jobRow);
    }

    SupplierProductDto.ImportJob job(long id) {
        return jdbc
                .query("select * from supplier_import_jobs where id = ?", this::jobRow, id)
                .stream()
                .findFirst()
                .orElseThrow(() -> new AppExceptions.NotFound("Задание импорта не найдено."));
    }

    long create(SupplierProductDto.ImportRequest selection, boolean automatic) {
        return jdbc.queryForObject(
                """
                insert into supplier_import_jobs(supplier_code, scope, status, selection, discovery_done, automatic)
                values ('mks', ?, 'QUEUED', ?::jsonb, ?, ?) returning id
                """,
                Long.class,
                selection.scope(),
                json(selection),
                selection.scope().equals("SELECTED"),
                automatic);
    }

    void enqueue(long jobId, List<String> ids) {
        for (String id : ids)
            jdbc.update(
                    "insert into supplier_import_items(job_id, external_id) values (?, ?) on conflict do nothing",
                    jobId,
                    id);
    }

    void recount(long id) {
        jdbc.update(
                """
                update supplier_import_jobs j set discovered = c.total, processed = c.completed,
                    failed = c.failed, pending = c.pending, updated_at = now()
                from (select count(*) total, count(*) filter (where status = 'COMPLETED') completed,
                    count(*) filter (where status = 'FAILED') failed,
                    count(*) filter (where status = 'PENDING') pending
                    from supplier_import_items where job_id = ?) c where j.id = ?
                """,
                id,
                id);
    }

    boolean lockWorker() {
        return Boolean.TRUE.equals(
                jdbc.queryForObject("select pg_try_advisory_xact_lock(74712501)", Boolean.class));
    }

    List<Work> work() {
        return jdbc.query(
                """
                select * from supplier_import_jobs where status in ('QUEUED', 'DISCOVERING', 'RUNNING')
                  and ((not discovery_done and next_discovery_at <= now())
                    or exists (select 1 from supplier_import_items i where i.job_id = supplier_import_jobs.id
                      and i.status = 'PENDING' and i.next_attempt_at <= now())
                    or (discovery_done and pending = 0))
                order by updated_at, id limit 1 for update skip locked
                """,
                (row, i) ->
                        new Work(
                                row.getLong("id"),
                                row.getString("scope"),
                                parse(
                                        row.getString("selection"),
                                        SupplierProductDto.ImportRequest.class),
                                row.getInt("discovery_page"),
                                row.getBoolean("discovery_done"),
                                row.getInt("discovery_attempts"),
                                instant(row, "next_discovery_at"),
                                row.getInt("discovery_category"),
                                row.getString("discovery_fingerprint")));
    }

    List<Item> items(long jobId) {
        return jdbc.query(
                """
                select * from supplier_import_items where job_id = ? and status = 'PENDING'
                  and next_attempt_at <= now() order by id limit 3 for update skip locked
                """,
                (row, index) ->
                        new Item(
                                row.getLong("id"),
                                row.getString("external_id"),
                                row.getInt("attempts")),
                jobId);
    }

    void discovery(long jobId, int nextPage, int categoryIndex, String fingerprint, boolean done) {
        jdbc.update(
                """
                update supplier_import_jobs set discovery_page = ?, discovery_category = ?, discovery_fingerprint = ?, discovery_done = ?, discovery_attempts = 0,
                    next_discovery_at = now(), error = null, status = ?, updated_at = now() where id = ?
                """,
                nextPage,
                categoryIndex,
                fingerprint,
                done,
                done ? "RUNNING" : "DISCOVERING",
                jobId);
    }

    void discoveryFailed(Work work) {
        int attempts = work.discoveryAttempts() + 1;
        jdbc.update(
                """
                update supplier_import_jobs set discovery_attempts = ?, next_discovery_at = now() + (? * interval '1 second'),
                  status = ?, error = ?, updated_at = now() where id = ?
                """,
                attempts,
                retrySeconds(attempts),
                attempts >= 3 ? "FAILED" : "DISCOVERING",
                "Не удалось получить страницу каталога МКС. Проверьте подключение и повторите импорт.",
                work.id());
    }

    static int retrySeconds(int attempt) {
        return 30 * (1 << Math.min(attempt - 1, 4));
    }

    void itemCompleted(long id) {
        jdbc.update(
                "update supplier_import_items set status = 'COMPLETED', error = null, attempts = attempts + 1 where id = ?",
                id);
    }

    void itemFailed(Item item) {
        int attempts = item.attempts() + 1;
        jdbc.update(
                """
                update supplier_import_items set status = ?, attempts = ?, error = ?,
                    next_attempt_at = now() + (? * interval '1 second') where id = ?
                """,
                attempts >= 3 ? "FAILED" : "PENDING",
                attempts,
                "Не удалось загрузить карточку товара МКС.",
                retrySeconds(attempts),
                item.id());
    }

    void upsert(String externalId, MksDto.ProductDetails details) {
        var p = details.product();
        jdbc.update(
                """
                insert into supplier_products(supplier_code, external_id, sku, name, description,
                    image_url, purchase_price, retail_price, brand, availability, details)
                values ('mks', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
                on conflict (supplier_code, external_id) do update set sku = excluded.sku, name = excluded.name,
                    description = excluded.description, image_url = excluded.image_url,
                    purchase_price = excluded.purchase_price, retail_price = excluded.retail_price,
                    brand = excluded.brand, availability = excluded.availability, details = excluded.details,
                    synced_at = now(), next_sync_at = now() + interval '24 hours'
                """,
                externalId,
                p.sku(),
                p.name(),
                details.description(),
                p.imageUrl(),
                p.price(),
                details.minimumPrice(),
                p.brand(),
                p.availability(),
                json(details));
    }

    void finish(long id) {
        recount(id);
        jdbc.update(
                """
                update supplier_import_jobs set status = case
                    when discovery_done and pending = 0 then case when failed > 0 then 'FAILED' else 'COMPLETED' end
                    when discovery_done then 'RUNNING' else 'DISCOVERING' end,
                  error = case when failed > 0 then 'Не все товары загружены. Повторите неудавшиеся позиции.' else error end,
                  updated_at = now() where id = ? and status <> 'FAILED'
                """,
                id);
    }

    SupplierProductDto.ImportJob retry(long id) {
        var jobs =
                jdbc.query(
                        "select * from supplier_import_jobs where id = ? for update",
                        this::jobRow,
                        id);
        if (jobs.isEmpty()) throw new AppExceptions.NotFound("Задание импорта не найдено.");
        if (!jobs.getFirst().status().equals("FAILED"))
            throw new AppExceptions.BadRequest("Повторить можно только неудавшийся импорт.");
        jdbc.update(
                "update supplier_import_items set status = 'PENDING', attempts = 0, error = null, next_attempt_at = now() where job_id = ? and status = 'FAILED'",
                id);
        jdbc.update(
                "update supplier_import_jobs set status = 'QUEUED', error = null, discovery_attempts = 0, next_discovery_at = now(), updated_at = now() where id = ?",
                id);
        recount(id);
        return job(id);
    }

    List<String> dueProducts() {
        return jdbc.query(
                """
                select p.external_id from supplier_products p where p.supplier_code = 'mks' and p.next_sync_at <= now()
                and not exists (select 1 from supplier_import_items i join supplier_import_jobs j on j.id = i.job_id
                    where j.supplier_code = p.supplier_code and i.external_id = p.external_id
                      and ((j.status in ('QUEUED', 'DISCOVERING', 'RUNNING') and i.status = 'PENDING')
                          or (j.status = 'FAILED' and i.status in ('FAILED', 'PENDING') and j.updated_at >= p.synced_at)))
                order by p.next_sync_at, p.id limit 50
                """,
                (row, index) -> row.getString(1));
    }

    SupplierProductDto.SyncStatus syncStatus() {
        return jdbc.queryForObject(
                """
                select (select count(*) from supplier_products) total,
                  (select count(*) from supplier_import_jobs where status in ('QUEUED', 'DISCOVERING', 'RUNNING')) active,
                  (select coalesce(sum(pending),0) from supplier_import_jobs where status in ('QUEUED', 'DISCOVERING', 'RUNNING')) pending,
                  (select coalesce(sum(failed),0) from supplier_import_jobs where status = 'FAILED') failed,
                  (select max(synced_at) from supplier_products) last_synced,
                  (select min(next_sync_at) from supplier_products) next_sync
                """,
                (row, index) ->
                        new SupplierProductDto.SyncStatus(
                                row.getLong("total"),
                                row.getLong("active"),
                                row.getLong("pending"),
                                row.getLong("failed"),
                                instant(row, "last_synced"),
                                instant(row, "next_sync")));
    }
}
