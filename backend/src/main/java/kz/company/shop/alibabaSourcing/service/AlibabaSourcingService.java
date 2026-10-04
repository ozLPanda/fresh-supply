package kz.company.shop.alibabaSourcing.service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import kz.company.shop.alibabaSourcing.dto.AlibabaSourcingConfigDto;
import kz.company.shop.alibabaSourcing.dto.AlibabaSourcingConfigUpdateRequest;
import kz.company.shop.alibabaSourcing.dto.AlibabaSourcingOfferDto;
import kz.company.shop.alibabaSourcing.dto.AlibabaSourcingSearchDto;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingOffer;
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
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class AlibabaSourcingService {
    public static final int MAX_RESULTS = 10;

    private final ProductService productService;
    private final ProductAlibabaSourcingConfigRepository configRepository;
    private final AlibabaSourcingSearchRepository searchRepository;
    private final AlibabaSourcingOfferRepository offerRepository;
    private final AuditService auditService;
    private final AlibabaSourcingSearchWorker searchWorker;
    private final AlibabaSourcingSearchPersistenceService persistenceService;

    public AlibabaSourcingService(
            ProductService productService,
            ProductAlibabaSourcingConfigRepository configRepository,
            AlibabaSourcingSearchRepository searchRepository,
            AlibabaSourcingOfferRepository offerRepository,
            AuditService auditService,
            AlibabaSourcingSearchWorker searchWorker,
            AlibabaSourcingSearchPersistenceService persistenceService) {
        this.productService = productService;
        this.configRepository = configRepository;
        this.searchRepository = searchRepository;
        this.offerRepository = offerRepository;
        this.auditService = auditService;
        this.searchWorker = searchWorker;
        this.persistenceService = persistenceService;
    }

    @Transactional(readOnly = true)
    public AlibabaSourcingConfigDto getConfig(Long productId) {
        Product product = productService.getEntity(productId);
        return toConfigDto(
                configRepository.findById(productId).orElseGet(() -> defaultConfig(product)));
    }

    @Transactional
    public AlibabaSourcingConfigDto updateConfig(
            Long productId, AlibabaSourcingConfigUpdateRequest request) {
        Product product = productService.getEntity(productId);
        validateRequest(request);
        ProductAlibabaSourcingConfig config =
                configRepository.findById(productId).orElseGet(() -> defaultConfig(product));
        config.enabled = request.enabled();
        config.searchQuery = normalize(request.searchQuery());
        config.minOrderQuantity = request.minimumOrderQuantity();
        config.minCompanyAgeYears = request.minimumCompanyAgeYears();
        ProductAlibabaSourcingConfig saved = configRepository.save(config);
        auditService.record(
                "UPDATE",
                "ALIBABA_SOURCING_CONFIG",
                productId,
                "Updated Alibaba sourcing configuration");
        return toConfigDto(saved);
    }

    @Transactional(readOnly = true)
    public List<AlibabaSourcingSearchDto> listSearches(Long productId) {
        productService.getEntity(productId);
        Long selectedOfferId =
                configRepository
                        .findById(productId)
                        .map(config -> config.selectedOfferId)
                        .orElse(null);
        return searchRepository.findByProductIdOrderByCreatedAtDesc(productId).stream()
                .map(search -> toSearchDto(search, selectedOfferId))
                .toList();
    }

    @Transactional(readOnly = true)
    public AlibabaSourcingSearchDto getSearch(Long productId, UUID searchId) {
        Long selectedOfferId =
                configRepository
                        .findById(productId)
                        .map(config -> config.selectedOfferId)
                        .orElse(null);
        return toSearchDto(getSearchEntity(productId, searchId), selectedOfferId);
    }

    @Transactional
    public AlibabaSourcingSearchDto startSearch(Long productId, CurrentUser actor) {
        Product product = productService.getEntity(productId);
        ProductAlibabaSourcingConfig config =
                configRepository
                        .findByProductIdForUpdate(productId)
                        .orElseThrow(
                                () ->
                                        new AppExceptions.BadRequest(
                                                "Configure Alibaba sourcing before starting a search"));
        if (!config.enabled) {
            throw new AppExceptions.BadRequest("Alibaba sourcing is disabled for this product");
        }
        String searchQuery =
                config.searchQuery == null ? normalize(product.nameRu) : config.searchQuery;
        if (searchQuery == null) {
            throw new AppExceptions.BadRequest("Enter a search query before starting a search");
        }
        if (searchRepository.existsByProductIdAndStatus(
                productId, AlibabaSourcingSearchStatus.IN_PROGRESS)) {
            throw new AppExceptions.BadRequest("An Alibaba supplier search is already in progress");
        }

        AlibabaSourcingSearch search = new AlibabaSourcingSearch();
        search.id = UUID.randomUUID();
        search.productId = productId;
        search.status = AlibabaSourcingSearchStatus.IN_PROGRESS;
        search.searchQuery = searchQuery;
        search.minOrderQuantity = config.minOrderQuantity;
        search.minCompanyAgeYears = config.minCompanyAgeYears;
        search.createdByUserId = actor.id();
        searchRepository.save(search);
        scheduleAfterCommit(search.id);
        return toSearchDto(search, config.selectedOfferId);
    }

    @Transactional
    public AlibabaSourcingSearchDto retrySearch(Long productId, UUID searchId, CurrentUser actor) {
        AlibabaSourcingSearch search = getSearchEntity(productId, searchId);
        if (search.status != AlibabaSourcingSearchStatus.FAILED) {
            throw new AppExceptions.BadRequest(
                    "Only failed Alibaba supplier searches can be retried");
        }
        return startSearch(productId, actor);
    }

    @Transactional
    public AlibabaSourcingConfigDto selectOffer(Long productId, Long offerId, CurrentUser actor) {
        ProductAlibabaSourcingConfig config =
                configRepository
                        .findById(productId)
                        .orElseThrow(
                                () ->
                                        new AppExceptions.BadRequest(
                                                "Configure Alibaba sourcing before selecting a supplier"));
        AlibabaSourcingOffer offer =
                offerRepository
                        .findById(offerId)
                        .orElseThrow(
                                () ->
                                        new AppExceptions.NotFound(
                                                "Alibaba sourcing offer not found"));
        AlibabaSourcingSearch search =
                searchRepository
                        .findById(offer.searchId)
                        .orElseThrow(
                                () ->
                                        new AppExceptions.NotFound(
                                                "Alibaba sourcing search not found"));
        if (!productId.equals(search.productId)
                || search.status != AlibabaSourcingSearchStatus.COMPLETED) {
            throw new AppExceptions.BadRequest(
                    "The offer does not belong to a completed product search");
        }
        config.selectedOfferId = offer.id;
        config.selectedAt = Instant.now();
        config.selectedByUserId = actor.id();
        ProductAlibabaSourcingConfig saved = configRepository.save(config);
        auditService.record(
                "SELECT", "ALIBABA_SOURCING_OFFER", productId, "Alibaba supplier selected");
        return toConfigDto(saved);
    }

    @Transactional
    public AlibabaSourcingConfigDto clearSelectedOffer(Long productId) {
        ProductAlibabaSourcingConfig config =
                configRepository
                        .findById(productId)
                        .orElseThrow(
                                () ->
                                        new AppExceptions.NotFound(
                                                "Alibaba sourcing configuration not found"));
        config.selectedOfferId = null;
        config.selectedAt = null;
        config.selectedByUserId = null;
        ProductAlibabaSourcingConfig saved = configRepository.save(config);
        auditService.record(
                "UNSELECT",
                "ALIBABA_SOURCING_OFFER",
                productId,
                "Alibaba supplier selection cleared");
        return toConfigDto(saved);
    }

    private void validateRequest(AlibabaSourcingConfigUpdateRequest request) {
        if (request.minimumCompanyAgeYears() != null && request.minimumCompanyAgeYears() < 0) {
            throw new AppExceptions.BadRequest("Minimum company age cannot be negative");
        }
        if (Boolean.TRUE.equals(request.enabled()) && normalize(request.searchQuery()) == null) {
            // An absent query will fall back to the product name when the search starts.
            return;
        }
    }

    private ProductAlibabaSourcingConfig defaultConfig(Product product) {
        ProductAlibabaSourcingConfig config = new ProductAlibabaSourcingConfig();
        config.productId = product.id;
        config.enabled = false;
        config.searchQuery = normalize(product.nameRu);
        return config;
    }

    private AlibabaSourcingSearch getSearchEntity(Long productId, UUID searchId) {
        return searchRepository
                .findByIdAndProductId(searchId, productId)
                .orElseThrow(() -> new AppExceptions.NotFound("Alibaba sourcing search not found"));
    }

    private AlibabaSourcingConfigDto toConfigDto(ProductAlibabaSourcingConfig config) {
        AlibabaSourcingOfferDto selected =
                config.selectedOfferId == null
                        ? null
                        : offerRepository
                                .findById(config.selectedOfferId)
                                .map(offer -> toOfferDto(offer, config.selectedOfferId))
                                .orElse(null);
        return new AlibabaSourcingConfigDto(
                config.productId,
                config.enabled,
                config.searchQuery,
                config.minOrderQuantity,
                config.minCompanyAgeYears,
                config.selectedOfferId,
                selected);
    }

    private AlibabaSourcingSearchDto toSearchDto(
            AlibabaSourcingSearch search, Long selectedOfferId) {
        List<AlibabaSourcingOfferDto> offers =
                offerRepository.findBySearchIdOrderByPositionAsc(search.id).stream()
                        .map(offer -> toOfferDto(offer, selectedOfferId))
                        .toList();
        return new AlibabaSourcingSearchDto(
                search.id,
                search.status.name(),
                search.searchQuery,
                search.minOrderQuantity,
                search.minCompanyAgeYears,
                search.errorMessage,
                search.createdAt,
                search.completedAt,
                offers);
    }

    private AlibabaSourcingOfferDto toOfferDto(AlibabaSourcingOffer offer, Long selectedOfferId) {
        return new AlibabaSourcingOfferDto(
                offer.id,
                offer.position,
                offer.productTitle,
                offer.productUrl,
                offer.priceFrom,
                offer.priceTo,
                offer.currency,
                offer.minimumOrderQuantity,
                offer.minimumOrderUnit,
                offer.supplierName,
                offer.supplierUrl,
                offer.country,
                offer.companyAgeYears,
                offer.verifiedSupplier,
                offer.rating,
                offer.reviewCount,
                offer.description,
                offer.id.equals(selectedOfferId));
    }

    private String normalize(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private void scheduleAfterCommit(UUID searchId) {
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        try {
                            searchWorker.process(searchId);
                        } catch (RuntimeException exception) {
                            persistenceService.fail(
                                    searchId,
                                    "Alibaba supplier search could not be scheduled. Please try again later.");
                        }
                    }
                });
    }
}
