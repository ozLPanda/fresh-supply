package kz.company.shop.alibabaSourcing.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingSearch;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingSearchStatus;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingOffer;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingSearchResponse;
import kz.company.shop.alibabaSourcing.repository.AlibabaSourcingOfferRepository;
import kz.company.shop.alibabaSourcing.repository.AlibabaSourcingSearchRepository;
import kz.company.shop.audit.service.AuditService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AlibabaSourcingSearchPersistenceServiceTest {
    private final AlibabaSourcingSearchRepository searches =
            mock(AlibabaSourcingSearchRepository.class);
    private final AlibabaSourcingOfferRepository offers =
            mock(AlibabaSourcingOfferRepository.class);
    private final AuditService audit = mock(AuditService.class);
    private final AlibabaSourcingSearchPersistenceService service =
            new AlibabaSourcingSearchPersistenceService(searches, offers, audit);

    @Test
    void completesSearchAndPersistsOnlyMatchingOffers() {
        AlibabaSourcingSearch search = inProgressSearch();
        when(searches.findByIdForUpdate(search.id)).thenReturn(Optional.of(search));
        AlibabaSourcingSearchResponse response =
                new AlibabaSourcingSearchResponse(List.of(offer(3, "10"), offer(2, "20")));

        service.complete(search.id, response);

        ArgumentCaptor<List> captor = ArgumentCaptor.forClass(List.class);
        verify(offers).saveAll(captor.capture());
        List<?> persisted = captor.getValue();
        assertThat(persisted).hasSize(1);
        assertThat(search.status).isEqualTo(AlibabaSourcingSearchStatus.COMPLETED);
        assertThat(search.completedAt).isNotNull();
        verify(searches).save(search);
    }

    @Test
    void failsOnlyStillRunningSearch() {
        AlibabaSourcingSearch search = inProgressSearch();
        when(searches.findByIdForUpdate(search.id)).thenReturn(Optional.of(search));

        service.fail(search.id, "safe message");

        assertThat(search.status).isEqualTo(AlibabaSourcingSearchStatus.FAILED);
        assertThat(search.errorMessage).isEqualTo("safe message");
        assertThat(search.completedAt).isNotNull();
        verify(searches).save(search);
    }

    private AlibabaSourcingSearch inProgressSearch() {
        AlibabaSourcingSearch search = new AlibabaSourcingSearch();
        search.id = UUID.randomUUID();
        search.productId = 1L;
        search.status = AlibabaSourcingSearchStatus.IN_PROGRESS;
        search.searchQuery = "pump";
        search.minOrderQuantity = new BigDecimal("12");
        search.minCompanyAgeYears = 3;
        return search;
    }

    private AlibabaSourcingOffer offer(int age, String moq) {
        return new AlibabaSourcingOffer(
                "https://example.com/product/" + age,
                "Pump",
                null,
                null,
                "USD",
                new BigDecimal(moq),
                "pieces",
                "Supplier " + age,
                null,
                "China",
                age,
                true,
                null,
                null,
                null);
    }
}
