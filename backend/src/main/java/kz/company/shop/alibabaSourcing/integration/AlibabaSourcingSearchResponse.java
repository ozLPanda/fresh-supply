package kz.company.shop.alibabaSourcing.integration;

import java.util.List;

/** Result returned by an Alibaba sourcing integration. */
public record AlibabaSourcingSearchResponse(List<AlibabaSourcingOffer> offers) {
    public AlibabaSourcingSearchResponse {
        offers = offers == null ? List.of() : List.copyOf(offers);
        if (offers.size() > AlibabaSourcingSearchRequest.MAX_RESULT_LIMIT) {
            throw new IllegalArgumentException(
                    "offers must not contain more than "
                            + AlibabaSourcingSearchRequest.MAX_RESULT_LIMIT
                            + " items");
        }
    }
}
