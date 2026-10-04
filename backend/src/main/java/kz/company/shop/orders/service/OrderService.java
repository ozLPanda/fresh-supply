package kz.company.shop.orders.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.carts.entity.CartItem;
import kz.company.shop.carts.service.CartService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.response.PageResult;
import kz.company.shop.notifications.service.NotificationService;
import kz.company.shop.orders.dto.*;
import kz.company.shop.orders.entity.*;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.products.service.ProductSearchTextNormalizer;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.service.UserService;
import kz.company.shop.wallets.service.WalletService;
import kz.company.shop.warehouse.service.WarehouseService;
import kz.company.shop.warehouse.dto.WarehouseDto;
import kz.company.shop.warehouse.entity.StockDocumentPriceType;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.domain.Specification;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;

@Service
public class OrderService {
    private static final ZoneId ORDER_TIME_ZONE = ZoneId.of("Asia/Almaty");
    private static final long DEFAULT_RESERVATION_HOURS = 24;
    private static final BigDecimal MIN_ORDER_QUANTITY = new BigDecimal("0.001");
    private static final BigDecimal MAX_ORDER_QUANTITY = new BigDecimal("999");

    private final OrderRepository repository;
    private final UuidV7Generator uuidV7Generator;
    private final CartService cartService;
    private final ProductService productService;
    private final WalletService walletService;
    private final UserService userService;
    private final AuditService auditService;
    private final NotificationService notificationService;
    private final PricingService pricingService;
    private final WarehouseService warehouseService;

    public OrderService(
            OrderRepository repository,
            UuidV7Generator uuidV7Generator,
            CartService cartService,
            ProductService productService,
            WalletService walletService,
            UserService userService,
            AuditService auditService,
            NotificationService notificationService,
            PricingService pricingService,
            WarehouseService warehouseService) {
        this.repository = repository;
        this.uuidV7Generator = uuidV7Generator;
        this.cartService = cartService;
        this.productService = productService;
        this.walletService = walletService;
        this.userService = userService;
        this.auditService = auditService;
        this.notificationService = notificationService;
        this.pricingService = pricingService;
        this.warehouseService = warehouseService;
    }

    @Transactional
    public OrderDto checkout(Long userId, CheckoutRequest request) {
        validateFulfillment(request);
        if (request.paymentMethod() == null) {
            throw new AppExceptions.BadRequest("Выберите способ оплаты");
        }
        if (request.paymentMethod() != PaymentMethod.BALANCE
                && request.paymentMethod() != PaymentMethod.ON_RECEIPT) {
            throw new AppExceptions.BadRequest(
                    "Этот способ оплаты подтверждает сотрудник при выдаче");
        }
        List<CartItem> cart = selectedCartItems(userId, request.cartItemIds());
        User customer = userService.byId(userId);
        Map<Long, Product> cartProducts = new LinkedHashMap<>();
        for (CartItem cartItem : cart) {
            Product product = productService.getEntity(cartItem.productId);
            if (!product.active) {
                throw new AppExceptions.BadRequest("Товар «" + product.nameRu + "» недоступен");
            }
            cartProducts.put(cartItem.productId, product);
        }
        PricingService.CartPricing cartPricing =
                pricingService.calculateCart(
                        cart.stream()
                                .map(
                                        item ->
                                                new PricingService.CartPricingLine(
                                                        cartProducts.get(item.productId),
                                                        item.quantity))
                                .toList(),
                        userService.effectivePermissions(customer),
                        customer.personalDiscountPercent,
                        request.useDiscountPrices());

        Order order = new Order();
        initializeIdentity(order);
        order.userId = userId;
        order.fulfillmentType = request.fulfillmentType();
        order.paymentMethod = request.paymentMethod();
        order.address = normalized(request.address());
        order.contactPhone = request.contactPhone().trim();
        order.comment = normalized(request.comment());

        BigDecimal total = BigDecimal.ZERO;
        for (CartItem cartItem : cart) {
            Product product = cartProducts.get(cartItem.productId);
            OrderItem item = new OrderItem();
            item.order = order;
            item.productId = product.id;
            item.madeToOrder = product.madeToOrder;
            item.sku = product.sku;
            item.nameRu = product.nameRu;
            item.quantity = BigDecimal.valueOf(cartItem.quantity);
            BigDecimal unitPrice = cartPricing.unitPrices().get(product.id);
            item.unitPrice = unitPrice;
            item.confirmedUnitPrice = unitPrice;
            item.incomingPrice = product.incomingPrice;
            item.wholesale = cartPricing.priceTier() != PriceTier.RETAIL;
            item.priceTier = cartPricing.priceTier();
            item.lineTotal = unitPrice.multiply(item.quantity);
            item.confirmedLineTotal = item.lineTotal;
            order.wholesale = order.wholesale || item.wholesale;
            total = total.add(item.lineTotal);
            appendItem(order, item);
        }
        order.priceTier = cartPricing.priceTier();
        order.total = total;
        boolean paidFromBalance = order.paymentMethod == PaymentMethod.BALANCE;
        order.paymentStatus = paidFromBalance ? PaymentStatus.PAID : PaymentStatus.PENDING;
        order.paidTotal = paidFromBalance ? total : BigDecimal.ZERO;
        Order saved = repository.save(order);
        if (paidFromBalance) {
            walletService.debit(walletService.locked(userId), total, saved.id, displayCode(saved));
        }
        cartService.removeForCheckout(userId, request.cartItemIds());
        if (!userService.isAdministrator(userId)) {
            notificationService.notifyAdminsAboutNewOrder(saved, customer);
        }
        return toDto(saved);
    }

    private List<CartItem> selectedCartItems(Long userId, List<Long> cartItemIds) {
        if (cartItemIds == null
                || cartItemIds.isEmpty()
                || cartItemIds.stream().anyMatch(id -> id == null || id <= 0)) {
            throw new AppExceptions.BadRequest("Выберите товары для оформления");
        }
        Set<Long> uniqueIds = new LinkedHashSet<>(cartItemIds);
        if (uniqueIds.size() != cartItemIds.size()) {
            throw new AppExceptions.BadRequest("Позиция корзины указана несколько раз");
        }
        List<CartItem> cart = cartService.entitiesForCheckout(userId, List.copyOf(uniqueIds));
        if (cart.isEmpty()) throw new AppExceptions.BadRequest("Выберите товары для оформления");
        if (cart.size() != uniqueIds.size()) {
            throw new AppExceptions.BadRequest(
                    "Некоторые выбранные товары больше не находятся в корзине");
        }
        return cart;
    }

    public List<OrderDto> mine(Long userId) {
        return repository.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(this::toDto)
                .toList();
    }

    public OrderDto mine(Long userId, UUID id) {
        Order order = get(id);
        if (!userId.equals(order.userId)) throw new AppExceptions.Forbidden("orders.own");
        return toDto(order);
    }

    public List<OrderDto> all() {
        return repository.findAll().stream()
                .sorted(Comparator.comparing((Order order) -> order.createdAt).reversed())
                .map(this::toDto)
                .toList();
    }

