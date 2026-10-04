package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.orders.dto.BarcodeOrderCreateRequest;
import kz.company.shop.orders.dto.BarcodeOrderItemRequest;
import kz.company.shop.orders.dto.OrderDto;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.priceStatistics.entity.PriceType;
import kz.company.shop.priceStatistics.repository.PriceChangeSnapshotRepository;
import kz.company.shop.productImages.entity.ProductImage;
import kz.company.shop.productImages.repository.ProductImageRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class BarcodeOrderServiceTest {
    private final OrderRepository orders = mock(OrderRepository.class);
    private final ProductRepository products = mock(ProductRepository.class);
    private final ProductImageRepository images = mock(ProductImageRepository.class);
    private final UserService users = mock(UserService.class);
    private final OrderService orderService = mock(OrderService.class);
    private final PriceChangeSnapshotRepository priceSnapshots =
            mock(PriceChangeSnapshotRepository.class);
    private final BarcodeOrderService service =
            new BarcodeOrderService(orders, products, images, users, orderService, priceSnapshots);

    @BeforeEach
    void setUp() {
        when(orders.save(any(Order.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(orderService.toDto(any(Order.class))).thenReturn(mock(OrderDto.class));
    }

    @Test
    void lookupReturnsExactSkuPricesAndMainImage() {
        Product product = product(11L, "ABC-001", "250.00", "200.00", "180.00");
        product.madeToOrder = true;
        ProductImage image = new ProductImage();
        image.filePath = "/uploads/products/main.webp";
        when(products.findBySkuAndDeletedAtIsNull("ABC-001")).thenReturn(Optional.of(product));
        when(images.findFirstByProductIdAndMainImageTrue(11L)).thenReturn(Optional.of(image));

        var result = service.findProduct("ABC-001", PriceTier.RETAIL, LocalDate.now());

        assertThat(result.sku()).isEqualTo("ABC-001");
        assertThat(result.name()).isEqualTo(product.nameRu);
        assertThat(result.mainImageUrl()).isEqualTo("/uploads/products/main.webp");
        assertThat(result.madeToOrder()).isTrue();
        assertThat(result.retailPrice()).isEqualByComparingTo("250.00");
        assertThat(result.wholesalePrice()).isEqualByComparingTo("200.00");
        assertThat(result.bulkWholesalePrice()).isEqualByComparingTo("180.00");
    }

    @Test
    void lookupUsesPriceThatWasEffectiveOnOrderDate() {
        Product product = product(11L, "ABC-001", "250.00", "200.00", "180.00");
        when(products.findBySkuAndDeletedAtIsNull("ABC-001")).thenReturn(Optional.of(product));
        when(priceSnapshots.findPricesEffectiveBefore(
                        org.mockito.ArgumentMatchers.eq(11L),
                        org.mockito.ArgumentMatchers.eq(PriceType.RETAIL),
                        any()))
                .thenReturn(List.of(new BigDecimal("210.00")));

        var result = service.findProduct("ABC-001", PriceTier.RETAIL, LocalDate.of(2026, 8, 20));

        assertThat(result.retailPrice()).isEqualByComparingTo("210.00");
    }

    @Test
    void createUsesRequestedPriceTierAndRecalculatesTotal() {
        Product product = product(11L, "ABC-001", "250.00", "200.00", "180.00");
        product.madeToOrder = true;
        when(products.findByIdAndDeletedAtIsNull(11L)).thenReturn(Optional.of(product));
        Instant creationStartedAt = Instant.now();

        service.create(
                new BarcodeOrderCreateRequest(
                        null,
                        null,
                        null,
                        PriceTier.BULK_WHOLESALE,
                        LocalDate.of(2026, 8, 20),
                        List.of(
                                new BarcodeOrderItemRequest(
                                        11L, new BigDecimal("0.100"), new BigDecimal("180.00"))),
                        "  Со сканера  ",
                        false),
                7L);

        var captor = org.mockito.ArgumentCaptor.forClass(Order.class);
        org.mockito.Mockito.verify(orders).save(captor.capture());
        Order saved = captor.getValue();
        assertThat(saved.userId).isNull();
        assertThat(saved.createdByUserId).isEqualTo(7L);
        assertThat(saved.createdAt).isAfterOrEqualTo(creationStartedAt).isBeforeOrEqualTo(Instant.now());
        assertThat(saved.status).isEqualTo(OrderStatus.PROCESSING);
        assertThat(saved.paymentStatus).isEqualTo(PaymentStatus.PENDING);
        assertThat(saved.priceTier).isEqualTo(PriceTier.BULK_WHOLESALE);
        assertThat(saved.wholesale).isTrue();
        assertThat(saved.comment).isEqualTo("Со сканера");
        assertThat(saved.total).isEqualByComparingTo("18.00");
        assertThat(saved.paidTotal).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(saved.items).hasSize(1);
        assertThat(saved.items.getFirst().unitPrice).isEqualByComparingTo("180.00");
        assertThat(saved.items.getFirst().quantity).isEqualByComparingTo("0.1");
        assertThat(saved.items.getFirst().priceTier).isEqualTo(PriceTier.BULK_WHOLESALE);
        assertThat(saved.items.getFirst().madeToOrder).isTrue();
        org.mockito.Mockito.verify(orderService)
                .initializeIdentity(saved, LocalDate.of(2026, 8, 20));
        org.mockito.Mockito.verify(orderService).ensureDefaultReservation(saved, false);
        org.mockito.Mockito.verify(orderService).toDto(saved);
        org.mockito.Mockito.verifyNoMoreInteractions(orderService);
    }

    @Test
    void createReservesStockForDefaultTwentyFourHours() {
        Product product = product(11L, "ABC-001", "250.00", "200.00", "180.00");
        when(products.findByIdAndDeletedAtIsNull(11L)).thenReturn(Optional.of(product));

        service.create(
                new BarcodeOrderCreateRequest(
                        null,
                        null,
                        null,
                        PriceTier.RETAIL,
                        LocalDate.now(),
                        List.of(
                                new BarcodeOrderItemRequest(
                                        11L, BigDecimal.ONE, new BigDecimal("250.00"))),
                        null,
                        true),
                7L);

        org.mockito.Mockito.verify(orders).save(any(Order.class));
        org.mockito.Mockito.verify(orderService).initializeIdentity(any(Order.class), any(LocalDate.class));
        org.mockito.Mockito.verify(orderService)
                .ensureDefaultReservation(any(Order.class), org.mockito.ArgumentMatchers.eq(true));
        org.mockito.Mockito.verify(orderService).toDto(any(Order.class));
        org.mockito.Mockito.verifyNoMoreInteractions(orderService);
    }

    @Test
    void createKeepsItemsInTheRequestedOrder() {
        Product first = product(11L, "FIRST", "250.00", "200.00", "180.00");
        Product second = product(22L, "SECOND", "350.00", "300.00", "280.00");
        when(products.findByIdAndDeletedAtIsNull(11L)).thenReturn(Optional.of(first));
        when(products.findByIdAndDeletedAtIsNull(22L)).thenReturn(Optional.of(second));

        service.create(
                new BarcodeOrderCreateRequest(
                        null,
                        null,
                        null,
                        PriceTier.RETAIL,
                        LocalDate.now(),
                        List.of(
                                new BarcodeOrderItemRequest(
                                        22L, BigDecimal.ONE, new BigDecimal("350.00")),
                                new BarcodeOrderItemRequest(
                                        11L, BigDecimal.ONE, new BigDecimal("250.00"))),
                        null,
                        false),
                7L);

        var captor = org.mockito.ArgumentCaptor.forClass(Order.class);
        org.mockito.Mockito.verify(orders).save(captor.capture());

        assertThat(captor.getValue().items)
                .extracting(item -> item.productId, item -> item.sortOrder)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(22L, 0),
                        org.assertj.core.groups.Tuple.tuple(11L, 1));
    }

    @Test
    void createRejectsMissingSelectedPrice() {
        Product product = product(11L, "ABC-001", "250.00", null, null);
        when(products.findByIdAndDeletedAtIsNull(11L)).thenReturn(Optional.of(product));

        assertThatThrownBy(
                        () ->
                                service.create(
                                        new BarcodeOrderCreateRequest(
                                                null,
                                                null,
                                                null,
                                                PriceTier.WHOLESALE,
                                                LocalDate.now(),
                                                List.of(
                                                        new BarcodeOrderItemRequest(
                                                                11L,
                                                                new BigDecimal("1"),
                                                                new BigDecimal("200.00"))),
                                                null,
                                                false),
                                        7L))
                .isInstanceOf(AppExceptions.BadRequest.class)
                .hasMessageContaining("не задана выбранная цена");
    }

    private Product product(
            Long id, String sku, String retail, String wholesale, String bulkWholesale) {
        Product product = new Product();
        product.id = id;
        product.sku = sku;
        product.nameRu = "Тестовый товар";
        product.active = true;
        product.price = decimal(retail);
        product.wholesalePrice = decimal(wholesale);
        product.bulkWholesalePrice = decimal(bulkWholesale);
        return product;
    }

    private BigDecimal decimal(String value) {
        return value == null ? null : new BigDecimal(value);
    }
}
