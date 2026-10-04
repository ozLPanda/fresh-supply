package kz.company.shop.alibabaSourcing.integration;

/**
 * Port for retrieving Alibaba offers through an approved, official integration.
 *
 * <p>The rest of the sourcing module depends on this interface rather than on a specific Alibaba
 * transport or response format. An official client can replace the default stub by setting the
 * {@code app.alibaba-sourcing.provider} property to its provider name.
 */
public interface AlibabaSourcingClient {
    AlibabaSourcingSearchResponse search(AlibabaSourcingSearchRequest request);
}