    @Transactional(readOnly = true)
    public PageResult<OrderDto> adminPage(
            String search,
            LocalDate createdFrom,
            LocalDate createdTo,
            List<OrderStatus> statuses,
            List<PriceTier> priceTiers,
            Boolean stockShortage,
            String sort,
            boolean descending,
            int page,
            int size) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.clamp(size, 1, 100);
        Page<Order> result = repository.findAll(
                adminOrdersFilter(search, createdFrom, createdTo, statuses, priceTiers, stockShortage, sort, descending),
                PageRequest.of(safePage - 1, safeSize));
        return new PageResult<>(
                result.getContent().stream().map(this::toDto).toList(),
                safePage,
                safeSize,
                result.getTotalElements(),
                result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public OrderListSummaryDto adminSummary(LocalDate createdFrom, LocalDate createdTo) {
        Specification<Order> dateFilter = adminOrdersFilter(
                null, createdFrom, createdTo, List.of(), List.of(), null, null, true);
        long total = repository.count(dateFilter);
        long newOrders = repository.count(dateFilter.and((root, query, cb) -> cb.equal(root.get("status"), OrderStatus.NEW)));
        long processing = repository.count(dateFilter.and((root, query, cb) -> cb.equal(root.get("status"), OrderStatus.PROCESSING)));
        long ready = repository.count(dateFilter.and((root, query, cb) -> cb.equal(root.get("status"), OrderStatus.READY_FOR_PICKUP)));
        return new OrderListSummaryDto(total, newOrders, processing, ready);
    }

    private Specification<Order> adminOrdersFilter(
            String search,
            LocalDate createdFrom,
            LocalDate createdTo,
            List<OrderStatus> statuses,
            List<PriceTier> priceTiers,
            Boolean stockShortage,
            String sort,
            boolean descending) {
        return (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            List<Predicate> numberSuffixMatches = new ArrayList<>();
            var displayCode = cb.concat(
                    cb.function("to_char", String.class, root.get("orderNumberDate"), cb.literal("YYYYMMDD")),
                    root.get("dailyNumber").as(String.class));
            predicates.add(cb.isNull(root.get("deletedAt")));
            if (createdFrom != null) {
                predicates.add(cb.greaterThanOrEqualTo(root.get("createdAt"), createdFrom.atStartOfDay(ORDER_TIME_ZONE).toInstant()));
            }
            if (createdTo != null) {
                predicates.add(cb.lessThan(root.get("createdAt"), createdTo.plusDays(1).atStartOfDay(ORDER_TIME_ZONE).toInstant()));
            }
            if (statuses != null && !statuses.isEmpty()) predicates.add(root.get("status").in(statuses));
            if (priceTiers != null && !priceTiers.isEmpty()) predicates.add(root.get("priceTier").in(priceTiers));
            if (stockShortage != null) {
                Subquery<Long> shortage = query.subquery(Long.class);
                Root<OrderItem> item = shortage.from(OrderItem.class);
                shortage.select(item.get("id")).where(
                        cb.equal(item.get("order"), root),
                        cb.greaterThan(item.get("stockShortageQuantity"), BigDecimal.ZERO));
                predicates.add(stockShortage ? cb.exists(shortage) : cb.not(cb.exists(shortage)));
            }
            if (search != null && !search.isBlank()) {
                for (String token : search.trim().toLowerCase(java.util.Locale.ROOT).split("\\s+")) {
                    List<Predicate> alternatives = new ArrayList<>();
                    for (String variant : ProductSearchTextNormalizer.rawSearchVariants(token)) {
                        String pattern = "%" + variant.replace('ё', 'е').replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
                        alternatives.add(cb.like(normalizedOrderSearchField(cb, root.get("comment")), pattern, '\\'));
                        alternatives.add(cb.like(normalizedOrderSearchField(cb, root.get("printComment")), pattern, '\\'));
                        Subquery<Long> customer = query.subquery(Long.class);
                        Root<User> user = customer.from(User.class);
                        customer.select(user.get("id")).where(
                                cb.equal(user.get("id"), root.get("userId")),
                                cb.or(
                                        cb.like(normalizedOrderSearchField(cb, user.get("name")), pattern, '\\'),
                                        cb.like(normalizedOrderSearchField(cb, user.get("email")), pattern, '\\')));
                        alternatives.add(cb.exists(customer));
                    }
                    if (token.matches("\\d+")) {
                        // Match the same concatenated number shown in the UI, including its date/number boundary.
                        alternatives.add(cb.like(displayCode, "%" + token + "%"));
                        numberSuffixMatches.add(cb.like(displayCode, "%" + token));
                        if (token.length() <= 8) {
                            alternatives.add(cb.equal(root.get("dailyNumber"), Long.parseLong(token)));
                        }
                    }
                    predicates.add(cb.or(alternatives.toArray(Predicate[]::new)));
                }
            }
            if (!Long.class.equals(query.getResultType())) {
                jakarta.persistence.criteria.Expression<?> sortValue;
                if ("customer".equals(sort)) {
                    Subquery<String> customerName = query.subquery(String.class);
                    Root<User> user = customerName.from(User.class);
                    customerName.select(user.get("name")).where(cb.equal(user.get("id"), root.get("userId")));
                    sortValue = customerName;
                } else if ("fulfillment".equals(sort)) {
                    Subquery<Long> assembledCount = query.subquery(Long.class);
                    Root<OrderItem> item = assembledCount.from(OrderItem.class);
                    assembledCount.select(cb.count(item)).where(cb.equal(item.get("order"), root), cb.isTrue(item.get("assembled")));
                    sortValue = assembledCount;
                } else {
                    sortValue = root.get(orderSortField(sort));
                }
                var direction = descending ? cb.desc(sortValue) : cb.asc(sortValue);
                List<jakarta.persistence.criteria.Order> ordering = new ArrayList<>();
                if (!numberSuffixMatches.isEmpty()) {
                    ordering.add(cb.asc(cb.<Integer>selectCase()
                            .when(cb.or(numberSuffixMatches.toArray(Predicate[]::new)), 0)
                            .otherwise(1)));
                }
                ordering.add(direction);
                if ("id".equals(sort)) {
                    ordering.add(descending ? cb.desc(root.get("dailyNumber")) : cb.asc(root.get("dailyNumber")));
                }
                ordering.add(cb.desc(root.get("id")));
                query.orderBy(ordering);
            }
            return cb.and(predicates.toArray(Predicate[]::new));
        };
    }

    private jakarta.persistence.criteria.Expression<String> normalizedOrderSearchField(
            jakarta.persistence.criteria.CriteriaBuilder cb,
            jakarta.persistence.criteria.Expression<String> field) {
        return cb.function("replace", String.class, cb.lower(cb.coalesce(field, "")), cb.literal("ё"), cb.literal("е"));
    }

    private String orderSortField(String sort) {
        return switch (sort == null ? "" : sort) {
            case "total" -> "total";
            case "id" -> "orderNumberDate";
            default -> "createdAt";
        };
    }

    public OrderDto adminGet(UUID id) {
        return toDto(get(id));
    }

    @Transactional
    public void softDelete(UUID id, Long actorUserId) {
        Order order = lockedGet(id);
        releaseReservation(order);
        warehouseService.softDeleteOrderDocuments(order, actorUserId);
        order.deletedAt = Instant.now();
        Order saved = repository.save(order);
        auditService.record(
                "SOFT_DELETE",
                "ORDER",
                saved.id,
                "Удалил заказ #" + displayCode(saved) + " из рабочих списков");
    }

    @Transactional
    public OrderDto updateStatus(UUID id, OrderStatus status, Long actorUserId) {
        Order order = get(id);
        OrderStatus previousStatus = order.status;
        boolean reopeningCompletedOrder =
                previousStatus == OrderStatus.COMPLETED && status != OrderStatus.COMPLETED;
        if (order.status == OrderStatus.CANCELLED && status != OrderStatus.CANCELLED) {
            throw new AppExceptions.BadRequest("Отменённый заказ нельзя вернуть в работу");
        }
        if (order.status == OrderStatus.PRICE_REVIEW
                && status != OrderStatus.PRICE_REVIEW
                && status != OrderStatus.CANCELLED) {
            throw new AppExceptions.BadRequest(
                    "Сначала покупатель должен подтвердить актуальные цены");
        }
        if (status == OrderStatus.PRICE_REVIEW && order.status != OrderStatus.PRICE_REVIEW) {
            throw new AppExceptions.BadRequest("Используйте форму актуализации цен");
        }
        if (status == OrderStatus.READY_FOR_PICKUP && !allChecked(order)) {
            throw new AppExceptions.BadRequest("Сначала проверьте все позиции заказа");
        }
        if (status == OrderStatus.COMPLETED && order.paymentStatus == PaymentStatus.PENDING) {
            throw new AppExceptions.BadRequest("Сначала подтвердите оплату заказа");
        }
        if ((status == OrderStatus.CANCELLED || reopeningCompletedOrder)
                && order.paymentStatus == PaymentStatus.PAID
                && order.paymentMethod == PaymentMethod.BALANCE) {
            if (order.createdByUserId == null && order.userId != null) {
                walletService.refund(
                        walletService.locked(order.userId),
                        paidTotal(order),
                        order.id,
                        displayCode(order),
                        actorUserId);
            }
            if (status == OrderStatus.CANCELLED) {
                order.paymentStatus = PaymentStatus.REFUNDED;
            }
        }
        // The sale document is the source of truth for stock. Reverse it before changing the
        // order status so a failed warehouse operation rolls the rollback back as well.
        if (reopeningCompletedOrder) {
            warehouseService.returnOrderSale(order, actorUserId);
        }
        if (reopeningCompletedOrder && status != OrderStatus.CANCELLED) {
            resetPaymentAfterCompletionRollback(order);
        }
        order.status = status;
        synchronizeWarehouseStatus(order, previousStatus, status, actorUserId);
        Order saved = repository.save(order);
        if (previousStatus != status) {
            auditService.record(
                    "STATUS_CHANGE",
                    "ORDER",
                    saved.id,
                    "Изменил статус заказа #"
                            + displayCode(saved)
                            + ": "
                            + previousStatus
                            + " → "
                            + status,
                    List.of(new OrderActivityChangeDto("Статус", previousStatus.name(), status.name())));
            notificationService.notifyCustomerAboutStatus(saved);
        }
        return toDto(saved);
    }

    /**
     * Holds the currently available warehouse stock without changing the order's status.
     * Repeating the action replaces the active hold and updates its expiry.
     */
    @Transactional
    public OrderDto reserve(UUID id, Instant requestedExpiresAt, Long actorUserId) {
        Instant now = Instant.now();
        Instant expiresAt =
                requestedExpiresAt == null
                        ? now.plus(DEFAULT_RESERVATION_HOURS, ChronoUnit.HOURS)
                        : requestedExpiresAt;
        if (!expiresAt.isAfter(now)) {
            throw new AppExceptions.BadRequest("Укажите время окончания резерва в будущем");
        }

        Order order = lockedGet(id);
        if (order.status != OrderStatus.PROCESSING) {
            throw new AppExceptions.BadRequest("Резерв доступен только для заказа в работе");
        }

        boolean extending =
                order.reservationExpiresAt != null && order.reservationExpiresAt.isAfter(now);
        reserveWarehouseStock(order);
        order.reservationExpiresAt = expiresAt;
        Order saved = repository.save(order);
        auditService.record(
                extending ? "RESERVATION_EXTENDED" : "RESERVATION_CREATED",
                "ORDER",
                saved.id,
                (extending ? "Продлил резерв заказа #" : "Зарезервировал товар для заказа #")
                        + displayCode(saved)
                        + " до "
                        + expiresAt.atZone(ORDER_TIME_ZONE));
        return toDto(saved);
    }

    /** Releases only expired warehouse reservations; the order stays in its current status. */
    @Scheduled(fixedDelayString = "${orders.reservation-expiry-check-ms:60000}")
    @Transactional
    public void releaseExpiredReservations() {
        Instant now = Instant.now();
        for (UUID id : repository.findExpiredReservationIds(now)) {
            Order order = repository.findForUpdateById(id).orElse(null);
            if (order == null
                    || order.reservationExpiresAt == null
                    || order.reservationExpiresAt.isAfter(now)) {
                continue;
            }
            releaseReservation(order);
            repository.save(order);
            auditService.record(
                    "RESERVATION_EXPIRED",
                    "ORDER",
                    order.id,
                    "Автоматически снял резерв заказа #" + displayCode(order));
        }
    }

    /**
     * A completed order moved back into the workflow is no longer a recorded sale. Its old
     * payment allocation cannot be reused: the composition or total may change before it is
     * completed again. Keep the order pending until the employee accepts a new payment.
     */
    private void resetPaymentAfterCompletionRollback(Order order) {
        order.paymentStatus = PaymentStatus.PENDING;
        order.paymentMethod = PaymentMethod.ON_RECEIPT;
        order.paidTotal = BigDecimal.ZERO;
        order.cashPaymentAmount = null;
        order.cashlessPaymentAmount = null;
        order.cashlessPaymentType = null;
        order.transferPaymentAmount = null;
        order.cardPaymentAmount = null;
        order.qrPaymentAmount = null;
    }

    @Transactional
    public OrderDto updatePrices(UUID id, OrderPriceUpdateRequest request, Long actorUserId) {
        Order order = get(id);
        ensurePricesEditable(order);
        BigDecimal previousTotal = order.total;

        Map<Long, BigDecimal> prices = new HashMap<>();
        for (OrderPriceUpdateItemRequest item : request.items()) {
            if (prices.put(item.orderItemId(), item.unitPrice()) != null) {
                throw new AppExceptions.BadRequest("Позиция заказа указана несколько раз");
            }
        }
        if (prices.size() != order.items.size()) {
            throw new AppExceptions.BadRequest("Передайте актуальные цены для всех позиций заказа");
        }
        List<OrderActivityChangeDto> changes = changedPrices(order, item -> prices.get(item.id));

        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.items) {
            BigDecimal unitPrice = prices.get(item.id);
            if (unitPrice == null) {
                throw new AppExceptions.BadRequest(
                        "Позиция заказа #" + item.id + " не найдена в форме цен");
            }
            item.unitPrice = unitPrice;
            item.lineTotal = unitPrice.multiply(item.quantity);
            if (request.priceTier() != null && item.productId != null) {
                item.priceTier = request.priceTier();
                item.wholesale = request.priceTier() != PriceTier.RETAIL;
            }
            total = total.add(item.lineTotal);
        }

        OrderStatus previousStatus = order.status;
        order.total = total;
        if (previousTotal.compareTo(total) != 0) {
            changes.add(
                    new OrderActivityChangeDto(
                            "Итого заказа", formatActivityMoney(previousTotal), formatActivityMoney(total)));
        }
        order.priceSourceDocumentId = null;
        if (request.priceTier() != null) {
            order.priceTier = request.priceTier();
            order.wholesale = request.priceTier() != PriceTier.RETAIL;
        }
        boolean requiresCustomerPriceConfirmation = order.createdByUserId == null;
        if (requiresCustomerPriceConfirmation) {
            order.status = OrderStatus.PRICE_REVIEW;
            releaseReservation(order);
        } else {
            confirmCurrentItemPrices(order);
        }
        Order saved = repository.save(order);
        auditService.record(
                "PRICE_REVIEW",
                "ORDER",
                saved.id,
                "Актуализировал цены заказа #"
                        + displayCode(saved)
                        + (requiresCustomerPriceConfirmation
                                ? ": " + previousStatus + " → PRICE_REVIEW"
                                : ""),
                changes);
        if (requiresCustomerPriceConfirmation) {
            notificationService.notifyCustomerAboutPriceReview(saved);
        }
        return toDto(saved);
    }

