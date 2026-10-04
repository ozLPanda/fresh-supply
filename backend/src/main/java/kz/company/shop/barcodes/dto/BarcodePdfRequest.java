package kz.company.shop.barcodes.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record BarcodePdfRequest(
        BarcodePdfMode mode,
        @NotEmpty(message = "Add at least one barcode") List<@Valid BarcodeItemRequest> items,
        Boolean excludeIncompleteSheet) {
    public BarcodePdfRequest(List<BarcodeItemRequest> items) {
        this(BarcodePdfMode.COMPACT, items, false);
    }

    public BarcodePdfRequest(BarcodePdfMode mode, List<BarcodeItemRequest> items) {
        this(mode, items, false);
    }

    public BarcodePdfMode effectiveMode() {
        return mode == null ? BarcodePdfMode.COMPACT : mode;
    }

    public boolean shouldExcludeIncompleteSheet() {
        return Boolean.TRUE.equals(excludeIncompleteSheet);
    }
}
