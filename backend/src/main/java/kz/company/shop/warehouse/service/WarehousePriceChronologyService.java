package kz.company.shop.warehouse.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.products.entity.Product;
import kz.company.shop.warehouse.entity.*;
import kz.company.shop.warehouse.repository.StockDocumentLineRepository;
import kz.company.shop.warehouse.repository.WarehousePriceBaselineRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Only the latest business-dated setting owns today's price; formulas stay frozen. */
@Service
@Transactional(propagation = Propagation.MANDATORY)
public class WarehousePriceChronologyService {
    private final StockDocumentLineRepository lines;
    private final WarehousePriceBaselineRepository baselines;
    private final EntityManager entityManager;

    public WarehousePriceChronologyService(StockDocumentLineRepository lines,
            WarehousePriceBaselineRepository baselines, EntityManager entityManager) {
        this.lines = lines;
        this.baselines = baselines;
        this.entityManager = entityManager;
    }

    public void postPrices(StockDocument document, List<StockDocumentLine> documentLines,
            Map<Long, Product> productMap) {
        lockProducts(documentLines, productMap);
        for (StockDocumentLine line : documentLines) {
            Product product = productMap.get(line.productId);
            BigDecimal baseline = baseline(product, document.priceType);
            List<Entry> history = activeHistory(line.productId, document.priceType, document.id);
            BigDecimal expectedCardPrice = history.isEmpty() ? baseline : history.getLast().line.unitPrice;
            line.cardPriceBeforePosting = price(product, document.priceType);
            line.restoreCardPriceOnCancel = false;
            history.add(new Entry(document, line));
            history.sort(Comparator.comparing(Entry::document, WarehouseDocumentMoment.order()));
            rebasePredecessors(history, baseline);
            if (history.getLast().document.id.equals(document.id)) {
                line.restoreCardPriceOnCancel = !samePrice(line.cardPriceBeforePosting, expectedCardPrice);
                setPrice(product, document.priceType, line.unitPrice);
            }
        }
    }

    public int cancelPrices(StockDocument document, List<StockDocumentLine> documentLines,
            Map<Long, Product> productMap) {
        lockProducts(documentLines, productMap);
        int restored = 0;
        for (StockDocumentLine line : documentLines) {
            Product product = productMap.get(line.productId);
            BigDecimal baseline = baseline(product, document.priceType);
            List<Entry> before = activeHistory(line.productId, document.priceType, null);
            Entry latest = before.isEmpty() ? null : before.getLast();
            List<Entry> after = new ArrayList<>(before.stream()
                    .filter(entry -> !entry.document.id.equals(document.id)).toList());
            if (line.restoreCardPriceOnCancel) {
                // Keep a displaced manual/imported value even when an intermediate setting is
                // cancelled first. Otherwise a later cancellation would lose that external edit.
                after.stream().filter(entry -> WarehouseDocumentMoment.order()
                                .compare(entry.document, document) > 0)
                        .findFirst().ifPresent(successor -> {
                            if (!successor.line.restoreCardPriceOnCancel) {
                                successor.line.cardPriceBeforePosting = line.cardPriceBeforePosting;
                                successor.line.restoreCardPriceOnCancel = true;
                            }
                        });
            }
            rebasePredecessors(after, baseline);
            // A manual/imported card-price edit after the latest warehouse setting remains intact.
            if (latest != null && latest.document.id.equals(document.id)
                    && samePrice(price(product, document.priceType), latest.line.unitPrice)) {
                setPrice(product, document.priceType,
                        line.restoreCardPriceOnCancel ? line.cardPriceBeforePosting
                                : after.isEmpty() ? baseline : after.getLast().line.unitPrice);
                restored++;
            }
        }
        return restored;
    }

    private void lockProducts(List<StockDocumentLine> documentLines, Map<Long, Product> productMap) {
        // Prices are shared by all warehouses. Refresh under the product lock to avoid a stale
        // managed instance overwriting a price posted while this transaction waited for the lock.
        documentLines.stream().map(line -> line.productId).distinct().sorted().forEach(id -> {
            Product product = productMap.get(id);
            if (product == null) throw new AppExceptions.BadRequest("Товар не найден: " + id);
            entityManager.refresh(product, LockModeType.PESSIMISTIC_WRITE);
        });
    }

    private BigDecimal baseline(Product product, StockDocumentPriceType type) {
        WarehousePriceBaseline baseline = baselines.findByProductIdAndPriceType(product.id, type)
                .orElseGet(() -> {
                    // Legacy posted histories must have been captured by V117. Never infer a
                    // missing historical baseline from today's (possibly edited) card price.
                    if (!lines.findPostedPriceHistory(product.id, type).isEmpty()) {
                        throw new AppExceptions.BadRequest(
                                "Не найдена начальная цена для истории товара «" + product.nameRu + "»");
                    }
                    WarehousePriceBaseline created = new WarehousePriceBaseline();
                    created.id = UUID.randomUUID();
                    created.productId = product.id;
                    created.priceType = type;
                    created.baselinePrice = price(product, type);
                    return baselines.save(created);
                });
        if (baseline.reviewReason != null) {
            throw new AppExceptions.BadRequest("Товар «" + product.nameRu + "»: " + baseline.reviewReason);
        }
        return baseline.baselinePrice;
    }

    private List<Entry> activeHistory(Long productId, StockDocumentPriceType type, UUID excludedId) {
        return new ArrayList<>(lines.findPostedPriceHistory(productId, type).stream()
                .map(row -> new Entry((StockDocument) row[1], (StockDocumentLine) row[0]))
                .filter(entry -> !entry.document.id.equals(excludedId))
                .sorted(Comparator.comparing(Entry::document, WarehouseDocumentMoment.order()))
                .toList());
    }

    private static void rebasePredecessors(List<Entry> history, BigDecimal baseline) {
        BigDecimal previous = baseline;
        for (Entry entry : history) {
            entry.line.previousUnitPrice = previous;
            previous = entry.line.unitPrice;
        }
    }

    private static boolean samePrice(BigDecimal left, BigDecimal right) {
        return left == null ? right == null : right != null && left.compareTo(right) == 0;
    }

    private static BigDecimal price(Product product, StockDocumentPriceType type) {
        return switch (type) {
            case RETAIL -> product.price;
            case WHOLESALE -> product.wholesalePrice;
            case BULK_WHOLESALE -> product.bulkWholesalePrice;
            case SKO -> product.skoPrice;
            case GSKO -> product.gskoPrice;
            case INCOMING -> product.incomingPrice;
        };
    }

    private static void setPrice(Product product, StockDocumentPriceType type, BigDecimal price) {
        switch (type) {
            case RETAIL -> product.price = price;
            case WHOLESALE -> product.wholesalePrice = price;
            case BULK_WHOLESALE -> product.bulkWholesalePrice = price;
            case SKO -> product.skoPrice = price;
            case GSKO -> product.gskoPrice = price;
            case INCOMING -> product.incomingPrice = price;
        }
    }

    private record Entry(StockDocument document, StockDocumentLine line) {}
}