    @Transactional(readOnly = true)
    public List<WarehouseDto.DocumentSummary> priceSettingDocumentsForOrder(UUID id) {
        get(id);
        return warehouseService.listPostedPriceSettingDocuments();
    }

    /** Applies frozen prices from one active price-setting document to the entire order. */
    @Transactional
    public OrderDto updatePricesFromPriceSettingDocument(UUID id, UUID documentId, Long actorUserId) {
        Order order = get(id);
        ensurePricesEditable(order);
        BigDecimal previousTotal = order.total;
        Set<Long> productIds =
                order.items.stream()
                        .map(item -> item.productId)
                        .filter(Objects::nonNull)
                        .collect(Collectors.toCollection(LinkedHashSet::new));
        if (productIds.size() != order.items.size()) {
            throw new AppExceptions.BadRequest(
                    "Документом установки цен можно актуализировать только каталоговые позиции");
        }
        Map<Long, BigDecimal> prices = warehouseService.pricesFromPriceSettingDocument(documentId, productIds);
        WarehouseDto.PriceSettingDocumentReference source =
                warehouseService.priceSettingDocumentReference(documentId);
        if (source == null || source.deletedAt() != null) {
            throw new AppExceptions.BadRequest("Документ установки цен удалён");
        }
        List<OrderActivityChangeDto> changes = changedPrices(order, item -> prices.get(item.productId));

        BigDecimal total = BigDecimal.ZERO;
        for (OrderItem item : order.items) {
            BigDecimal unitPrice = prices.get(item.productId);
            item.unitPrice = unitPrice;
            item.lineTotal = unitPrice.multiply(item.quantity);
            total = total.add(item.lineTotal);
        }
        order.total = total;
        if (previousTotal.compareTo(total) != 0) {
            changes.add(
                    new OrderActivityChangeDto(
                            "Итого заказа", formatActivityMoney(previousTotal), formatActivityMoney(total)));
        }
        order.priceSourceDocumentId = source.id();
        PriceTier sourceTier = orderPriceTier(source.priceType());
        if (sourceTier != null) {
            order.priceTier = sourceTier;
            order.wholesale = sourceTier != PriceTier.RETAIL;
            for (OrderItem item : order.items) {
                item.priceTier = sourceTier;
                item.wholesale = sourceTier != PriceTier.RETAIL;
            }
        }
        OrderStatus previousStatus = order.status;
        boolean requiresCustomerPriceConfirmation = order.createdByUserId == null;
        if (requiresCustomerPriceConfirmation) {
            order.status = OrderStatus.PRICE_REVIEW;
            releaseReservation(order);
        } else {
            confirmCurrentItemPrices(order);
        }
        Order saved = repository.save(order);
        auditService.record(
                "PRICE_DOCUMENT_UPDATE",
                "ORDER",
                saved.id,
                "Актуализировал цены заказа #"
                        + displayCode(saved)
                        + " по документу "
                        + (source.documentNumber() == null ? source.id() : source.documentNumber()),
                changes);
        if (requiresCustomerPriceConfirmation) {
            notificationService.notifyCustomerAboutPriceReview(saved);
        }
        return toDto(saved);
    }

