package kz.company.shop.warehouse.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.warehouse.entity.*;
import kz.company.shop.warehouse.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

/** One calculation for preview and application. Calculation never mutates managed entities. */
@Service
public class WarehouseLedgerReplayService {
    private static final BigDecimal ZERO = BigDecimal.ZERO.setScale(3);
    private final StockMovementRepository movements;
    private final StockCostLayerRepository layers;
    private final StockDocumentLineRepository lines;
    private final OrderRepository orders;
    private final StockLedgerRevisionRepository revisions;

    public WarehouseLedgerReplayService(StockMovementRepository movements,
            StockCostLayerRepository layers, StockDocumentLineRepository lines,
            OrderRepository orders, StockLedgerRevisionRepository revisions) {
        this.movements = movements;
        this.layers = layers;
        this.lines = lines;
        this.orders = orders;
        this.revisions = revisions;
    }

    public record MovementChange(UUID documentId, UUID movementId, BigDecimal beforeQuantity,
            BigDecimal afterQuantity, BigDecimal beforeUnitCost, BigDecimal afterUnitCost,
            BigDecimal beforeShortage, BigDecimal afterShortage) {}
    public record LayerChange(UUID movementId, UUID layerId, BigDecimal beforeRemaining,
            BigDecimal afterRemaining, BigDecimal unitCost) {}
    public record OrderCostChange(Long orderItemId, BigDecimal quantity, BigDecimal beforeUnitCost,
            BigDecimal afterUnitCost, BigDecimal totalCostDifference) {}
    public record ReturnCostChange(UUID documentId, Long lineId, BigDecimal quantity,
            BigDecimal beforeUnitCost, BigDecimal afterUnitCost, BigDecimal totalCostDifference) {}
    public record ReplayPreview(Long warehouseId, Long productId, List<String> issues,
            List<MovementChange> movements, List<LayerChange> layers, BigDecimal beforeBalance,
            BigDecimal afterBalance, BigDecimal beforeStockValue, BigDecimal afterStockValue,
            List<OrderCostChange> orderCosts, List<ReturnCostChange> returnCosts,
            boolean beforeStockValueComplete, boolean afterStockValueComplete) {}

    private static final class LayerState {
        final StockMovement source;
        final StockCostLayer entity;
        final BigDecimal original;
        final BigDecimal cost;
        BigDecimal remaining;
        LayerState(StockMovement source, StockCostLayer entity, BigDecimal original, BigDecimal cost) {
            this.source = source;
            this.entity = entity;
            this.original = original;
            this.remaining = original;
            this.cost = cost;
        }
    }
    private record CostChange(StockDocumentLine line, BigDecimal cost) {}
    private record ItemChange(OrderItem item, BigDecimal cost) {}
    private record Computation(ReplayPreview preview, Map<UUID, StockMovement> movements,
            List<LayerState> layers, List<StockCostLayer> oldLayers,
            List<CostChange> lineCosts, List<ItemChange> itemCosts) {}

