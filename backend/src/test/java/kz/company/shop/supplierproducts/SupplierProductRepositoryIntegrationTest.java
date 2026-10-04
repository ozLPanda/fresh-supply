package kz.company.shop.supplierproducts;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.mks.MksDto;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.jdbc.JdbcTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

// JDBC slice: no background scheduler or vendor connections; each test rolls back its own writes.
@JdbcTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import({SupplierProductRepository.class, ObjectMapper.class})
class SupplierProductRepositoryIntegrationTest {
    @Autowired SupplierProductRepository repository;
    @Autowired JdbcTemplate jdbc;

    private long job() {
        return repository.create(
                new SupplierProductDto.ImportRequest(
                        "mks", "SELECTED", List.of("9999999999999999999"), "", Map.of(), List.of()),
                false);
    }

    private MksDto.ProductDetails details(String name, BigDecimal purchase, BigDecimal mrc) {
        return new MksDto.ProductDetails(
                new MksDto.Product(
                        "9999999999999999999",
                        "S".repeat(1000),
                        name,
                        "Brand",
                        null,
                        purchase,
                        "Есть",
                        "шт",
                        "https://mks.kz/test.png",
                        null),
                null,
                new BigDecimal("99"),
                mrc,
                null,
                null,
                null,
                null,
                List.of("https://mks.kz/test.png"),
                List.of(),
                "Описание",
                null,
                null);
    }

    @Test
    void selectionIsDeduplicatedCountersAccurateAndRetryPreservesSuccessfulItems() {
        long id = job();
        repository.enqueue(id, List.of("11", "11", "22"));
        repository.recount(id);
        assertThat(repository.job(id).discovered()).isEqualTo(2);
        var items = repository.items(id);
        repository.itemCompleted(items.getFirst().id());
        var failed = new SupplierProductRepository.Item(items.getLast().id(), "22", 2);
        repository.itemFailed(failed);
        repository.finish(id);
        var done = repository.job(id);
        assertThat(done.status()).isEqualTo("FAILED");
        assertThat(done.processed()).isEqualTo(1);
        assertThat(done.failed()).isEqualTo(1);
        assertThat(done.pending()).isZero();
        var retried = repository.retry(id);
        assertThat(retried.status()).isEqualTo("QUEUED");
        assertThat(retried.pending()).isEqualTo(1);
        assertThat(retried.processed()).isEqualTo(1);
        assertThat(repository.items(id))
                .extracting(SupplierProductRepository.Item::externalId)
                .containsExactly("22");
        assertThatThrownBy(() -> repository.retry(id)).isInstanceOf(AppExceptions.BadRequest.class);
    }

    @Test
    void upsertsOnceUsesMrcAndSupportsVendorMaximumFieldBounds() {
        String name = "Supplier integration " + UUID.randomUUID();
        var purchase = new BigDecimal("99999999999999999999E+8");
        repository.upsert("9999999999999999999", details(name, purchase, new BigDecimal("12")));
        repository.upsert(
                "9999999999999999999", details(name, BigDecimal.TEN, new BigDecimal("13")));
        var page = repository.products("mks", name, 1, 25, "name", "asc");
        assertThat(page.totalItems()).isEqualTo(1);
        var p = page.items().getFirst();
        assertThat(p.purchasePrice()).isEqualByComparingTo("10");
        assertThat(p.retailPrice()).isEqualByComparingTo("13");
        assertThat(p.details().retailPrice()).isEqualByComparingTo("99");
        assertThat(p.sku()).hasSize(1000);
        assertThat(repository.product(p.id()).name()).isEqualTo(name);
        assertThat(
                        jdbc.queryForObject(
                                "select next_sync_at > synced_at from supplier_products where id = ?",
                                Boolean.class,
                                p.id()))
                .isTrue();
    }

    @Test
    void successfulItemsInPartiallyFailedJobsStillReceiveDailyRefresh() {
        String externalId = "9999999999999999999";
        repository.upsert(
                externalId,
                details("Refresh test " + UUID.randomUUID(), BigDecimal.ONE, BigDecimal.TEN));
        jdbc.update(
                "update supplier_products set next_sync_at = now() - interval '1 hour' where external_id = ? and supplier_code = 'mks'",
                externalId);
        long id = job();
        repository.enqueue(id, List.of(externalId, "22"));
        var items = repository.items(id);
        repository.itemCompleted(items.getFirst().id());
        repository.itemFailed(new SupplierProductRepository.Item(items.getLast().id(), "22", 2));
        repository.finish(id);
        assertThat(repository.dueProducts()).contains(externalId);
        long refresh = job();
        repository.enqueue(refresh, List.of(externalId));
        repository.recount(refresh);
        assertThat(repository.dueProducts()).doesNotContain(externalId);
    }

    @Test
    void pendingItemsAreRetriedLaterInsteadOfBusyLoopingAndCardFailuresRemainVisible() {
        long id = job();
        repository.enqueue(id, List.of("11"));
        var item = repository.items(id).getFirst();
        repository.itemFailed(item);
        repository.finish(id);
        assertThat(repository.items(id)).isEmpty();
        assertThat(repository.job(id).pending()).isEqualTo(1);
        assertThat(repository.job(id).status()).isEqualTo("RUNNING");
        assertThat(
                        jdbc.queryForObject(
                                "select attempts from supplier_import_items where id = ?",
                                Integer.class,
                                item.id()))
                .isEqualTo(1);
    }

    @Test
    void successfulManualReimportSupersedesOldFailureForDailyRefresh() {
        String externalId = "9999999999999999999";
        repository.upsert(
                externalId,
                details("Manual reimport " + UUID.randomUUID(), BigDecimal.ONE, BigDecimal.TEN));
        long failedJob = job();
        repository.enqueue(failedJob, List.of(externalId));
        var item = repository.items(failedJob).getFirst();
        repository.itemFailed(new SupplierProductRepository.Item(item.id(), externalId, 2));
        repository.finish(failedJob);
        // now() is transaction-stable in PostgreSQL; move the historical failure before the later
        // successful sync.
        jdbc.update(
                "update supplier_import_jobs set updated_at = now() - interval '2 hours' where id = ?",
                failedJob);
        jdbc.update(
                "update supplier_products set next_sync_at = now() - interval '1 hour' where external_id = ?",
                externalId);
        assertThat(repository.dueProducts()).contains(externalId);
    }
}