    @Transactional(readOnly = true)
    public List<OrderPriceTierItemDto> pricesForTier(UUID id, PriceTier priceTier) {
        Order order = get(id);
        ensurePricesEditable(order);
        return order.items.stream()
                .filter(item -> item.productId != null)
                .map(
                        item -> {
                            Product product = productService.getEntity(item.productId);
                            BigDecimal price = priceForTier(product, priceTier);
                            if (price == null || price.compareTo(BigDecimal.ZERO) <= 0) {
                                throw new AppExceptions.BadRequest(
                                        "Для товара «"
                                                + item.nameRu
                                                + "» не задана "
                                                + priceTierLabel(priceTier)
                                                + " цена");
                            }
                            return new OrderPriceTierItemDto(item.id, price);
                        })
                .toList();
    }

    @Transactional
    public OrderDto confirmPrices(Long userId, UUID id) {
        Order order = get(id);
        if (order.createdByUserId != null) {
            throw new AppExceptions.BadRequest(
                    "Заказ по штрих-кодам не требует подтверждения цен клиентом");
        }
        if (!userId.equals(order.userId)) throw new AppExceptions.Forbidden("orders.own");
        if (order.status != OrderStatus.PRICE_REVIEW) {
            throw new AppExceptions.BadRequest("Заказ не ожидает подтверждения цен");
        }

        if (order.paymentMethod == PaymentMethod.BALANCE) {
            BigDecimal delta = order.total.subtract(paidTotal(order));
            if (delta.compareTo(BigDecimal.ZERO) > 0) {
                walletService.priceDebit(
                        walletService.locked(order.userId), delta, order.id, displayCode(order));
            } else if (delta.compareTo(BigDecimal.ZERO) < 0) {
                walletService.priceRefund(
                        walletService.locked(order.userId),
                        delta.abs(),
                        order.id,
                        displayCode(order),
                        userId);
            }
        }

        for (OrderItem item : order.items) {
            item.confirmedUnitPrice = item.unitPrice;
            item.confirmedLineTotal = item.lineTotal;
        }
        if (order.paymentMethod == PaymentMethod.BALANCE) {
            order.paidTotal = order.total;
        }
        order.status = OrderStatus.PROCESSING;
        ensureDefaultReservation(order);
        Order saved = repository.save(order);
        auditService.record(
                "PRICE_CONFIRM",
                "ORDER",
                saved.id,
                "Покупатель подтвердил актуальные цены заказа #" + displayCode(saved));
        notificationService.notifyAdminsAboutPriceConfirmation(saved, userService.byId(userId));
        return toDto(saved);
    }

    @Transactional
    public OrderDto completePayment(UUID id, Long actorUserId) {
        return completePayment(id, actorUserId, PaymentMethod.CASH);
    }

    @Transactional
    public OrderDto completePayment(UUID id, Long actorUserId, PaymentMethod paymentMethod) {
        return completePayment(
                id, actorUserId, paymentMethod, null, null, null, null, null, null, null);
    }

    @Transactional
    public OrderDto completePayment(
            UUID id,
            Long actorUserId,
            PaymentMethod paymentMethod,
            BigDecimal cashAmount,
            BigDecimal cashlessAmount) {
        return completePayment(
                id,
                actorUserId,
                paymentMethod,
                cashAmount,
                cashlessAmount,
                paymentMethod == PaymentMethod.CASH ? null : CashlessPaymentType.TRANSFER,
                paymentMethod == PaymentMethod.MIXED ? cashlessAmount : null,
                null,
                null,
                null);
    }

    @Transactional
    public OrderDto completePayment(
            UUID id,
            Long actorUserId,
            PaymentMethod paymentMethod,
            BigDecimal cashAmount,
            BigDecimal cashlessAmount,
            CashlessPaymentType cashlessPaymentType) {
        return completePayment(
                id,
                actorUserId,
                paymentMethod,
                cashAmount,
                cashlessAmount,
                cashlessPaymentType,
                paymentMethod == PaymentMethod.MIXED ? cashlessAmount : null,
                null,
                null,
                null);
    }

    @Transactional
    public OrderDto completePayment(
            UUID id,
            Long actorUserId,
            PaymentMethod paymentMethod,
            BigDecimal cashAmount,
            BigDecimal cashlessAmount,
            CashlessPaymentType cashlessPaymentType,
            BigDecimal transferAmount,
            BigDecimal cardAmount,
            BigDecimal qrAmount) {
        return completePayment(
                id,
                actorUserId,
                paymentMethod,
                cashAmount,
                cashlessAmount,
                cashlessPaymentType,
                transferAmount,
                cardAmount,
                qrAmount,
                null);
    }

    @Transactional
    public OrderDto completePayment(
            UUID id,
            Long actorUserId,
            PaymentMethod paymentMethod,
            BigDecimal cashAmount,
            BigDecimal cashlessAmount,
            CashlessPaymentType cashlessPaymentType,
            BigDecimal transferAmount,
            BigDecimal cardAmount,
            BigDecimal qrAmount,
            String comment) {
        return completePayment(
                id,
                actorUserId,
                paymentMethod,
                cashAmount,
                cashlessAmount,
                cashlessPaymentType,
                transferAmount,
                cardAmount,
                qrAmount,
                comment,
                false,
                null);
    }

    @Transactional
    public OrderDto completePayment(
            UUID id,
            Long actorUserId,
            PaymentMethod paymentMethod,
            BigDecimal cashAmount,
            BigDecimal cashlessAmount,
            CashlessPaymentType cashlessPaymentType,
            BigDecimal transferAmount,
            BigDecimal cardAmount,
            BigDecimal qrAmount,
            String comment,
            boolean releaseWithStockShortage,
            String stockShortageComment) {
        return completePayment(id, actorUserId, paymentMethod, cashAmount, cashlessAmount,
                cashlessPaymentType, transferAmount, cardAmount, qrAmount, comment, null,
                releaseWithStockShortage, stockShortageComment);
    }

    @Transactional
    public OrderDto completePayment(
            UUID id, Long actorUserId, PaymentMethod paymentMethod, BigDecimal cashAmount,
            BigDecimal cashlessAmount, CashlessPaymentType cashlessPaymentType,
            BigDecimal transferAmount, BigDecimal cardAmount, BigDecimal qrAmount, String comment,
            String printComment, boolean releaseWithStockShortage, String stockShortageComment) {
        Order order = lockedGet(id);
        if (order.status == OrderStatus.CANCELLED) {
            throw new AppExceptions.BadRequest("Нельзя подтвердить оплату отменённого заказа");
        }
        if (order.paymentStatus == PaymentStatus.REFUNDED) {
            throw new AppExceptions.BadRequest("Оплата заказа уже возвращена");
        }
        if (order.paymentStatus == PaymentStatus.PAID && order.status == OrderStatus.COMPLETED) {
            return toDto(order);
        }

        OrderStatus previousStatus = order.status;
        PaymentAllocation allocation =
                paymentAllocation(
                        paymentMethod,
                        cashAmount,
                        cashlessAmount,
                        cashlessPaymentType,
                        transferAmount,
                        cardAmount,
                        qrAmount,
                        order);
        order.paidTotal = allocation.total();
        order.paymentStatus = PaymentStatus.PAID;
        order.paymentMethod = paymentMethod;
        order.cashPaymentAmount = allocation.cashAmount();
        order.cashlessPaymentAmount = allocation.cashlessAmount();
        order.cashlessPaymentType = allocation.cashlessPaymentType();
        order.transferPaymentAmount = allocation.transferAmount();
        order.cardPaymentAmount = allocation.cardAmount();
        order.qrPaymentAmount = allocation.qrAmount();
        if (comment != null) {
            order.comment = normalized(comment);
        }
        // The payment modal sends the complete, user-editable invoice comment. Keep a server-side
        // fallback for API clients that do not provide the field yet.
        order.printComment =
                normalized(printComment) != null
                        ? normalized(printComment)
                        : invoicePrintComment(actorUserId, allocation.description(), null);
        order.status = OrderStatus.COMPLETED;
        order.items.forEach(
                item -> {
                    item.assembled = true;
                    item.checked = true;
                });
        if (previousStatus != OrderStatus.COMPLETED) {
            if (releaseWithStockShortage) {
                if (warehouseService.hasRecordedOrderSale(order)) {
                    warehouseService.postOrderSaleWithShortage(
                            order, actorUserId, stockShortageComment, true);
                } else {
                    warehouseService.postOrderSaleWithShortage(order, actorUserId, stockShortageComment);
                }
            } else {
                if (warehouseService.hasRecordedOrderSale(order)) {
                    warehouseService.postOrderSale(order, actorUserId, true);
                } else {
                    warehouseService.postOrderSale(order, actorUserId);
                }
            }
        }
        order.reservationExpiresAt = null;
        Order saved = repository.save(order);
        auditService.record(
                releaseWithStockShortage ? "STOCK_SHORTAGE_RELEASE" : "PAYMENT_COMPLETE",
                "ORDER",
                saved.id,
                (releaseWithStockShortage
                                ? "Отпустил с расхождением по остаткам заказ #"
                                : "Подтвердил оплату и завершил заказ #")
                        + displayCode(saved)
                        + " ("
                        + allocation.description()
                        + ")"
                        + ": "
                        + previousStatus
                        + " → COMPLETED");
        if (saved.userId != null && previousStatus != OrderStatus.COMPLETED) {
            notificationService.notifyCustomerAboutStatus(saved);
        }
        return toDto(saved);
    }

