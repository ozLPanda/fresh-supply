package kz.company.shop.priceImports.entity;

/**
 * Price columns accepted by the catalogue importer. Incoming cost deliberately does not belong to
 * the order price tiers: it is an internal accounting value and must never be offered to buyers.
 */
public enum ImportPriceType {
    RETAIL,
    WHOLESALE,
    BULK_WHOLESALE,
    SKO,
    INCOMING
}
