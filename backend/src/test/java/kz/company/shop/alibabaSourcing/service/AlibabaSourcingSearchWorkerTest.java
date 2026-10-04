package kz.company.shop.alibabaSourcing.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingClient;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingIntegrationException;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingOffer;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingSearchRequest;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingSearchResponse;
import org.junit.jupiter.api.Test;

class AlibabaSourcingSearchWorkerTest {
    private final AlibabaSourcingSearchPersistenceService persistence =
            mock(AlibabaSourcingSearchPersistenceService.class);
    private final AlibabaSourcingClient client = mock(AlibabaSourcingClient.class);
    private final AlibabaSourcingSearchWorker worker =
            new AlibabaSourcingSearchWorker(persistence, client);

    @Test
    void completesPersistedSearchFromWorkerThread() {
        UUID searchId = UUID.randomUUID();
        AlibabaSourcingWorkItem work =
                new AlibabaSourcingWorkItem(searchId, 4L, "pump", new BigDecimal("12"), 3);
        AlibabaSourcingSearchResponse response =
                new AlibabaSourcingSearchResponse(List.of(offer()));
        when(persistence.loadInProgress(searchId)).thenReturn(Optional.of(work));
        when(client.search(any())).thenReturn(response);

        worker.process(searchId);

        verify(client)
                .search(eq(new AlibabaSourcingSearchRequest("pump", new BigDecimal("12"), 3, 10)));
        verify(persistence).complete(searchId, response);
    }

    @Test
    void marksSearchFailedWhenClientThrows() {
        UUID searchId = UUID.randomUUID();
        AlibabaSourcingWorkItem work =
                new AlibabaSourcingWorkItem(searchId, 4L, "pump", null, null);
        when(persistence.loadInProgress(searchId)).thenReturn(Optional.of(work));
        when(client.search(any()))
                .thenThrow(new IllegalStateException("provider details must not leak"));

        worker.process(searchId);

        verify(persistence)
                .fail(searchId, "Alibaba supplier search failed. Please try again later.");
    }

    @Test
    void preservesSafeIntegrationFailureMessage() {
        UUID searchId = UUID.randomUUID();
        AlibabaSourcingWorkItem work =
                new AlibabaSourcingWorkItem(searchId, 4L, "pump", null, null);
        when(persistence.loadInProgress(searchId)).thenReturn(Optional.of(work));
        when(client.search(any()))
                .thenThrow(
                        new AlibabaSourcingIntegrationException(
                                AlibabaSourcingIntegrationException.INTEGRATION_UNAVAILABLE,
                                "Alibaba requested a verification page. Try the search again later."));

        worker.process(searchId);

        verify(persistence)
                .fail(
                        searchId,
                        "Alibaba requested a verification page. Try the search again later.");
    }

    private AlibabaSourcingOffer offer() {
        return new AlibabaSourcingOffer(
                "https://example.com/product",
                "Pump",
                new BigDecimal("1.00"),
                new BigDecimal("2.00"),
                "USD",
                new BigDecimal("10"),
                "pieces",
                "Supplier",
                "https://example.com/supplier",
                "China",
                4,
                true,
                new BigDecimal("4.5"),
                null,
                null);
    }
}