    @Transactional
    public OrderDto updateComment(UUID id, String comment, Long actorUserId) {
        Order order = lockedGet(id);
        String previousComment = order.comment;
        order.comment = normalized(comment);
        Order saved = repository.save(order);
        auditService.record(
                "COMMENT_UPDATE",
                "ORDER",
                saved.id,
                "Обновил комментарий к заказу #" + displayCode(saved),
                List.of(new OrderActivityChangeDto("Комментарий", previousComment, saved.comment)));
        return toDto(saved);
    }

    @Transactional
    public OrderDto updatePrintComment(UUID id, String printComment, Long actorUserId) {
        Order order = lockedGet(id);
        String previousComment = order.printComment;
        order.printComment = normalized(printComment);
        Order saved = repository.save(order);
        auditService.record(
                "PRINT_COMMENT_UPDATE",
                "ORDER",
                saved.id,
                "Обновил комментарий для накладной заказа #" + displayCode(saved),
                List.of(
                        new OrderActivityChangeDto(
                                "Комментарий для накладной", previousComment, saved.printComment)));
        return toDto(saved);
    }

    @Transactional
    public OrderDto updateCompletedPayment(
            UUID id,
            Long actorUserId,
            PaymentMethod paymentMethod,
            BigDecimal cashAmount,
            BigDecimal cashlessAmount,
            CashlessPaymentType cashlessPaymentType,
            BigDecimal transferAmount,
            BigDecimal cardAmount,
            BigDecimal qrAmount) {
        Order order = lockedGet(id);
        if (order.status != OrderStatus.COMPLETED || order.paymentStatus != PaymentStatus.PAID) {
            throw new AppExceptions.BadRequest(
                    "Способ оплаты можно изменить только у оплаченного завершённого заказа");
        }
        if (order.paymentMethod == PaymentMethod.BALANCE) {
            throw new AppExceptions.BadRequest(
                    "Оплату с баланса нельзя изменить без отдельного возврата средств");
        }
        if (paymentMethod != PaymentMethod.CASH
                && paymentMethod != PaymentMethod.CASHLESS
                && paymentMethod != PaymentMethod.KASPI_STORE
                && paymentMethod != PaymentMethod.MIXED) {
            throw new AppExceptions.BadRequest(
                    "Выберите наличный, безналичный, Kaspi Магазин или комбинированный расчёт");
        }

        PaymentMethod previousMethod = order.paymentMethod;
        PaymentAllocation allocation =
                paymentAllocation(
                        paymentMethod,
                        cashAmount,
                        cashlessAmount,
                        cashlessPaymentType,
                        transferAmount,
                        cardAmount,
                        qrAmount,
                        order);
        order.paidTotal = allocation.total();
        order.paymentMethod = paymentMethod;
        order.cashPaymentAmount = allocation.cashAmount();
        order.cashlessPaymentAmount = allocation.cashlessAmount();
        order.cashlessPaymentType = allocation.cashlessPaymentType();
        order.transferPaymentAmount = allocation.transferAmount();
        order.cardPaymentAmount = allocation.cardAmount();
        order.qrPaymentAmount = allocation.qrAmount();
        order.printComment = invoicePrintComment(actorUserId, allocation.description(), null);
        Order saved = repository.save(order);
        auditService.record(
                "PAYMENT_METHOD_UPDATE",
                "ORDER",
                saved.id,
                "Изменил способ оплаты заказа #"
                        + displayCode(saved)
                        + ": "
                        + paymentMethodLabel(previousMethod)
                        + " → "
                        + allocation.description());
        return toDto(saved);
    }

    private String paymentMethodLabel(PaymentMethod paymentMethod) {
        return switch (paymentMethod) {
            case CASH -> "наличный расчёт";
            case CASHLESS -> "безналичный расчёт";
            case KASPI_STORE -> "Kaspi Магазин";
            case MIXED -> "комбинированный расчёт";
            default -> throw new AppExceptions.BadRequest("Выберите способ расчёта");
        };
    }

    private PaymentAllocation paymentAllocation(
            PaymentMethod paymentMethod,
            BigDecimal cashAmount,
            BigDecimal cashlessAmount,
            CashlessPaymentType cashlessPaymentType,
            BigDecimal transferAmount,
            BigDecimal cardAmount,
            BigDecimal qrAmount,
            Order order) {
        BigDecimal total = confirmedTotal(order);
        if (paymentMethod == PaymentMethod.CASH) {
            return new PaymentAllocation(
                    total,
                    BigDecimal.ZERO,
                    total,
                    null,
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    paymentMethodLabel(paymentMethod));
        }
        if (paymentMethod == PaymentMethod.CASHLESS && cashlessPaymentType != null) {
            BigDecimal transfer =
                    cashlessPaymentType == CashlessPaymentType.TRANSFER ? total : BigDecimal.ZERO;
            BigDecimal card =
                    cashlessPaymentType == CashlessPaymentType.CARD ? total : BigDecimal.ZERO;
            BigDecimal qr = cashlessPaymentType == CashlessPaymentType.QR ? total : BigDecimal.ZERO;
            return new PaymentAllocation(
                    BigDecimal.ZERO,
                    total,
                    total,
                    cashlessPaymentType,
                    transfer,
                    card,
                    qr,
                    cashlessPaymentLabel(cashlessPaymentType));
        }
        if (paymentMethod == PaymentMethod.KASPI_STORE) {
            return new PaymentAllocation(
                    BigDecimal.ZERO,
                    total,
                    total,
                    null,
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    BigDecimal.ZERO,
                    paymentMethodLabel(paymentMethod));
        }
        BigDecimal transfer = zeroIfNull(transferAmount);
        BigDecimal card = zeroIfNull(cardAmount);
        BigDecimal qr = zeroIfNull(qrAmount);
        BigDecimal cashless = transfer.add(card).add(qr);
        if (paymentMethod != PaymentMethod.MIXED
                || cashAmount == null
                || cashAmount.compareTo(BigDecimal.ZERO) <= 0
                || transfer.compareTo(BigDecimal.ZERO) < 0
                || card.compareTo(BigDecimal.ZERO) < 0
                || qr.compareTo(BigDecimal.ZERO) < 0
                || cashless.compareTo(BigDecimal.ZERO) <= 0
                || cashAmount.add(cashless).compareTo(total) != 0) {
            throw new AppExceptions.BadRequest(
                    "Для комбинированной оплаты укажите положительные суммы наличного расчёта и хотя бы одного вида безналичного расчёта, равные итогу заказа");
        }
        return new PaymentAllocation(
                cashAmount,
                cashless,
                total,
                null,
                transfer,
                card,
                qr,
                paymentMethodLabel(paymentMethod)
                        + ": наличными "
                        + cashAmount.toPlainString()
                        + mixedCashlessDescription(transfer, card, qr));
    }

    private BigDecimal zeroIfNull(BigDecimal amount) {
        return amount == null ? BigDecimal.ZERO : amount;
    }

    private String mixedCashlessDescription(BigDecimal transfer, BigDecimal card, BigDecimal qr) {
        StringBuilder description = new StringBuilder();
        if (transfer.compareTo(BigDecimal.ZERO) > 0)
            description.append(", перевод ").append(transfer.toPlainString());
        if (card.compareTo(BigDecimal.ZERO) > 0)
            description.append(", картой ").append(card.toPlainString());
        if (qr.compareTo(BigDecimal.ZERO) > 0)
            description.append(", QR ").append(qr.toPlainString());
        return description.toString();
    }