    @Transactional(readOnly = true, isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public ReplayPreview preview(Long warehouseId, Long productId) {
        return compute(warehouseId, productId, null).preview;
    }

    /** Caller holds the warehouse lock; all changes are committed with the triggering document. */
    @Transactional(propagation = Propagation.MANDATORY)
    public ReplayPreview apply(Long warehouseId, Long productId) {
        return apply(warehouseId, productId, null);
    }

    /** Only the currently posted backdated inventory may authorize additional historic shortages. */
    @Transactional(propagation = Propagation.MANDATORY)
    public ReplayPreview apply(Long warehouseId, Long productId, UUID triggerBackdatedInventoryId) {
        Computation result = compute(warehouseId, productId, triggerBackdatedInventoryId);
        if (!result.preview.issues.isEmpty()) {
            throw new AppExceptions.BadRequest(String.join("; ", result.preview.issues));
        }
        UUID replayId = UUID.randomUUID();
        for (MovementChange change : result.preview.movements) {
            StockMovement movement = result.movements.get(change.movementId);
            if (!same(change.beforeQuantity, change.afterQuantity)
                    || !same(change.beforeUnitCost, change.afterUnitCost)
                    || !same(change.beforeShortage, change.afterShortage)) {
                // Posting snapshots and original_* remain frozen; every derived recalculation is audited.
                StockLedgerRevision revision = new StockLedgerRevision();
                revision.id = UUID.randomUUID();
                revision.replayId = replayId;
                revision.movementId = movement.id;
                revision.beforeQuantity = change.beforeQuantity;
                revision.afterQuantity = change.afterQuantity;
                revision.beforeUnitCost = change.beforeUnitCost;
                revision.afterUnitCost = change.afterUnitCost;
                revision.beforeShortage = change.beforeShortage;
                revision.afterShortage = change.afterShortage;
                revisions.save(revision);
                movement.quantity = change.afterQuantity;
                movement.unitCost = change.afterUnitCost;
                movement.reconciledShortageQuantity = change.afterShortage;
            }
        }
        for (StockCostLayer layer : result.oldLayers) layer.remainingQuantity = ZERO;
        for (LayerState state : result.layers) {
            StockCostLayer layer = state.entity;
            if (layer == null) {
                layer = new StockCostLayer();
                layer.id = UUID.randomUUID();
                layer.sourceMovementId = state.source.id;
                layer.sourceDocumentId = state.source.documentId;
                layer.productId = productId;
                layer.warehouseId = warehouseId;
                layer.createdAt = state.source.createdAt;
            }
            layer.originalQuantity = state.original;
            layer.remainingQuantity = state.remaining;
            layer.unitCost = state.cost;
            layer.receivedAt = state.source.occurredAt;
            layers.save(layer);
        }
        result.lineCosts.forEach(change -> change.line.unitCost = change.cost);
        result.itemCosts.forEach(change -> {
            change.item.incomingPrice = change.cost == null ? null : change.cost.setScale(2, RoundingMode.HALF_UP);
            change.item.warehouseCostCalculated = true;
        });
        return result.preview;
    }

    private Computation compute(Long warehouseId, Long productId, UUID triggerBackdatedInventoryId) {
        List<Object[]> history = movements.findLedgerHistory(warehouseId, productId);
        List<StockCostLayer> oldLayers = layers.findByWarehouseIdAndProductId(warehouseId, productId);
        List<String> issues = new ArrayList<>();
        Map<UUID, StockMovement> all = new HashMap<>();
        Set<UUID> reversed = new HashSet<>();
        for (Object[] row : history) {
            StockMovement movement = (StockMovement) row[0];
            all.put(movement.id, movement);
            if (movement.reversesMovementId != null) reversed.add(movement.reversesMovementId);
            else if (movement.movementType.startsWith("CANCEL_")) {
                issues.add("Неоднозначное старое сторно " + movement.id + ", товар " + productId
                        + ": требуется восстановить связь с исходным движением");
            }
        }
        Map<UUID, StockCostLayer> byMovement = new HashMap<>();
        for (StockCostLayer layer : oldLayers) {
            if (layer.sourceMovementId == null) {
                issues.add("Неоднозначная старая партия " + layer.id + ", товар " + productId
                        + ": требуется восстановить связь с движением");
            } else if (byMovement.put(layer.sourceMovementId, layer) != null) {
                issues.add("Несколько партий для движения " + layer.sourceMovementId);
            }
        }
        List<Object[]> active = history.stream().filter(row -> {
            StockMovement movement = (StockMovement) row[0];
            StockDocument document = (StockDocument) row[1];
            return document.status == StockDocumentStatus.POSTED && document.deletedAt == null
                    && movement.reversesMovementId == null && !movement.movementType.startsWith("CANCEL_")
                    && !reversed.contains(movement.id)
                    && (document.cancelledAt == null || movement.createdAt.isAfter(document.cancelledAt));
        }).sorted(Comparator.comparing((Object[] row) -> ((StockMovement) row[0]).occurredAt)
                .thenComparing(row -> ((StockMovement) row[0]).createdAt)
                .thenComparing(row -> ((StockMovement) row[0]).id.toString())).toList();
        Set<UUID> warehouseSaleOrders = new HashSet<>();
        for (Object[] row : active) {
            StockDocument document = (StockDocument) row[1];
            if (document.documentType == StockDocumentType.SALE && document.sourceOrderId != null)
                warehouseSaleOrders.add(document.sourceOrderId);
        }
        BigDecimal balance = ZERO;
        BigDecimal oldBalance = ZERO;
        BigDecimal deficit = ZERO;
        Instant triggerInventoryPosting = null;
        List<LayerState> states = new ArrayList<>();
        Deque<LayerState> available = new ArrayDeque<>();
        Map<UUID, BigDecimal> saleCostByOrder = new HashMap<>();
        List<MovementChange> changes = new ArrayList<>();
        List<CostChange> lineCosts = new ArrayList<>();
        List<ItemChange> itemCosts = new ArrayList<>();
        Map<UUID, List<StockDocumentLine>> documentLines = new HashMap<>();
        for (Object[] row : active) {
            StockMovement movement = (StockMovement) row[0];
            StockDocument document = (StockDocument) row[1];
            if (document.documentType == StockDocumentType.OPENING_BALANCE) {
                states.forEach(state -> state.remaining = ZERO);
                available.clear();
                balance = ZERO;
                oldBalance = ZERO;
                deficit = ZERO;
                triggerInventoryPosting = null;
            }
            oldBalance = oldBalance.add(movement.quantity);
            BigDecimal delta = movement.quantity;
            BigDecimal cost = movement.originalUnitCost;
            BigDecimal shortage = ZERO;
            if (document.documentType == StockDocumentType.INVENTORY) {
                if (movement.inventoryQuantity == null) {
                    issues.add("Не найден зафиксированный факт инвентаризации " + document.id
                            + ", товар " + productId);
                } else delta = movement.inventoryQuantity.subtract(balance);
                if (document.id.equals(triggerBackdatedInventoryId)) {
                    triggerInventoryPosting = movement.createdAt;
                }
            }
            if (document.documentType == StockDocumentType.CUSTOMER_RETURN && document.sourceOrderId != null) {
                if (warehouseSaleOrders.contains(document.sourceOrderId)) {
                    if (!saleCostByOrder.containsKey(document.sourceOrderId)) {
                        issues.add("Возврат " + document.id + " расположен раньше продажи, товар " + productId);
                    } else cost = saleCostByOrder.get(document.sourceOrderId);
                }
                // Older orders can legitimately predate warehouse tracking. In that case their
                // frozen source-order cost is retained; there is no warehouse sale to recalculate.
                List<StockDocumentLine> returnLines = documentLines.computeIfAbsent(
                        document.id, lines::findByDocumentIdOrderById).stream()
                        .filter(line -> productId.equals(line.productId))
                        .filter(line -> movement.sourceLineId != null && movement.sourceLineId.equals(line.id))
                        .toList();
                if (returnLines.size() != 1) {
                    issues.add("Неоднозначная строка возврата для движения " + movement.id
                            + ": требуется восстановить связь со строкой документа");
                } else lineCosts.add(new CostChange(returnLines.get(0), cost));
            }
            if (delta.signum() > 0) {
                LayerState state = new LayerState(movement, byMovement.get(movement.id), delta, cost);
                BigDecimal offset = delta.min(deficit);
                deficit = deficit.subtract(offset);
                state.remaining = delta.subtract(offset);
                states.add(state);
                if (state.remaining.signum() > 0) available.addLast(state);
            } else if (delta.signum() < 0) {
                BigDecimal needed = delta.negate();
                BigDecimal totalCost = BigDecimal.ZERO;
                boolean unknownCost = false;
                while (needed.signum() > 0 && !available.isEmpty()) {
                    LayerState state = available.peekFirst();
                    BigDecimal taken = state.remaining.min(needed);
                    state.remaining = state.remaining.subtract(taken);
                    needed = needed.subtract(taken);
                    if (state.cost == null) unknownCost = true;
                    else totalCost = totalCost.add(taken.multiply(state.cost));
                    if (state.remaining.signum() == 0) available.removeFirst();
                }
                if (needed.signum() > 0) {
                    shortage = needed;
                    boolean explainedByBackdatedInventory = document.documentType == StockDocumentType.SALE
                            && triggerInventoryPosting != null && movement.createdAt.isBefore(triggerInventoryPosting);
                    if (!movement.allowStockShortage && !explainedByBackdatedInventory
                            && needed.compareTo(movement.reconciledShortageQuantity) > 0) {
                        issues.add("Недостаточно товара " + productId + " на дату документа "
                                + document.id + ": " + needed.toPlainString());
                    }
                    deficit = deficit.add(needed);
                    unknownCost = true;
                }
                // The order cost snapshot is monetary (scale 2). Use that same value for
                // the sale movement and its returns, avoiding analytics rounding divergence.
                cost = unknownCost ? null : totalCost.divide(delta.negate(), 2, RoundingMode.HALF_UP);
            }
            balance = balance.add(delta);
            if (document.documentType == StockDocumentType.SALE && document.sourceOrderId != null) {
                saleCostByOrder.put(document.sourceOrderId, cost);
                BigDecimal saleCost = cost;
                orders.findById(document.sourceOrderId).ifPresent(order -> order.items.stream()
                        .filter(item -> productId.equals(item.productId))
                        .forEach(item -> itemCosts.add(new ItemChange(item, saleCost))));
            }
            changes.add(new MovementChange(document.id, movement.id, movement.quantity,
                    delta, movement.unitCost, cost, movement.reconciledShortageQuantity, shortage));
        }
        List<LayerChange> layerChanges = new ArrayList<>();
        Set<UUID> includedLayers = new HashSet<>();
        BigDecimal afterValue = BigDecimal.ZERO;
        BigDecimal beforeValue = BigDecimal.ZERO;
        for (LayerState state : states) {
            layerChanges.add(new LayerChange(state.source.id,
                    state.entity == null ? null : state.entity.id,
                    state.entity == null ? ZERO : state.entity.remainingQuantity,
                    state.remaining, state.cost));
            if (state.entity != null) includedLayers.add(state.entity.id);
            if (state.cost != null) afterValue = afterValue.add(state.remaining.multiply(state.cost));
        }
        for (StockCostLayer layer : oldLayers) {
            if (layer.unitCost != null) beforeValue = beforeValue.add(layer.remainingQuantity.multiply(layer.unitCost));
            if (!includedLayers.contains(layer.id)) layerChanges.add(new LayerChange(layer.sourceMovementId,
                    layer.id, layer.remainingQuantity, ZERO, layer.unitCost));
        }
        List<OrderCostChange> orderCostChanges = itemCosts.stream().map(change ->
                new OrderCostChange(change.item.id, change.item.quantity, change.item.incomingPrice,
                        change.cost, costDifference(change.item.incomingPrice, change.cost, change.item.quantity)))
                .toList();
        List<ReturnCostChange> returnCostChanges = lineCosts.stream().map(change ->
                new ReturnCostChange(change.line.documentId, change.line.id, change.line.quantity,
                        change.line.unitCost, change.cost,
                        costDifference(change.line.unitCost, change.cost, change.line.quantity)))
                .distinct().toList();
        return new Computation(new ReplayPreview(warehouseId, productId, List.copyOf(issues),
                List.copyOf(changes), List.copyOf(layerChanges), oldBalance, balance, beforeValue, afterValue,
                orderCostChanges, returnCostChanges,
                oldLayers.stream().noneMatch(layer -> layer.remainingQuantity.signum() > 0 && layer.unitCost == null),
                states.stream().noneMatch(state -> state.remaining.signum() > 0 && state.cost == null)),
                all, states, oldLayers, lineCosts, itemCosts);
    }

    private static BigDecimal costDifference(BigDecimal before, BigDecimal after, BigDecimal quantity) {
        return before == null || after == null ? null : after.subtract(before).multiply(quantity);
    }

    private static boolean same(BigDecimal left, BigDecimal right) {
        return left == null ? right == null : right != null && left.compareTo(right) == 0;
    }
}
