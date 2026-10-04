package kz.company.shop.carts.service;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kz.company.shop.carts.dto.*;
import kz.company.shop.carts.entity.CartItem;
import kz.company.shop.carts.repository.CartItemRepository;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.files.service.FileStorageService;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.productImages.repository.ProductImageRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.users.service.UserService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CartService {
    private final CartItemRepository repository;
    private final ProductService productService;
    private final ProductImageRepository imageRepository;
    private final FileStorageService fileStorageService;
    private final PricingService pricingService;
    private final UserService userService;

    public CartService(
            CartItemRepository repository,
            ProductService productService,
            ProductImageRepository imageRepository,
            FileStorageService fileStorageService,
            PricingService pricingService,
            UserService userService) {
        this.repository = repository;
        this.productService = productService;
        this.imageRepository = imageRepository;
        this.fileStorageService = fileStorageService;
        this.pricingService = pricingService;
        this.userService = userService;
    }

    public List<CartItem> entities(Long userId) {
        return repository.findByUserIdOrderByCreatedAtAsc(userId);
    }

    public List<CartItem> entitiesForCheckout(Long userId, List<Long> cartItemIds) {
        return repository.findByUserIdAndIdInForUpdate(userId, cartItemIds);
    }

    @Transactional
    public CartDto get(Long userId) {
        return cartDto(userService.byId(userId), entities(userId), false);
    }

    @Transactional(readOnly = true)
    public CartDto selectionPreview(Long userId, CartSelectionPreviewRequest request) {
        return cartDto(
                userService.byId(userId),
                selectedCartItems(userId, request.cartItemIds(), "оформления"),
                request.useDiscountPrices());
    }

    private CartDto cartDto(
            kz.company.shop.users.entity.User user,
            List<CartItem> cartItems,
            boolean useDiscountPrices) {
        Map<Long, Product> products = new LinkedHashMap<>();
        for (CartItem cartItem : cartItems) {
            products.put(cartItem.productId, productService.getEntity(cartItem.productId));
        }
        PricingService.CartPricing pricing =
                pricingService.calculateCart(
                        cartItems.stream()
                                .map(
                                        item ->
                                                new PricingService.CartPricingLine(
                                                        products.get(item.productId),
                                                        item.quantity))
                                .toList(),
                        userService.effectivePermissions(user),
                        user.personalDiscountPercent,
                        useDiscountPrices);
        List<CartItemDto> items =
                cartItems.stream()
                        .map(
                                item ->
                                        toDto(
                                                item,
                                                products.get(item.productId),
                                                pricing.unitPrices().get(item.productId),
                                                pricing.priceTier(),
                                                user.personalDiscountPercent))
                        .toList();
        BigDecimal total =
                items.stream().map(CartItemDto::lineTotal).reduce(BigDecimal.ZERO, BigDecimal::add);
        return new CartDto(
                items,
                items.stream().mapToInt(CartItemDto::quantity).sum(),
                total,
                pricing.priceTier(),
                pricing.tiers().stream()
                        .filter(
                                tier ->
                                        tier.tier() == PriceTier.RETAIL
                                                || tier.permissionAvailable())
                        .map(
                                tier ->
                                        new CartPriceTierDto(
                                                tier.tier(),
                                                tier.permissionAvailable(),
                                                tier.available(),
                                                tier.subtotal(),
                                                tier.threshold(),
                                                tier.remaining(),
                                                tier.missingPriceItemCount()))
                        .toList());
    }

    @Transactional(readOnly = true)
    public TemporaryInvoicePreviewDto temporaryInvoicePreview(
            Long userId, TemporaryInvoicePreviewRequest request) {
        TemporaryInvoiceContext context = temporaryInvoiceContext(userId, request.cartItemIds());
        return new TemporaryInvoicePreviewDto(
                context.priceOptions(),
                context.mostFavorablePriceTier(),
                context.mostFavorableTotal());
    }

    @Transactional(readOnly = true)
    public TemporaryInvoiceDto temporaryInvoice(
            Long userId, TemporaryInvoiceCreateRequest request) {
        TemporaryInvoiceContext context =
                temporaryInvoiceContext(userId, request.selection().cartItemIds());
        if (context.priceOptions().stream()
                .noneMatch(option -> option.priceTier() == request.priceTier())) {
            throw new AppExceptions.BadRequest(
                    "Этот тип цены недоступен для выбранных позиций корзины");
        }
        List<TemporaryInvoiceItemDto> items =
                context.cartItems().stream()
                        .map(
                                cartItem -> {
                                    Product product = context.products().get(cartItem.productId);
                                    BigDecimal unitPrice =
                                            requireTierPrice(product, request.priceTier());
                                    BigDecimal quantity = BigDecimal.valueOf(cartItem.quantity);
                                    return new TemporaryInvoiceItemDto(
                                            product.sku,
                                            product.nameRu,
                                            quantity,
                                            unitPrice,
                                            unitPrice.multiply(quantity));
                                })
                        .toList();
        BigDecimal total =
                items.stream()
                        .map(TemporaryInvoiceItemDto::lineTotal)
                        .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new TemporaryInvoiceDto(items, total);
    }

    @Transactional
    public CartDto add(Long userId, CartItemRequest request) {
        Product product = requireAvailable(request.productId());
        CartItem item =
                repository
                        .findByUserIdAndProductId(userId, product.id)
                        .orElseGet(
                                () -> {
                                    CartItem created = new CartItem();
                                    created.userId = userId;
                                    created.productId = product.id;
                                    created.quantity = 0;
                                    return created;
                                });
        item.quantity = Math.min(999, item.quantity + request.quantity());
        repository.save(item);
        return get(userId);
    }

    @Transactional
    public CartDto setQuantity(Long userId, Long productId, int quantity) {
        if (quantity < 1 || quantity > 999) {
            throw new AppExceptions.BadRequest("Количество должно быть от 1 до 999");
        }
        requireAvailable(productId);
        CartItem item =
                repository
                        .findByUserIdAndProductId(userId, productId)
                        .orElseThrow(
                                () -> new AppExceptions.NotFound("Позиция корзины не найдена"));
        item.quantity = quantity;
        repository.save(item);
        return get(userId);
    }

    @Transactional
    public CartDto merge(Long userId, CartMergeRequest request) {
        if (request.items() != null) {
            request.items()
                    .forEach(
                            item -> {
                                try {
                                    add(userId, item);
                                } catch (AppExceptions.BadRequest
                                        | AppExceptions.NotFound ignored) {
                                    // A guest item may have been disabled or removed before login.
                                }
                            });
        }
        return get(userId);
    }

    @Transactional
    public CartDto remove(Long userId, Long productId) {
        repository.deleteByUserIdAndProductId(userId, productId);
        return get(userId);
    }

    @Transactional
    public void clear(Long userId) {
        repository.deleteByUserId(userId);
    }

    @Transactional
    public void removeForCheckout(Long userId, List<Long> cartItemIds) {
        repository.deleteByUserIdAndIdIn(userId, cartItemIds);
    }

    private TemporaryInvoiceContext temporaryInvoiceContext(Long userId, List<Long> requestedIds) {
        List<CartItem> cartItems = selectedCartItems(userId, requestedIds, "накладной");

        Map<Long, Product> products = new LinkedHashMap<>();
        for (CartItem cartItem : cartItems) {
            Product product = requireAvailable(cartItem.productId);
            products.put(cartItem.productId, product);
        }
        var user = userService.byId(userId);
        PricingService.CartPricing pricing =
                pricingService.calculateCart(
                        cartItems.stream()
                                .map(
                                        item ->
                                                new PricingService.CartPricingLine(
                                                        products.get(item.productId),
                                                        item.quantity))
                                .toList(),
                        userService.effectivePermissions(user),
                        BigDecimal.ZERO,
                        true);
        List<PriceTier> availableTiers =
                pricing.tiers().stream()
                        .filter(PricingService.CartTierProgress::available)
                        .map(PricingService.CartTierProgress::tier)
                        .toList();
        Map<PriceTier, BigDecimal> totals = new LinkedHashMap<>();
        for (PriceTier priceTier : availableTiers) {
            BigDecimal total = BigDecimal.ZERO;
            for (CartItem cartItem : cartItems) {
                Product product = products.get(cartItem.productId);
                total =
                        total.add(
                                requireTierPrice(product, priceTier)
                                        .multiply(BigDecimal.valueOf(cartItem.quantity)));
            }
            totals.put(priceTier, total);
        }
        PriceTier mostFavorablePriceTier =
                totals.entrySet().stream()
                        .min(Comparator.comparing(Map.Entry::getValue))
                        .map(Map.Entry::getKey)
                        .orElseThrow(
                                () -> new AppExceptions.BadRequest("Нет доступных типов цены"));
        BigDecimal mostFavorableTotal = totals.get(mostFavorablePriceTier);
        List<TemporaryInvoicePriceOptionDto> priceOptions =
                availableTiers.stream()
                        .map(
                                priceTier ->
                                        new TemporaryInvoicePriceOptionDto(
                                                priceTier,
                                                totals.get(priceTier),
                                                totals.get(priceTier)
                                                        .subtract(mostFavorableTotal)
                                                        .max(BigDecimal.ZERO)))
                        .toList();
        return new TemporaryInvoiceContext(
                cartItems, products, priceOptions, mostFavorablePriceTier, mostFavorableTotal);
    }

    private List<CartItem> selectedCartItems(Long userId, List<Long> requestedIds, String purpose) {
        if (requestedIds == null || requestedIds.isEmpty()) {
            throw new AppExceptions.BadRequest("Выберите товары для " + purpose);
        }
        Set<Long> uniqueIds = new LinkedHashSet<>(requestedIds);
        if (uniqueIds.size() != requestedIds.size()) {
            throw new AppExceptions.BadRequest("Позиция корзины указана несколько раз");
        }
        Map<Long, CartItem> cartItemsById =
                entities(userId).stream()
                        .collect(java.util.stream.Collectors.toMap(item -> item.id, item -> item));
        List<CartItem> cartItems = requestedIds.stream().map(cartItemsById::get).toList();
        if (cartItems.stream().anyMatch(item -> item == null)) {
            throw new AppExceptions.BadRequest("Некоторые товары больше не находятся в корзине");
        }
        return cartItems;
    }

    private BigDecimal requireTierPrice(Product product, PriceTier priceTier) {
        BigDecimal price = pricingService.priceForTier(product, priceTier);
        if (price == null || price.compareTo(BigDecimal.ZERO) <= 0) {
            throw new AppExceptions.BadRequest(
                    "Для товара «" + product.nameRu + "» не задана цена выбранного уровня");
        }
        return price;
    }

    private Product requireAvailable(Long productId) {
        Product product = productService.getEntity(productId);
        if (!product.active) throw new AppExceptions.BadRequest("Товар недоступен для заказа");
        return product;
    }

    private CartItemDto toDto(
            CartItem item,
            Product product,
            BigDecimal unitPrice,
            PriceTier priceTier,
            BigDecimal personalDiscountPercent) {
        boolean personalDiscountApplied =
                priceTier == PriceTier.RETAIL
                        && personalDiscountPercent != null
                        && personalDiscountPercent.compareTo(BigDecimal.ZERO) > 0;
        var image =
                imageRepository.findByProductIdOrderBySortOrderAsc(product.id).stream()
                        .findFirst()
                        .orElse(null);
        String imagePath = image == null ? null : image.filePath;
        String imageContentHash =
                image == null
                        ? null
                        : image.contentHash == null || image.contentHash.isBlank()
                                ? fileStorageService.contentHash(image.fileName)
                                : image.contentHash;
        if (image != null && (image.contentHash == null || image.contentHash.isBlank())) {
            image.contentHash = imageContentHash;
        }
        return new CartItemDto(
                item.id,
                product.id,
                product.sku,
                product.nameRu,
                unitPrice,
                product.price,
                priceTier != PriceTier.RETAIL,
                product.active && product.deletedAt == null,
                product.madeToOrder,
                item.quantity,
                unitPrice.multiply(BigDecimal.valueOf(item.quantity)),
                imagePath,
                imageContentHash,
                personalDiscountApplied ? personalDiscountPercent : null,
                priceTier);
    }

    private record TemporaryInvoiceContext(
            List<CartItem> cartItems,
            Map<Long, Product> products,
            List<TemporaryInvoicePriceOptionDto> priceOptions,
            PriceTier mostFavorablePriceTier,
            BigDecimal mostFavorableTotal) {}
}