    private String invoicePrintComment(Long actorUserId, String paymentDescription, String extraComment) {
        List<String> parts = new java.util.ArrayList<>();
        String template = normalized(userService.byId(actorUserId).orderInvoiceTemplate);
        if (template != null) parts.add(template);
        parts.add(paymentDescription);
        String extra = normalized(extraComment);
        if (extra != null) parts.add(extra);
        return String.join("\n", parts);
    }

    private record PaymentAllocation(
            BigDecimal cashAmount,
            BigDecimal cashlessAmount,
            BigDecimal total,
            CashlessPaymentType cashlessPaymentType,
            BigDecimal transferAmount,
            BigDecimal cardAmount,
            BigDecimal qrAmount,
            String description) {}

    private String cashlessPaymentLabel(CashlessPaymentType type) {
        return switch (type) {
            case TRANSFER -> "перевод";
            case CARD -> "картой";
            case QR -> "QR";
        };
    }

    @Transactional
    public OrderDto updateFulfillmentAssignees(
            UUID id, OrderFulfillmentAssigneesRequest request, Long actorUserId) {
        Order order = get(id);
        ensureFulfillmentEditable(order);
        Long previousAssemblyAssigneeId = order.assemblyAssigneeId;
        Long previousCheckingAssigneeId = order.checkingAssigneeId;
        order.assemblyAssigneeId = checkedAssigneeId(request.assemblyAssigneeId(), "сборщика");
        order.checkingAssigneeId = checkedAssigneeId(request.checkingAssigneeId(), "проверяющего");
        Order saved = repository.save(order);
        auditService.record(
                "FULFILLMENT_ASSIGNEES",
                "ORDER",
                saved.id,
                "Обновил ответственных заказа #" + displayCode(saved),
                List.of(
                        new OrderActivityChangeDto(
                                "Сборщик",
                                assigneeName(previousAssemblyAssigneeId),
                                assigneeName(saved.assemblyAssigneeId)),
                        new OrderActivityChangeDto(
                                "Проверяющий",
                                assigneeName(previousCheckingAssigneeId),
                                assigneeName(saved.checkingAssigneeId))));
        return toDto(saved);
    }

    @Transactional
    public OrderDto addManualItem(UUID id, OrderManualItemCreateRequest request, Long actorUserId) {
        Order order = get(id);
        ensureItemsEditable(order);
        validateOrderItemQuantity(request.quantity());
        OrderItem item = new OrderItem();
        item.order = order;
        item.productId = null;
        item.sku = "Ручная позиция";
        item.nameRu = request.nameRu().trim();
        item.quantity = request.quantity();
        item.unitPrice = request.unitPrice();
        item.confirmedUnitPrice = request.unitPrice();
        item.lineTotal = request.unitPrice().multiply(request.quantity());
        item.confirmedLineTotal = item.lineTotal;
        item.wholesale = false;
        item.priceTier = PriceTier.RETAIL;
        appendItem(order, item);
        order.total = order.total.add(item.lineTotal);
        Order saved = repository.save(order);
        auditService.record(
                "MANUAL_ITEM_ADD",
                "ORDER",
                saved.id,
                "Добавил ручную позицию в заказ #" + displayCode(saved));
        return toDto(saved);
    }

    @Transactional
    public OrderDto addCatalogItem(
            UUID id, OrderCatalogItemCreateRequest request, Long actorUserId) {
        Order order = get(id);
        ensureItemsEditable(order);
        validateOrderItemQuantity(request.quantity());

        Product product = productService.getEntity(request.productId());
        if (!product.active) {
            throw new AppExceptions.BadRequest("Товар «" + product.nameRu + "» недоступен");
        }

        OrderItem existingItem =
                order.items.stream()
                        .filter(item -> request.productId().equals(item.productId))
                        .findFirst()
                        .orElse(null);
        if (existingItem != null) {
            BigDecimal quantity = existingItem.quantity.add(request.quantity());
            if (quantity.compareTo(BigDecimal.valueOf(999)) > 0) {
                throw new AppExceptions.BadRequest("Количество товара не может превышать 999");
            }
            existingItem.quantity = quantity;
            existingItem.lineTotal = existingItem.unitPrice.multiply(quantity);
            existingItem.confirmedLineTotal = existingItem.confirmedUnitPrice.multiply(quantity);
        } else {
            PriceTier priceTier = order.priceTier == null ? PriceTier.RETAIL : order.priceTier;
            BigDecimal unitPrice = priceForTier(product, priceTier);
            if (unitPrice == null || unitPrice.compareTo(BigDecimal.ZERO) <= 0) {
                throw new AppExceptions.BadRequest(
                        "Для товара «"
                                + product.nameRu
                                + "» не задана "
                                + priceTierLabel(priceTier)
                                + " цена");
            }

            OrderItem item = new OrderItem();
            item.order = order;
            item.productId = product.id;
            item.madeToOrder = product.madeToOrder;
            item.sku = product.sku;
            item.nameRu = product.nameRu;
            item.quantity = request.quantity();
            item.unitPrice = unitPrice;
            item.confirmedUnitPrice = unitPrice;
            item.incomingPrice = product.incomingPrice;
            item.lineTotal = unitPrice.multiply(item.quantity);
            item.confirmedLineTotal = item.lineTotal;
            item.wholesale = priceTier != PriceTier.RETAIL;
            item.priceTier = priceTier;
            appendItem(order, item);
        }

        order.total =
                order.items.stream()
                        .map(item -> item.lineTotal)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
        synchronizeWarehouseReservation(order);
        Order saved = repository.save(order);
        auditService.record(
                "CATALOG_ITEM_ADD",
                "ORDER",
                saved.id,
                "Добавил товар «" + product.nameRu + "» в заказ #" + displayCode(saved));
        return toDto(saved);
    }

    @Transactional
    public OrderDto updateItemQuantity(
            UUID id, Long itemId, OrderItemQuantityUpdateRequest request, Long actorUserId) {
        Order order = get(id);
        ensureItemsEditable(order);
        validateOrderItemQuantity(request.quantity());
        OrderItem item = getOrderItem(order, itemId);
        BigDecimal previousQuantity = item.quantity;

        item.quantity = request.quantity();
        item.lineTotal = item.unitPrice.multiply(item.quantity);
        item.confirmedLineTotal = item.confirmedUnitPrice.multiply(item.quantity);
        updateOrderTotal(order);
        if (item.quantity.compareTo(previousQuantity) <= 0) {
            reduceWarehouseReservation(order, item.productId);
        } else {
            synchronizeWarehouseReservation(order);
        }

        Order saved = repository.save(order);
        auditService.record(
                "ORDER_ITEM_QUANTITY_UPDATE",
                "ORDER",
                saved.id,
                "Изменил количество позиции «" + item.nameRu + "» в заказе #" + displayCode(saved),
                List.of(
                        new OrderActivityChangeDto(
                                "Количество: " + item.nameRu,
                                previousQuantity.toPlainString(),
                                item.quantity.toPlainString())));
        return toDto(saved);
    }

    @Transactional
    public OrderDto updateItemOrder(
            UUID id, OrderItemOrderUpdateRequest request, Long actorUserId) {
        Order order = get(id);
        ensureItemsEditable(order);
        Set<Long> requestedItemIds = new HashSet<>(request.itemIds());
        Set<Long> orderItemIds =
                order.items.stream().map(item -> item.id).collect(Collectors.toSet());
        if (requestedItemIds.size() != request.itemIds().size()
                || requestedItemIds.size() != order.items.size()
                || !requestedItemIds.equals(orderItemIds)) {
            throw new AppExceptions.BadRequest("Передайте актуальный порядок всех позиций заказа");
        }

        Map<Long, OrderItem> itemsById =
                order.items.stream().collect(Collectors.toMap(item -> item.id, item -> item));
        for (int position = 0; position < request.itemIds().size(); position++) {
            itemsById.get(request.itemIds().get(position)).sortOrder = position;
        }
        order.items.sort(Comparator.comparingInt(item -> item.sortOrder));
        Order saved = repository.save(order);
        auditService.record(
                "ORDER_ITEM_ORDER_UPDATE",
                "ORDER",
                saved.id,
                "Изменил порядок позиций заказа #" + displayCode(saved));
        return toDto(saved);
    }

