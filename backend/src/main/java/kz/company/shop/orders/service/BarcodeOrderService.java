package kz.company.shop.orders.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.dto.BarcodeOrderCreateRequest;
import kz.company.shop.orders.dto.BarcodeOrderCustomerDto;
import kz.company.shop.orders.dto.BarcodeOrderItemRequest;
import kz.company.shop.orders.dto.BarcodeOrderProductDto;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.entity.FulfillmentType;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentMethod;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.priceStatistics.entity.PriceType;
import kz.company.shop.priceStatistics.repository.PriceChangeSnapshotRepository;
import kz.company.shop.productImages.repository.ProductImageRepository;
import kz.company.shop.products.entity.MeasurementUnit;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.service.UserService;
import kz.company.shop.regularbuyers.service.RegularBuyerService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BarcodeOrderService {
    private static final ZoneId ORDER_TIME_ZONE = ZoneId.of("Asia/Almaty");
    private static final BigDecimal MIN_ORDER_QUANTITY = new BigDecimal("0.001");
    private static final BigDecimal MAX_ORDER_QUANTITY = new BigDecimal("999");
    private final OrderRepository orderRepository;
    private final ProductRepository productRepository;
    private final ProductImageRepository imageRepository;
    private final UserService userService;
    private final OrderService orderService;
    private final PriceChangeSnapshotRepository priceSnapshots;

    private final RegularBuyerService regularBuyerService;

    @Autowired
    public BarcodeOrderService(
            OrderRepository orderRepository,
            ProductRepository productRepository,
            ProductImageRepository imageRepository,
            UserService userService,
            OrderService orderService,
            PriceChangeSnapshotRepository priceSnapshots,
            RegularBuyerService regularBuyerService) {
        this.orderRepository = orderRepository;
        this.productRepository = productRepository;
        this.imageRepository = imageRepository;
        this.userService = userService;
        this.orderService = orderService;
        this.priceSnapshots = priceSnapshots;
        this.regularBuyerService = regularBuyerService;
    }

    public BarcodeOrderService(
            OrderRepository orderRepository,
            ProductRepository productRepository,
            ProductImageRepository imageRepository,
            UserService userService,
            OrderService orderService,
            PriceChangeSnapshotRepository priceSnapshots) {
        this(orderRepository, productRepository, imageRepository, userService, orderService, priceSnapshots, null);
    }

    @Transactional(readOnly = true)
    public BarcodeOrderProductDto findProduct(String code, PriceTier tier, LocalDate orderDate) {
        Product product =
                productRepository
                        .findBySkuAndDeletedAtIsNull(code)
                        .orElseThrow(
                                () ->
                                        new AppExceptions.NotFound(
                                                "Товар с таким артикулом не найден"));
        ensureAvailable(product);
        String imageUrl =
                imageRepository
                        .findFirstByProductIdAndMainImageTrue(product.id)
                        .map(image -> image.filePath)
                        .orElse(null);
        BigDecimal historicPrice = historicalPrice(product, tier, orderDate);
        return new BarcodeOrderProductDto(
                product.id,
                product.sku,
                product.nameRu,
                imageUrl,
                product.madeToOrder,
                tier == PriceTier.RETAIL ? historicPrice : product.price,
                tier == PriceTier.WHOLESALE ? historicPrice : product.wholesalePrice,
                tier == PriceTier.BULK_WHOLESALE ? historicPrice : product.bulkWholesalePrice,
                tier == PriceTier.SKO ? historicPrice : product.skoPrice,
                product.measurementUnit != null ? product.measurementUnit : MeasurementUnit.PIECE);
    }

    @Transactional(readOnly = true)
    public List<BarcodeOrderCustomerDto> customers() {
        return userService.list().stream()
                .filter(user -> !Boolean.FALSE.equals(user.active()))
                .map(
                        user ->
                                new BarcodeOrderCustomerDto(
                                        user.id(), user.name(), user.email(), user.phone()))
                .toList();
    }

    @Transactional
    public OrderDto create(BarcodeOrderCreateRequest request, Long actorUserId) {
        User customer =
                request.customerId() == null ? null : userService.byId(request.customerId());
        if (customer != null && !customer.active) {
            throw new AppExceptions.BadRequest("Выбранный клиент отключён");
        }
        String pendingEmail = normalizedEmail(request.pendingCustomerEmail());
        String pendingPhone = normalizedPhone(request.pendingCustomerPhone());
        if (customer != null && (pendingEmail != null || pendingPhone != null)) {
            throw new AppExceptions.BadRequest(
                    "Выберите клиента или ожидающую привязку, но не оба варианта");
        }
        if (pendingEmail == null
                && pendingPhone == null
                && (hasText(request.pendingCustomerEmail())
                        || hasText(request.pendingCustomerPhone()))) {
            throw new AppExceptions.BadRequest(
                    "Укажите корректный email или номер телефона для ожидающей привязки");
        }

        Order order = new Order();
        if (request.regularBuyerId() != null) regularBuyerService.assign(order, request.regularBuyerId());
        orderService.initializeIdentity(order, request.orderDate());
        // The selected date controls numbering and historical prices; the creation timestamp
        // must still reflect the actual moment the employee saved the order.
        order.createdAt = Instant.now();
        order.userId = customer == null ? null : customer.id;
        order.createdByUserId = actorUserId;
        order.status = OrderStatus.PROCESSING;
        order.paymentStatus = PaymentStatus.PENDING;
        order.paymentMethod = PaymentMethod.ON_RECEIPT;
        order.fulfillmentType = FulfillmentType.PICKUP;
        order.contactPhone =
                customer != null && customer.phone != null
                        ? customer.phone
                        : pendingPhone == null ? "" : pendingPhone;
        order.pendingCustomerEmail = pendingEmail;
        order.pendingCustomerPhone = pendingPhone;
        order.comment = normalized(request.comment());
        order.priceTier = request.priceTier();
        order.wholesale = request.priceTier() != PriceTier.RETAIL;

        Set<Long> productIds = new HashSet<>();
        BigDecimal total = BigDecimal.ZERO;
        for (BarcodeOrderItemRequest requestedItem : request.items()) {
            validateQuantity(requestedItem.quantity());
            if (!productIds.add(requestedItem.productId())) {
                throw new AppExceptions.BadRequest(
                        "Один товар нельзя передать в заказе несколько раз");
            }
            Product product =
                    productRepository
                            .findByIdAndDeletedAtIsNull(requestedItem.productId())
                            .orElseThrow(() -> new AppExceptions.NotFound("Товар не найден"));
            ensureAvailable(product);
            BigDecimal catalogPrice =
                    historicalPrice(product, request.priceTier(), request.orderDate());
            if (catalogPrice == null || catalogPrice.compareTo(BigDecimal.ZERO) <= 0) {
                throw new AppExceptions.BadRequest(
                        "Для товара «" + product.nameRu + "» не задана выбранная цена");
            }
            BigDecimal unitPrice = requestedItem.unitPrice();

            OrderItem item = new OrderItem();
            item.order = order;
            item.productId = product.id;
            item.measurementUnit =
                    requestedItem.measurementUnit() != null
                            ? requestedItem.measurementUnit()
                            : product.measurementUnit != null
                                    ? product.measurementUnit
                                    : MeasurementUnit.PIECE;
            item.madeToOrder = product.madeToOrder;
            item.sku = product.sku;
            item.nameRu = product.nameRu;
            item.unitPrice = unitPrice;
            item.confirmedUnitPrice = unitPrice;
            item.incomingPrice = product.incomingPrice;
            item.priceTier = request.priceTier();
            item.wholesale = request.priceTier() != PriceTier.RETAIL;
            item.quantity = requestedItem.quantity();
            item.lineTotal = unitPrice.multiply(item.quantity);
            item.confirmedLineTotal = item.lineTotal;
            item.sortOrder = order.items.size();
            total = total.add(item.lineTotal);
            order.items.add(item);
        }
        order.total = total;
        order.paidTotal = BigDecimal.ZERO;
        Order saved = orderRepository.save(order);
        orderService.ensureDefaultReservation(saved, request.allowStockShortage());
        return orderService.toDto(saved);
    }

    private void ensureAvailable(Product product) {
        if (!product.active) {
            throw new AppExceptions.BadRequest("Товар «" + product.nameRu + "» недоступен");
        }
    }

    private void validateQuantity(BigDecimal quantity) {
        if (quantity == null
                || quantity.compareTo(MIN_ORDER_QUANTITY) < 0
                || quantity.compareTo(MAX_ORDER_QUANTITY) > 0
                || quantity.scale() > 3) {
            throw new AppExceptions.BadRequest(
                    "Количество товара должно быть от 0,001 до 999 с точностью до тысячной");
        }
    }

    private BigDecimal price(Product product, PriceTier tier) {
        return switch (tier) {
            case RETAIL -> product.price;
            case WHOLESALE -> product.wholesalePrice;
            case BULK_WHOLESALE -> product.bulkWholesalePrice;
            case SKO -> product.skoPrice;
        };
    }

    private BigDecimal historicalPrice(Product product, PriceTier tier, LocalDate orderDate) {
        Instant endExclusive = orderDate.plusDays(1).atStartOfDay(ORDER_TIME_ZONE).toInstant();
        PriceType priceType = PriceType.valueOf(tier.name());
        List<BigDecimal> effective =
                priceSnapshots.findPricesEffectiveBefore(product.id, priceType, endExclusive);
        if (!effective.isEmpty()) return effective.get(0);
        List<BigDecimal> starting =
                priceSnapshots.findPricesStartingAt(product.id, priceType, endExclusive);
        return starting.isEmpty() ? price(product, tier) : starting.get(0);
    }

    private String normalized(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private String normalizedEmail(String value) {
        String email = normalized(value);
        return email != null && email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")
                ? email.toLowerCase()
                : null;
    }

    private String normalizedPhone(String value) {
        return PendingOrderCustomerBindingService.normalizePhone(value);
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
