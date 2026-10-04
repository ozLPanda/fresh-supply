package kz.company.shop.priceImports.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import kz.company.shop.priceImports.entity.ImportPriceType;

public record PriceImportPreviewDto(
        UUID id,
        String fileName,
        String status,
        boolean createMissingProducts,
        Boolean updateAvailabilityAndMadeToOrder,
        int totalRows,
        Summary summary,
        List<Row> rows,
        List<SourceFile> sourceFiles) {
    public PriceImportPreviewDto {
        // Pre-existing sessions have no field in preview_json. Keep their historical behavior.
        updateAvailabilityAndMadeToOrder =
                updateAvailabilityAndMadeToOrder == null ? Boolean.TRUE : updateAvailabilityAndMadeToOrder;
        rows = rows == null ? List.of() : List.copyOf(rows);
        sourceFiles = sourceFiles == null ? List.of() : List.copyOf(sourceFiles);
    }

    /**
     * The file-to-price-type mapping used for this session. It is shown before committing a
     * package so the operator can verify that the file names were understood correctly.
     */
    public record SourceFile(String fileName, ImportPriceType priceType, int totalRows) {}

    /** Compatibility constructor for previews created before package import support. */
    public PriceImportPreviewDto(
            UUID id,
            String fileName,
            String status,
            boolean createMissingProducts,
            int totalRows,
            Summary summary,
            List<Row> rows,
            List<SourceFile> sourceFiles) {
        this(
                id,
                fileName,
                status,
                createMissingProducts,
                true,
                totalRows,
                summary,
                rows,
                sourceFiles);
    }

    /** Compatibility constructor for previews created before package import support. */
    public PriceImportPreviewDto(
            UUID id,
            String fileName,
            String status,
            boolean createMissingProducts,
            int totalRows,
            Summary summary,
            List<Row> rows) {
        this(id, fileName, status, createMissingProducts, true, totalRows, summary, rows, List.of());
    }

    public PriceImportPreviewDto(
            UUID id,
            String fileName,
            String status,
            boolean createMissingProducts,
            boolean updateAvailabilityAndMadeToOrder,
            int totalRows,
            Summary summary,
            List<Row> rows) {
        this(
                id,
                fileName,
                status,
                createMissingProducts,
                updateAvailabilityAndMadeToOrder,
                totalRows,
                summary,
                rows,
                List.of());
    }
    public record Summary(
            int changed,
            int unchanged,
            int notFound,
            int toCreate,
            int invalid,
            int duplicate,
            int priceSetting) {
        public Summary(
                int changed, int unchanged, int notFound, int toCreate, int invalid, int duplicate) {
            this(changed, unchanged, notFound, toCreate, invalid, duplicate, 0);
        }
    }

    public record Row(
            int rowNumber,
            String sourceSheet,
            String status,
            String sku,
            String productName,
            BigDecimal oldPrice,
            BigDecimal newPrice,
            BigDecimal oldWholesalePrice,
            BigDecimal newWholesalePrice,
            BigDecimal oldBulkWholesalePrice,
            BigDecimal newBulkWholesalePrice,
            BigDecimal oldSkoPrice,
            BigDecimal newSkoPrice,
            List<String> errors,
            String oldProductName,
            String newProductName,
            boolean missingRetailPrice,
            boolean excludedByName,
            BigDecimal oldIncomingPrice,
            BigDecimal newIncomingPrice,
            boolean madeToOrder,
            boolean pricesLockedByPriceSetting,
            Boolean oldActive,
            Boolean oldMadeToOrder,
            Boolean newActive,
            Boolean newMadeToOrder) {
        /**
         * Compatibility constructor for previews created before storefront-state changes were
         * included in the preview.
         */
        public Row(
                int rowNumber,
                String sourceSheet,
                String status,
                String sku,
                String productName,
                BigDecimal oldPrice,
                BigDecimal newPrice,
                BigDecimal oldWholesalePrice,
                BigDecimal newWholesalePrice,
                BigDecimal oldBulkWholesalePrice,
                BigDecimal newBulkWholesalePrice,
                BigDecimal oldSkoPrice,
                BigDecimal newSkoPrice,
                List<String> errors,
                String oldProductName,
                String newProductName,
                boolean missingRetailPrice,
                boolean excludedByName,
                BigDecimal oldIncomingPrice,
                BigDecimal newIncomingPrice,
                boolean madeToOrder,
                boolean pricesLockedByPriceSetting) {
            this(
                    rowNumber,
                    sourceSheet,
                    status,
                    sku,
                    productName,
                    oldPrice,
                    newPrice,
                    oldWholesalePrice,
                    newWholesalePrice,
                    oldBulkWholesalePrice,
                    newBulkWholesalePrice,
                    oldSkoPrice,
                    newSkoPrice,
                    errors,
                    oldProductName,
                    newProductName,
                    missingRetailPrice,
                    excludedByName,
                    oldIncomingPrice,
                    newIncomingPrice,
                    madeToOrder,
                    pricesLockedByPriceSetting,
                    null,
                    null,
                    null,
                    null);
        }

        /** Compatibility constructor for previews created before price-setting protection. */
        public Row(
                int rowNumber,
                String sourceSheet,
                String status,
                String sku,
                String productName,
                BigDecimal oldPrice,
                BigDecimal newPrice,
                BigDecimal oldWholesalePrice,
                BigDecimal newWholesalePrice,
                BigDecimal oldBulkWholesalePrice,
                BigDecimal newBulkWholesalePrice,
                BigDecimal oldSkoPrice,
                BigDecimal newSkoPrice,
                List<String> errors,
                String oldProductName,
                String newProductName,
                boolean missingRetailPrice,
                boolean excludedByName,
                BigDecimal oldIncomingPrice,
                BigDecimal newIncomingPrice,
                boolean madeToOrder) {
            this(
                    rowNumber,
                    sourceSheet,
                    status,
                    sku,
                    productName,
                    oldPrice,
                    newPrice,
                    oldWholesalePrice,
                    newWholesalePrice,
                    oldBulkWholesalePrice,
                    newBulkWholesalePrice,
                    oldSkoPrice,
                    newSkoPrice,
                    errors,
                    oldProductName,
                    newProductName,
                    missingRetailPrice,
                    excludedByName,
                    oldIncomingPrice,
                    newIncomingPrice,
                    madeToOrder,
                    false);
        }

        /** Compatibility constructor for previews created before incoming cost was added. */
        public Row(
                int rowNumber,
                String sourceSheet,
                String status,
                String sku,
                String productName,
                BigDecimal oldPrice,
                BigDecimal newPrice,
                BigDecimal oldWholesalePrice,
                BigDecimal newWholesalePrice,
                BigDecimal oldBulkWholesalePrice,
                BigDecimal newBulkWholesalePrice,
                BigDecimal oldSkoPrice,
                BigDecimal newSkoPrice,
                List<String> errors,
                String oldProductName,
                String newProductName,
                boolean missingRetailPrice,
                boolean excludedByName) {
            this(
                    rowNumber,
                    sourceSheet,
                    status,
                    sku,
                    productName,
                    oldPrice,
                    newPrice,
                    oldWholesalePrice,
                    newWholesalePrice,
                    oldBulkWholesalePrice,
                    newBulkWholesalePrice,
                    oldSkoPrice,
                    newSkoPrice,
                    errors,
                    oldProductName,
                    newProductName,
                    missingRetailPrice,
                    excludedByName,
                    null,
                    null,
                    false,
                    false);
        }

        /**
         * Compatibility constructor for previews created before excluded rows could hide products.
         */
        public Row(
                int rowNumber,
                String sourceSheet,
                String status,
                String sku,
                String productName,
                BigDecimal oldPrice,
                BigDecimal newPrice,
                BigDecimal oldWholesalePrice,
                BigDecimal newWholesalePrice,
                BigDecimal oldBulkWholesalePrice,
                BigDecimal newBulkWholesalePrice,
                BigDecimal oldSkoPrice,
                BigDecimal newSkoPrice,
                List<String> errors,
                String oldProductName,
                String newProductName,
                boolean missingRetailPrice) {
            this(
                    rowNumber,
                    sourceSheet,
                    status,
                    sku,
                    productName,
                    oldPrice,
                    newPrice,
                    oldWholesalePrice,
                    newWholesalePrice,
                    oldBulkWholesalePrice,
                    newBulkWholesalePrice,
                    oldSkoPrice,
                    newSkoPrice,
                    errors,
                    oldProductName,
                    newProductName,
                    missingRetailPrice,
                    false,
                    null,
                    null,
                    false,
                    false);
        }

        public Row(
                int rowNumber,
                String sourceSheet,
                String status,
                String sku,
                String productName,
                BigDecimal oldPrice,
                BigDecimal newPrice,
                BigDecimal oldWholesalePrice,
                BigDecimal newWholesalePrice,
                BigDecimal oldBulkWholesalePrice,
                BigDecimal newBulkWholesalePrice,
                BigDecimal oldSkoPrice,
                BigDecimal newSkoPrice,
                List<String> errors,
                String oldProductName,
                String newProductName) {
            this(
                    rowNumber,
                    sourceSheet,
                    status,
                    sku,
                    productName,
                    oldPrice,
                    newPrice,
                    oldWholesalePrice,
                    newWholesalePrice,
                    oldBulkWholesalePrice,
                    newBulkWholesalePrice,
                    oldSkoPrice,
                    newSkoPrice,
                    errors,
                    oldProductName,
                    newProductName,
                    false,
                    false);
        }

        /** Compatibility constructor for previews created before product names were compared. */
        public Row(
                int rowNumber,
                String sourceSheet,
                String status,
                String sku,
                String productName,
                BigDecimal oldPrice,
                BigDecimal newPrice,
                BigDecimal oldWholesalePrice,
                BigDecimal newWholesalePrice,
                BigDecimal oldBulkWholesalePrice,
                BigDecimal newBulkWholesalePrice,
                BigDecimal oldSkoPrice,
                BigDecimal newSkoPrice,
                List<String> errors) {
            this(
                    rowNumber,
                    sourceSheet,
                    status,
                    sku,
                    productName,
                    oldPrice,
                    newPrice,
                    oldWholesalePrice,
                    newWholesalePrice,
                    oldBulkWholesalePrice,
                    newBulkWholesalePrice,
                    oldSkoPrice,
                    newSkoPrice,
                    errors,
                    productName,
                    productName,
                    false,
                    false);
        }

        /** Compatibility constructor for imports created before the SКО price type was added. */
        public Row(
                int rowNumber,
                String sourceSheet,
                String status,
                String sku,
                String productName,
                BigDecimal oldPrice,
                BigDecimal newPrice,
                BigDecimal oldWholesalePrice,
                BigDecimal newWholesalePrice,
                BigDecimal oldBulkWholesalePrice,
                BigDecimal newBulkWholesalePrice,
                List<String> errors) {
            this(
                    rowNumber,
                    sourceSheet,
                    status,
                    sku,
                    productName,
                    oldPrice,
                    newPrice,
                    oldWholesalePrice,
                    newWholesalePrice,
                    oldBulkWholesalePrice,
                    newBulkWholesalePrice,
                    null,
                    null,
                    errors,
                    productName,
                    productName,
                    false,
                    false);
        }
    }
}
