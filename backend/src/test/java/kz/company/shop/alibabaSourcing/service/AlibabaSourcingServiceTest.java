package kz.company.shop.alibabaSourcing.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingSearch;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingSearchStatus;
import kz.company.shop.alibabaSourcing.entity.ProductAlibabaSourcingConfig;
import kz.company.shop.alibabaSourcing.repository.AlibabaSourcingOfferRepository;
import kz.company.shop.alibabaSourcing.repository.AlibabaSourcingSearchRepository;
import kz.company.shop.alibabaSourcing.repository.ProductAlibabaSourcingConfigRepository;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.CurrentUser;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.service.ProductService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class AlibabaSourcingServiceTest {
    private final ProductService products = mock(ProductService.class);
    private final ProductAlibabaSourcingConfigRepository configs =
            mock(ProductAlibabaSourcingConfigRepository.class);
    private final AlibabaSourcingSearchRepository searches =
            mock(AlibabaSourcingSearchRepository.class);
    private final AlibabaSourcingOfferRepository offers =
            mock(AlibabaSourcingOfferRepository.class);
    private final AuditService audit = mock(AuditService.class);
    private final AlibabaSourcingSearchWorker worker = mock(AlibabaSourcingSearchWorker.class);
    private final AlibabaSourcingSearchPersistenceService persistence =
            mock(AlibabaSourcingSearchPersistenceService.class);
    private final AlibabaSourcingService service =
            new AlibabaSourcingService(
                    products, configs, searches, offers, audit, worker, persistence);

    @AfterEach
    void clearSynchronization() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void savesInProgressSearchBeforeSchedulingWorkerAfterCommit() {
        Product product = product();
        ProductAlibabaSourcingConfig config = enabledConfig();
        when(products.getEntity(1L)).thenReturn(product);
        when(configs.findByProductIdForUpdate(1L)).thenReturn(Optional.of(config));
        when(searches.existsByProductIdAndStatus(1L, AlibabaSourcingSearchStatus.IN_PROGRESS))
                .thenReturn(false);
        when(offers.findBySearchIdOrderByPositionAsc(any())).thenReturn(List.of());
        TransactionSynchronizationManager.initSynchronization();

        var result = service.startSearch(1L, user());

        assertThat(result.status()).isEqualTo("IN_PROGRESS");
        ArgumentCaptor<AlibabaSourcingSearch> captor =
                ArgumentCaptor.forClass(AlibabaSourcingSearch.class);
        verify(searches).save(captor.capture());
        assertThat(captor.getValue().status).isEqualTo(AlibabaSourcingSearchStatus.IN_PROGRESS);
        verifyNoInteractions(worker);

        TransactionSynchronizationManager.getSynchronizations()
                .forEach(synchronization -> synchronization.afterCommit());
        verify(worker).process(captor.getValue().id);
    }

    @Test
    void rejectsSecondActiveSearch() {
        when(products.getEntity(1L)).thenReturn(product());
        when(configs.findByProductIdForUpdate(1L)).thenReturn(Optional.of(enabledConfig()));
        when(searches.existsByProductIdAndStatus(1L, AlibabaSourcingSearchStatus.IN_PROGRESS))
                .thenReturn(true);

        assertThatThrownBy(() -> service.startSearch(1L, user()))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessage("An Alibaba supplier search is already in progress");
    }

    private Product product() {
        Product product = new Product();
        product.id = 1L;
        product.nameRu = "Pump";
        return product;
    }

    private ProductAlibabaSourcingConfig enabledConfig() {
        ProductAlibabaSourcingConfig config = new ProductAlibabaSourcingConfig();
        config.productId = 1L;
        config.enabled = true;
        config.searchQuery = "pump";
        return config;
    }

    private CurrentUser user() {
        return new CurrentUser(
                8L, "admin@example.com", "Admin", null, java.util.Set.<String>of(), true, null);
    }
}
