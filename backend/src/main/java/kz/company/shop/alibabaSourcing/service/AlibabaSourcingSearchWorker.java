package kz.company.shop.alibabaSourcing.service;

import java.util.UUID;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingClient;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingIntegrationException;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingSearchRequest;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
public class AlibabaSourcingSearchWorker {
    private static final String FAILURE_MESSAGE =
            "Alibaba supplier search failed. Please try again later.";

    private final AlibabaSourcingSearchPersistenceService persistenceService;
    private final AlibabaSourcingClient client;

    public AlibabaSourcingSearchWorker(
            AlibabaSourcingSearchPersistenceService persistenceService,
            AlibabaSourcingClient client) {
        this.persistenceService = persistenceService;
        this.client = client;
    }

    @Async("alibabaSourcingTaskExecutor")
    public void process(UUID searchId) {
        try {
            persistenceService
                    .loadInProgress(searchId)
                    .ifPresent(
                            work ->
                                    persistenceService.complete(
                                            work.searchId(),
                                            client.search(
                                                    new AlibabaSourcingSearchRequest(
                                                            work.searchQuery(),
                                                            work.minimumOrderQuantity(),
                                                            work.minimumCompanyAgeYears(),
                                                            AlibabaSourcingService.MAX_RESULTS))));
        } catch (Exception exception) {
            persistenceService.fail(searchId, failureMessage(exception));
        }
    }

    private String failureMessage(Exception exception) {
        if (exception instanceof AlibabaSourcingIntegrationException
                && exception.getMessage() != null
                && !exception.getMessage().isBlank()) {
            return exception.getMessage();
        }
        return FAILURE_MESSAGE;
    }
}