    @Transactional
    public OrderDto deleteItem(UUID id, Long itemId, Long actorUserId) {
        Order order = get(id);
        ensureItemsEditable(order);
        if (order.items.size() <= 1) {
            throw new AppExceptions.BadRequest(
                    "Нельзя удалить последнюю позицию заказа. Отмените заказ целиком.");
        }

        OrderItem item = getOrderItem(order, itemId);
        String itemName = item.nameRu;
        warehouseService.detachAutomaticReturnLines(order, itemId);
        order.items.remove(item);
        updateOrderTotal(order);
        reduceWarehouseReservation(order, item.productId);

        Order saved = repository.save(order);
        auditService.record(
                "ORDER_ITEM_DELETE",
                "ORDER",
                saved.id,
                "Удалил позицию «" + itemName + "» из заказа #" + displayCode(saved));
        return toDto(saved);
    }

    @Transactional
    public OrderDto copy(UUID id, Long actorUserId) {
        Order source = get(id);
        if (source.items.isEmpty()) {
            throw new AppExceptions.BadRequest("Нельзя создать заказ на основе заказа без позиций");
        }

        Order copy = new Order();
        initializeIdentity(copy);
        copy.userId = source.userId;
        copy.createdByUserId = actorUserId;
        copy.status = OrderStatus.PROCESSING;
        copy.paymentStatus = PaymentStatus.PENDING;
        copy.paymentMethod = PaymentMethod.ON_RECEIPT;
        copy.fulfillmentType = source.fulfillmentType;
        copy.address = source.address;
        copy.contactPhone = source.contactPhone;
        copy.pendingCustomerEmail = source.pendingCustomerEmail;
        copy.pendingCustomerPhone = source.pendingCustomerPhone;
        copy.comment = source.comment;
        copy.printComment = source.printComment;
        copy.wholesale = source.wholesale;
        copy.priceTier = source.priceTier;
        copy.total = BigDecimal.ZERO;
        copy.paidTotal = BigDecimal.ZERO;

        for (OrderItem sourceItem : source.items) {
            OrderItem item = new OrderItem();
            item.order = copy;
            item.productId = sourceItem.productId;
            item.madeToOrder = sourceItem.madeToOrder;
            item.sku = sourceItem.sku;
            item.nameRu = sourceItem.nameRu;
            item.unitPrice = sourceItem.unitPrice;
            item.confirmedUnitPrice = sourceItem.unitPrice;
            item.incomingPrice = sourceItem.incomingPrice;
            item.wholesale = sourceItem.wholesale;
            item.priceTier = sourceItem.priceTier;
            item.quantity = sourceItem.quantity;
            item.lineTotal = item.unitPrice.multiply(item.quantity);
            item.confirmedLineTotal = item.lineTotal;
            copy.total = copy.total.add(item.lineTotal);
            appendItem(copy, item);
        }

        Order saved = repository.save(copy);
        ensureDefaultReservation(saved);
        auditService.record(
                "ORDER_COPY",
                "ORDER",
                saved.id,
                "Создал заказ #"
                        + displayCode(saved)
                        + " на основе заказа #"
                        + displayCode(source));
        return toDto(saved);
    }

    @Transactional
    public OrderDto updateFulfillmentItem(
            UUID id, Long itemId, OrderFulfillmentItemRequest request, Long actorUserId) {
        Order order = get(id);
        ensureFulfillmentEditable(order);
        OrderItem item =
                order.items.stream()
                        .filter(candidate -> candidate.id.equals(itemId))
                        .findFirst()
                .orElseThrow(() -> new AppExceptions.NotFound("Позиция заказа не найдена"));
        OrderStatus previousStatus = order.status;
        boolean previousAssembled = item.assembled;
        boolean previousChecked = item.checked;
        if (request.checked() && !request.assembled()) {
            throw new AppExceptions.BadRequest("Позицию нужно сначала отметить как собранную");
        }
        if (item.assembled != request.assembled()
                && !actorUserId.equals(order.assemblyAssigneeId)) {
            throw new AppExceptions.Forbidden("orders.fulfillment.assembly");
        }
        if (item.checked != request.checked() && !actorUserId.equals(order.checkingAssigneeId)) {
            throw new AppExceptions.Forbidden("orders.fulfillment.checking");
        }
        item.assembled = request.assembled();
        item.checked = request.checked();
        if (allChecked(order)) {
            order.status = OrderStatus.READY_FOR_PICKUP;
        } else if (order.status == OrderStatus.READY_FOR_PICKUP) {
            order.status = OrderStatus.PROCESSING;
        }
        Order saved = repository.save(order);
        auditService.record(
                "FULFILLMENT_ITEM",
                "ORDER",
                saved.id,
                "Обновил прогресс позиции #" + item.id + " заказа #" + displayCode(saved),
                List.of(
                        new OrderActivityChangeDto(
                                "Собрано: " + item.nameRu,
                                previousAssembled ? "Да" : "Нет",
                                item.assembled ? "Да" : "Нет"),
                        new OrderActivityChangeDto(
                                "Проверено: " + item.nameRu,
                                previousChecked ? "Да" : "Нет",
                                item.checked ? "Да" : "Нет")));
        if (previousStatus != OrderStatus.READY_FOR_PICKUP
                && saved.status == OrderStatus.READY_FOR_PICKUP) {
            notificationService.notifyCustomerAboutStatus(saved);
        }
        return toDto(saved);
    }

