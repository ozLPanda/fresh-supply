package kz.company.shop.supplierproducts;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.mks.MksDto;
import kz.company.shop.mks.MksService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class SupplierProductServiceTest {
    private final SupplierProductRepository repository = mock(SupplierProductRepository.class);
    private final MksService mks = mock(MksService.class);
    private final SupplierProductService service = new SupplierProductService(repository, mks);

    private SupplierProductDto.ImportRequest request(
            String scope, List<String> ids, Map<String, Object> filters, List<String> categories) {
        return new SupplierProductDto.ImportRequest("mks", scope, ids, "", filters, categories);
    }

    private SupplierProductRepository.Work work(
            boolean done, int page, int category, String fingerprint) {
        return new SupplierProductRepository.Work(
                7,
                done ? "SELECTED" : "FILTERED",
                request(
                        done ? "SELECTED" : "FILTERED",
                        List.of(),
                        Map.of("brand", "18"),
                        List.of("5", "6")),
                page,
                done,
                0,
                Instant.EPOCH,
                category,
                fingerprint);
    }

    private void worker(SupplierProductRepository.Work work) {
        when(repository.lockWorker()).thenReturn(true);
        when(repository.work()).thenReturn(List.of(work));
    }

    private MksDto.Product product(String id) {
        return new MksDto.Product(
                id, "SKU", "Товар", "Марка", null, BigDecimal.TEN, "Есть", "шт", null, null);
    }

    private MksDto.SearchResult search(List<MksDto.Product> items, boolean hasMore) {
        return new MksDto.SearchResult(items, 1, 100, 1L, 1, hasMore, List.of(), List.of());
    }

    @Test
    void requestCreatesDurableDeduplicatedSelectionWithoutRemoteCalls() {
        when(repository.create(any(), eq(false))).thenReturn(7L);
        service.createImport(request("SELECTED", List.of("21", "21", "22"), Map.of(), List.of()));
        verify(repository).enqueue(7, List.of("21", "22"));
        verify(repository).recount(7);
        verifyNoInteractions(mks);
    }

    @Test
    void rejectsUnsafeIdsUnknownModesAndAmbiguousSelectionsBeforePersistence() {
        for (String id : List.of("0", "-1", "../1", "1?password=x", "12345678901234567890"))
            assertThatThrownBy(
                            () ->
                                    service.createImport(
                                            request("SELECTED", List.of(id), Map.of(), List.of())))
                    .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(
                        () ->
                                service.createImport(
                                        request("UNKNOWN", List.of(), Map.of(), List.of())))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(
                        () ->
                                service.createImport(
                                        request("ALL", List.of(), Map.of("brand", "1"), List.of())))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(
                        () ->
                                service.createImport(
                                        request("SELECTED", List.of("1"), Map.of(), List.of("2"))))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(
                        () ->
                                service.createImport(
                                        request(
                                                "SELECTED",
                                                java.util.Collections.nCopies(1001, "1"),
                                                Map.of(),
                                                List.of())))
                .isInstanceOf(AppExceptions.BadRequest.class);
        verifyNoInteractions(repository, mks);
    }

    @Test
    void validatesFilterTypesNumbersAndDynamicKeysBeforePersistence() {
        for (var filters :
                List.of(
                        Map.<String, Object>of("unexpected", "x"),
                        Map.<String, Object>of("available", "true"),
                        Map.<String, Object>of("minprice", "-1"),
                        Map.<String, Object>of("sorting", "price;drop table"),
                        Map.<String, Object>of("catalog", List.of("1", "2")),
                        Map.<String, Object>of("filter.bad.key", "x")))
            assertThatThrownBy(
                            () ->
                                    service.createImport(
                                            request("FILTERED", List.of(), filters, List.of())))
                    .isInstanceOf(AppExceptions.BadRequest.class);
        verifyNoInteractions(repository, mks);
    }

    @Test
    void acceptsMultipleCategoriesAndCharacteristicFilters() {
        var selection =
                service.validate(
                        request(
                                "FILTERED",
                                List.of(),
                                Map.of(
                                        "filter.color",
                                        List.of("1", "2"),
                                        "search_range.power.from",
                                        "100"),
                                List.of("1", "2", "1")));
        assertThat(selection.categoryIds()).containsExactly("1", "2");
    }

    @Test
    void doesNotWorkWithoutCrossInstanceDatabaseLock() {
        service.tick();
        verify(repository).lockWorker();
        verifyNoMoreInteractions(repository);
        verifyNoInteractions(mks);
    }

    @Test
    void importsOnlyBoundedPersistedItemsAndRetainsIndividualFailure() {
        worker(work(true, 1, 0, null));
        var one = new SupplierProductRepository.Item(11, "21", 0);
        var two = new SupplierProductRepository.Item(12, "22", 2);
        when(repository.items(7)).thenReturn(List.of(one, two));
        var details =
                new MksDto.ProductDetails(
                        product("21"),
                        null,
                        new BigDecimal("12"),
                        new BigDecimal("11"),
                        null,
                        null,
                        null,
                        null,
                        List.of(),
                        List.of(),
                        "Описание",
                        null,
                        null);
        when(mks.product("21")).thenReturn(details);
        when(mks.product("22")).thenThrow(new AppExceptions.BadRequest("upstream failed"));
        service.tick();
        verify(repository).upsert("21", details);
        verify(repository).itemCompleted(11);
        verify(repository).itemFailed(two);
        verify(repository).finish(7);
        verify(mks, never()).search(any());
    }

    @Test
    void keepsDatabaseFailuresTransactionalInsteadOfSilentlySkippingItems() {
        worker(work(true, 1, 0, null));
        var item = new SupplierProductRepository.Item(11, "21", 0);
        when(repository.items(7)).thenReturn(List.of(item));
        var details =
                new MksDto.ProductDetails(
                        product("21"),
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        List.of(),
                        List.of(),
                        null,
                        null,
                        null);
        when(mks.product("21")).thenReturn(details);
        doThrow(new IllegalStateException("database")).when(repository).upsert("21", details);
        assertThatThrownBy(service::tick).isInstanceOf(IllegalStateException.class);
        verify(repository, never()).itemFailed(any());
        verify(repository, never()).itemCompleted(anyLong());
    }

    @Test
    void movesToNextCategoryAndCombinesExistingFilters() {
        worker(work(false, 1, 0, null));
        when(mks.search(any())).thenReturn(search(List.of(product("21")), false));
        service.tick();
        var captor = ArgumentCaptor.forClass(MksDto.SearchRequest.class);
        verify(mks).search(captor.capture());
        assertThat(captor.getValue().filters())
                .containsEntry("catalog", "5")
                .containsEntry("brand", "18");
        verify(repository).discovery(7, 1, 1, null, false);
        verify(repository).enqueue(7, List.of("21"));
    }

    @Test
    void continuesFullPageDespiteUnderstatedProviderTotals() {
        worker(work(false, 1, 0, null));
        var items = new ArrayList<MksDto.Product>();
        for (int id = 1; id <= 100; id++) items.add(product(Integer.toString(id)));
        when(mks.search(any())).thenReturn(search(items, false));
        service.tick();
        verify(repository).discovery(eq(7L), eq(2), eq(0), anyString(), eq(false));
    }

    @Test
    void persistsDiscoveryFailureWithoutConsumingUnknownItems() {
        var work = work(false, 1, 0, null);
        worker(work);
        when(mks.search(any())).thenThrow(new AppExceptions.BadRequest("unavailable"));
        service.tick();
        verify(repository).discoveryFailed(work);
        verify(repository, never()).items(anyLong());
    }

    @Test
    void schedulesDuePreviouslyImportedProductsIntoTheSamePersistentQueue() {
        when(repository.lockWorker()).thenReturn(true);
        when(repository.dueProducts()).thenReturn(List.of("21", "22"));
        when(repository.create(any(), eq(true))).thenReturn(9L);
        service.tick();
        verify(repository).enqueue(9, List.of("21", "22"));
        verify(repository).recount(9);
    }

    @Test
    void rejectsUnknownSortWithoutConstructingSql() {
        assertThatThrownBy(() -> service.products("mks", "", 1, 25, "price;drop", "asc"))
                .isInstanceOf(AppExceptions.BadRequest.class);
        verifyNoInteractions(repository);
    }

    @Test
    void allCatalogImportPersistsSnapshotAndScansEmptyFinalPage() {
        var selection = request("ALL", List.of(), Map.of(), List.of());
        when(repository.create(any(), eq(false))).thenReturn(7L);
        service.createImport(selection);
        verifyNoInteractions(mks);
        verify(repository, never()).enqueue(anyLong(), anyList());
        var work =
                new SupplierProductRepository.Work(
                        7, "ALL", selection, 2, false, 0, Instant.EPOCH, 0, "previous");
        worker(work);
        when(mks.search(any())).thenReturn(search(List.of(), false));
        service.tick();
        verify(mks).search(new MksDto.SearchRequest("", 2, 100, Map.of()));
        verify(repository).discovery(7, 1, 0, null, true);
        verify(repository).finish(7);
    }

    @Test
    void repeatedPageFailsVisiblyInsteadOfLoopingForever() throws Exception {
        String fingerprint =
                java.util.HexFormat.of()
                        .formatHex(
                                java.security.MessageDigest.getInstance("SHA-256")
                                        .digest(
                                                "21"
                                                        .getBytes(
                                                                java.nio.charset.StandardCharsets
                                                                        .UTF_8)));
        var work = work(false, 2, 0, fingerprint);
        worker(work);
        when(mks.search(any())).thenReturn(search(List.of(product("21")), false));
        service.tick();
        verify(repository).discoveryFailed(work);
        verify(repository, never()).enqueue(anyLong(), anyList());
    }
}
