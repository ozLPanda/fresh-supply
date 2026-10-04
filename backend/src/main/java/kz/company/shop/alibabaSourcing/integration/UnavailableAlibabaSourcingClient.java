package kz.company.shop.alibabaSourcing.integration;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Safe default that prevents accidental scraping or unauthorised calls to Alibaba.
 *
 * <p>An official client should implement {@link AlibabaSourcingClient} and be activated with a
 * different {@code app.alibaba-sourcing.provider} value.
 */
@Component
@ConditionalOnProperty(
        prefix = "app.alibaba-sourcing",
        name = "provider",
        havingValue = "stub",
        matchIfMissing = true)
public class UnavailableAlibabaSourcingClient implements AlibabaSourcingClient {
    @Override
    public AlibabaSourcingSearchResponse search(AlibabaSourcingSearchRequest request) {
        throw new AlibabaSourcingIntegrationException(
                AlibabaSourcingIntegrationException.INTEGRATION_UNAVAILABLE,
                "Alibaba sourcing integration is not configured. Configure an approved official"
                        + " Alibaba API client before starting a supplier search.");
    }
}