    private Order get(UUID id) {
        return repository
                .findWithItemsById(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Заказ не найден"));
    }

    private OrderItem getOrderItem(Order order, Long itemId) {
        return order.items.stream()
                .filter(item -> item.id.equals(itemId))
                .findFirst()
                .orElseThrow(() -> new AppExceptions.NotFound("Позиция заказа не найдена"));
    }

    private void updateOrderTotal(Order order) {
        order.total =
                order.items.stream()
                        .map(item -> item.lineTotal)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private void appendItem(Order order, OrderItem item) {
        item.sortOrder =
                order.items.stream().mapToInt(candidate -> candidate.sortOrder).max().orElse(-1)
                        + 1;
        order.items.add(item);
    }

    private void synchronizeWarehouseReservation(Order order) {
        if (order.reservationExpiresAt == null) return;
        if (order.reservationExpiresAt.isAfter(Instant.now())) {
            reserveWarehouseStock(order);
        } else {
            releaseReservation(order);
        }
    }

    private void reduceWarehouseReservation(Order order, Long productId) {
        if (order.reservationExpiresAt == null) return;
        if (order.reservationExpiresAt.isAfter(Instant.now())) {
            warehouseService.reduceOrderReservations(order, productId);
        } else {
            releaseReservation(order);
        }
    }

    private void synchronizeWarehouseStatus(
            Order order, OrderStatus previousStatus, OrderStatus nextStatus, Long actorUserId) {
        if (previousStatus == nextStatus) {
            return;
        }
        if (nextStatus == OrderStatus.COMPLETED) {
            if (warehouseService.hasRecordedOrderSale(order)) {
                warehouseService.postOrderSale(order, actorUserId, true);
            } else {
                warehouseService.postOrderSale(order, actorUserId);
            }
            order.reservationExpiresAt = null;
            return;
        }
        if (nextStatus == OrderStatus.CANCELLED) {
            releaseReservation(order);
            return;
        }
        if (nextStatus == OrderStatus.PROCESSING) {
            ensureDefaultReservation(order, previousStatus == OrderStatus.COMPLETED);
        }
    }

    void ensureDefaultReservation(Order order) {
        ensureDefaultReservation(order, false);
    }

    void ensureDefaultReservation(Order order, boolean allowStockShortage) {
        Instant now = Instant.now();
        if (order.reservationExpiresAt != null && order.reservationExpiresAt.isAfter(now)) return;
        order.reservationExpiresAt = now.plus(DEFAULT_RESERVATION_HOURS, ChronoUnit.HOURS);
        if (allowStockShortage) {
            warehouseService.reserveOrder(order, true);
        } else {
            reserveWarehouseStock(order);
        }
    }

    private void reserveWarehouseStock(Order order) {
        boolean previouslyReleasedWithShortage =
                order.items.stream()
                        .anyMatch(
                                item ->
                                        item.stockShortageQuantity != null
                                                && item.stockShortageQuantity.signum() > 0);
        // A reopened order remains editable even after its shortage lines are removed. The
        // recorded sale, rather than the current lines, identifies that workflow.
        if (previouslyReleasedWithShortage || warehouseService.hasRecordedOrderSale(order)) {
            warehouseService.reserveOrder(order, true);
        } else {
            warehouseService.reserveOrder(order);
        }
    }

    private void releaseReservation(Order order) {
        warehouseService.releaseOrderReservations(order);
        order.reservationExpiresAt = null;
    }

    private void ensurePricesEditable(Order order) {
        if (order.status == OrderStatus.COMPLETED) {
            throw new AppExceptions.BadRequest(
                    "Чтобы изменить цены завершённого заказа, сначала переведите его в статус «В работе»");
        }
        if (order.status == OrderStatus.READY_FOR_PICKUP || order.status == OrderStatus.CANCELLED) {
            throw new AppExceptions.BadRequest(
                    "Актуализировать цены можно только для заказа в работе");
        }
    }

    private void ensureItemsEditable(Order order) {
        if (order.status == OrderStatus.READY_FOR_PICKUP
                || order.status == OrderStatus.COMPLETED
                || order.status == OrderStatus.CANCELLED) {
            throw new AppExceptions.BadRequest(
                    "Нельзя изменять позиции в завершённом или отменённом заказе");
        }
    }

    private void validateOrderItemQuantity(BigDecimal quantity) {
        if (quantity == null
                || quantity.compareTo(MIN_ORDER_QUANTITY) < 0
                || quantity.compareTo(MAX_ORDER_QUANTITY) > 0
                || quantity.scale() > 3) {
            throw new AppExceptions.BadRequest(
                    "Количество товара должно быть от 0,001 до 999 с точностью до тысячной");
        }
    }

    private BigDecimal priceForTier(Product product, PriceTier priceTier) {
        return switch (priceTier) {
            case RETAIL -> product.price;
            case WHOLESALE -> product.wholesalePrice;
            case BULK_WHOLESALE -> product.bulkWholesalePrice;
            case SKO -> product.skoPrice;
        };
    }

    private PriceTier orderPriceTier(StockDocumentPriceType priceType) {
        if (priceType == null) return null;
        return switch (priceType) {
            case RETAIL -> PriceTier.RETAIL;
            case WHOLESALE -> PriceTier.WHOLESALE;
            case BULK_WHOLESALE -> PriceTier.BULK_WHOLESALE;
            case SKO -> PriceTier.SKO;
            case GSKO, INCOMING -> null;
        };
    }

    private String priceTierLabel(PriceTier priceTier) {
        return switch (priceTier) {
            case RETAIL -> "розничная";
            case WHOLESALE -> "оптовая";
            case BULK_WHOLESALE -> "крупно-оптовая";
            case SKO -> "СКО";
        };
    }

    private List<OrderActivityChangeDto> changedPrices(
            Order order, Function<OrderItem, BigDecimal> nextPrice) {
        List<OrderActivityChangeDto> changes = new ArrayList<>();
        for (OrderItem item : order.items) {
            BigDecimal next = nextPrice.apply(item);
            if (next != null && item.unitPrice.compareTo(next) != 0) {
                changes.add(
                        new OrderActivityChangeDto(
                                "Цена: " + item.nameRu,
                                formatActivityMoney(item.unitPrice),
                                formatActivityMoney(next)));
            }
        }
        return changes;
    }

    private String formatActivityMoney(BigDecimal value) {
        return value.stripTrailingZeros().toPlainString() + " ₸";
    }

    private Order lockedGet(UUID id) {
        return repository
                .findForUpdateById(id)
                .orElseThrow(() -> new AppExceptions.NotFound("Заказ не найден"));
    }

    private void validateFulfillment(CheckoutRequest request) {
        if (request.fulfillmentType() == FulfillmentType.DELIVERY
                && normalized(request.address()) == null) {
            throw new AppExceptions.BadRequest("Для доставки укажите адрес");
        }
    }

    private String normalized(String value) {
        if (value == null || value.isBlank()) return null;
        return value.trim();
    }

    private BigDecimal paidTotal(Order order) {
        return order.paidTotal != null ? order.paidTotal : order.total;
    }

    /** Staff-created orders accept updated prices without a separate customer confirmation. */
    private void confirmCurrentItemPrices(Order order) {
        for (OrderItem item : order.items) {
            item.confirmedUnitPrice = item.unitPrice;
            item.confirmedLineTotal = item.lineTotal;
        }
    }

    private BigDecimal confirmedTotal(Order order) {
        BigDecimal total =
                order.items.stream()
                        .map(
                                item ->
                                        item.confirmedLineTotal != null
                                                ? item.confirmedLineTotal
                                                : item.lineTotal)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
        return total.compareTo(BigDecimal.ZERO) > 0 ? total : order.total;
    }

    private Long checkedAssigneeId(Long userId, String assignmentLabel) {
        if (userId == null) return null;
        return userService.activeWithPermission(userId, "orders.update", assignmentLabel).id;
    }

    private String assigneeName(Long userId) {
        if (userId == null) return null;
        return userService.byId(userId).name;
    }

    private void ensureFulfillmentEditable(Order order) {
        if (order.status != OrderStatus.PROCESSING
                && order.status != OrderStatus.READY_FOR_PICKUP) {
            throw new AppExceptions.BadRequest(
                    "Сборка и проверка доступны только для заказа в работе");
        }
    }

    private boolean allChecked(Order order) {
        return !order.items.isEmpty() && order.items.stream().allMatch(item -> item.checked);
    }

    private User assignee(Long userId) {
        return userId == null ? null : userService.byId(userId);
    }

    void initializeIdentity(Order order) {
        LocalDate orderDate = LocalDate.now(ORDER_TIME_ZONE);
        initializeIdentity(order, orderDate);
    }

    void initializeIdentity(Order order, LocalDate orderDate) {
        order.id = uuidV7Generator.next();
        order.orderNumberDate = orderDate;
        order.dailyNumber = repository.nextDailyNumber(orderDate);
    }

    public String displayCode(Order order) {
        return order.displayCode();
    }

    OrderDto toDto(Order order) {
        User user = order.userId == null ? null : userService.byId(order.userId);
        User assemblyAssignee = assignee(order.assemblyAssigneeId);
        User checkingAssignee = assignee(order.checkingAssigneeId);
        WarehouseDto.PriceSettingDocumentReference priceSource =
                warehouseService.priceSettingDocumentReference(order.priceSourceDocumentId);
        int assembledItems = (int) order.items.stream().filter(item -> item.assembled).count();
        int checkedItems = (int) order.items.stream().filter(item -> item.checked).count();
        return new OrderDto(
                order.id,
                displayCode(order),
                order.userId,
                order.createdByUserId,
                user != null ? user.name : null,
                user != null ? user.email : null,
                order.status,
                order.paymentStatus,
                order.paymentMethod,
                order.cashPaymentAmount,
                order.cashlessPaymentAmount,
                order.cashlessPaymentType,
                order.transferPaymentAmount,
                order.cardPaymentAmount,
                order.qrPaymentAmount,
                order.fulfillmentType,
                order.address,
                order.contactPhone,
                order.comment,
                order.printComment,
                order.wholesale,
                order.priceTier != null
                        ? order.priceTier
                        : (order.wholesale ? PriceTier.WHOLESALE : PriceTier.RETAIL),
                priceSource == null ? null : priceSource.id(),
                priceSource == null ? null : priceSource.documentNumber(),
                priceSource == null || priceSource.priceType() == null
                        ? null
                        : priceSource.priceType().name(),
                priceSource != null && priceSource.deletedAt() != null,
                order.assemblyAssigneeId,
                assemblyAssignee != null ? assemblyAssignee.name : null,
                order.checkingAssigneeId,
                checkingAssignee != null ? checkingAssignee.name : null,
                assembledItems,
                checkedItems,
                order.total,
                paidTotal(order),
                order.createdAt,
                order.reservationExpiresAt,
                order.items.stream()
                        .map(
                                item ->
                                        new OrderItemDto(
                                                item.id,
                                                item.productId,
                                                item.madeToOrder,
                                                item.sku,
                                                item.nameRu,
                                                item.unitPrice,
                                                item.confirmedUnitPrice != null
                                                        ? item.confirmedUnitPrice
                                                        : item.unitPrice,
                                                item.wholesale,
                                                item.priceTier != null
                                                        ? item.priceTier
                                                        : (item.wholesale
                                                                ? PriceTier.WHOLESALE
                                                                : PriceTier.RETAIL),
                                                item.quantity,
                                                item.assembled,
                                                item.checked,
                                                item.lineTotal,
                                                item.confirmedLineTotal != null
                                                        ? item.confirmedLineTotal
                                                        : item.lineTotal,
                                                item.stockShortageQuantity,
                                                item.stockShortageReleasedByUserId,
                                                item.stockShortageReleasedByUserId == null
                                                        ? null
                                                        : userService
                                                                .byId(item.stockShortageReleasedByUserId)
                                                                .name,
                                                item.stockShortageReleasedAt,
                                                item.stockShortageComment))
                        .toList());
    }
}
