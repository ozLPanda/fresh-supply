package kz.company.shop.alibabaSourcing.service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingOffer;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingSearch;
import kz.company.shop.alibabaSourcing.entity.AlibabaSourcingSearchStatus;
import kz.company.shop.alibabaSourcing.integration.AlibabaSourcingSearchResponse;
import kz.company.shop.alibabaSourcing.repository.AlibabaSourcingOfferRepository;
import kz.company.shop.alibabaSourcing.repository.AlibabaSourcingSearchRepository;
import kz.company.shop.audit.service.AuditService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Persists worker state in short, independent transactions. */
@Service
public class AlibabaSourcingSearchPersistenceService {
    private final AlibabaSourcingSearchRepository searchRepository;
    private final AlibabaSourcingOfferRepository offerRepository;
    private final AuditService auditService;

    public AlibabaSourcingSearchPersistenceService(
            AlibabaSourcingSearchRepository searchRepository,
            AlibabaSourcingOfferRepository offerRepository,
            AuditService auditService) {
        this.searchRepository = searchRepository;
        this.offerRepository = offerRepository;
        this.auditService = auditService;
    }

    @Transactional(readOnly = true)
    public Optional<AlibabaSourcingWorkItem> loadInProgress(UUID searchId) {
        return searchRepository
                .findById(searchId)
                .filter(search -> search.status == AlibabaSourcingSearchStatus.IN_PROGRESS)
                .map(
                        search ->
                                new AlibabaSourcingWorkItem(
                                        search.id,
                                        search.productId,
                                        search.searchQuery,
                                        search.minOrderQuantity,
                                        search.minCompanyAgeYears));
    }

    @Transactional
    public void complete(UUID searchId, AlibabaSourcingSearchResponse response) {
        searchRepository
                .findByIdForUpdate(searchId)
                .filter(search -> search.status == AlibabaSourcingSearchStatus.IN_PROGRESS)
                .ifPresent(
                        search -> {
                            List<AlibabaSourcingOffer> offers = new ArrayList<>();
                            for (var raw : response.offers()) {
                                if (!matchesRequirements(raw, search)
                                        || offers.size() == AlibabaSourcingService.MAX_RESULTS) {
                                    continue;
                                }
                                offers.add(toEntity(search.id, offers.size() + 1, raw));
                            }
                            offerRepository.saveAll(offers);
                            search.status = AlibabaSourcingSearchStatus.COMPLETED;
                            search.errorMessage = null;
                            search.completedAt = Instant.now();
                            searchRepository.save(search);
                            auditService.record(
                                    "SEARCH",
                                    "ALIBABA_SOURCING",
                                    search.productId,
                                    "Alibaba supplier search completed");
                        });
    }

    @Transactional
    public void fail(UUID searchId, String message) {
        searchRepository
                .findByIdForUpdate(searchId)
                .filter(search -> search.status == AlibabaSourcingSearchStatus.IN_PROGRESS)
                .ifPresent(
                        search -> {
                            search.status = AlibabaSourcingSearchStatus.FAILED;
                            search.errorMessage = message;
                            search.completedAt = Instant.now();
                            searchRepository.save(search);
                            auditService.record(
                                    "SEARCH_FAILED",
                                    "ALIBABA_SOURCING",
                                    search.productId,
                                    "Alibaba supplier search failed");
                        });
    }

    private boolean matchesRequirements(
            kz.company.shop.alibabaSourcing.integration.AlibabaSourcingOffer raw,
            AlibabaSourcingSearch search) {
        if (search.minCompanyAgeYears != null
                && (raw.supplierCompanyAgeYears() == null
                        || raw.supplierCompanyAgeYears() < search.minCompanyAgeYears)) {
            return false;
        }
        return search.minOrderQuantity == null
                || (raw.minimumOrderQuantity() != null
                        && raw.minimumOrderQuantity().compareTo(search.minOrderQuantity) <= 0);
    }

    private AlibabaSourcingOffer toEntity(
            UUID searchId,
            int position,
            kz.company.shop.alibabaSourcing.integration.AlibabaSourcingOffer raw) {
        AlibabaSourcingOffer offer = new AlibabaSourcingOffer();
        offer.searchId = searchId;
        offer.position = position;
        offer.productTitle = raw.productName();
        offer.productUrl = raw.sourceProductUrl();
        offer.supplierName = raw.supplierName();
        offer.supplierUrl = raw.supplierUrl();
        offer.country = raw.supplierCountry();
        offer.companyAgeYears = raw.supplierCompanyAgeYears();
        offer.verifiedSupplier = raw.supplierVerified();
        offer.rating = raw.supplierRating();
        offer.priceFrom = raw.priceFrom();
        offer.priceTo = raw.priceTo();
        offer.currency = raw.currency();
        offer.minimumOrderQuantity = raw.minimumOrderQuantity();
        offer.minimumOrderUnit = raw.minimumOrderUnit();
        offer.description = raw.description();
        return offer;
    }
}
