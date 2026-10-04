package kz.company.shop.priceImports.dto;

import java.util.List;

/**
 * Optional subset of rows to apply from a price-import preview.
 *
 * <p>Indexes are zero-based positions in {@link PriceImportPreviewDto#rows()}. Keeping the
 * position rather than using SKU as an identifier also makes duplicate SKUs in a source file
 * unambiguous.
 */
public record PriceImportCommitRequest(List<Integer> selectedRowIndexes) {}
