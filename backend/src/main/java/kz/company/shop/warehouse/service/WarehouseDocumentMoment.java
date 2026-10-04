package kz.company.shop.warehouse.service;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Comparator;
import kz.company.shop.warehouse.entity.StockDocument;

/** Business chronology is separate from the immutable time of the user's action. */
public final class WarehouseDocumentMoment {
    public static final ZoneId ZONE = ZoneId.of("Asia/Almaty");

    private WarehouseDocumentMoment() {}

    public static Instant instant(StockDocument document) {
        if (document.effectiveDate != null) {
            return LocalDateTime.of(document.effectiveDate,
                            document.effectiveTime == null ? LocalTime.MIDNIGHT : document.effectiveTime)
                    .atZone(ZONE).toInstant();
        }
        return document.postedAt == null ? document.createdAt : document.postedAt;
    }

    public static Comparator<StockDocument> order() {
        return Comparator.comparing(WarehouseDocumentMoment::instant)
                .thenComparing(document -> document.createdAt)
                .thenComparing(document -> document.id.toString());
    }
}
