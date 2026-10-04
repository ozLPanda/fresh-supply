package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.carts.service.CartService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.notifications.service.NotificationService;
import kz.company.shop.orders.dto.BarcodeOrderCreateRequest;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.priceStatistics.repository.PriceChangeSnapshotRepository;
import kz.company.shop.pricing.service.PricingService;
import kz.company.shop.productImages.repository.ProductImageRepository;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.products.service.ProductService;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import kz.company.shop.regularbuyers.repository.RegularBuyerRepository;
import kz.company.shop.regularbuyers.service.RegularBuyerService;
import kz.company.shop.users.service.UserService;
import kz.company.shop.wallets.service.WalletService;
import kz.company.shop.warehouse.service.WarehouseService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OrderRegularBuyerTest {
    private final OrderRepository orders = mock(OrderRepository.class);
    private final RegularBuyerRepository buyers = mock(RegularBuyerRepository.class);
    private final RegularBuyerService buyerService = new RegularBuyerService(buyers);
    private final AuditService audit = mock(AuditService.class);
    private final OrderService service = new OrderService(orders, mock(UuidV7Generator.class),
            mock(CartService.class), mock(ProductService.class), mock(WalletService.class),
            mock(UserService.class), audit, mock(NotificationService.class),
            mock(PricingService.class), mock(WarehouseService.class), buyerService);
    private final Order order = new Order();
    private final RegularBuyer buyer = new RegularBuyer();

    @BeforeEach
    void setUp() {
        order.id = UUID.randomUUID();
        order.orderNumberDate = LocalDate.now();
        order.dailyNumber = 1;
        order.total = BigDecimal.ZERO;
        order.paidTotal = BigDecimal.ZERO;
        buyer.id = UUID.randomUUID();
        buyer.name = "ИП Получатель";
        when(orders.findForUpdateById(order.id)).thenReturn(Optional.of(order));
        when(orders.save(any())).thenAnswer(call -> call.getArgument(0));
        when(buyers.findById(buyer.id)).thenReturn(Optional.of(buyer));
    }

    @Test
    void updateAndUnbindReflectSnapshotAndAudit() {
        var bound = service.updateRegularBuyer(order.id, buyer.id, 7L);
        assertThat(bound.regularBuyerId()).isEqualTo(buyer.id);
        assertThat(bound.regularBuyerName()).isEqualTo(buyer.name);
        assertThat(bound.customerName()).isNull();
        var cleared = service.updateRegularBuyer(order.id, null, 7L);
        assertThat(cleared.regularBuyerId()).isNull();
        assertThat(cleared.regularBuyerName()).isNull();
        verify(audit, times(2)).record(eq("REGULAR_BUYER_UPDATE"), eq("ORDER"), eq(order.id), anyString(), anyList());
    }

    @Test
    void rejectsArchivedNewRecipientAndDeletedOrder() {
        buyer.archived = true;
        assertThatThrownBy(() -> service.updateRegularBuyer(order.id, buyer.id, 7L))
                .isInstanceOf(AppExceptions.BadRequest.class);
        verify(orders, never()).save(any());
        order.deletedAt = Instant.now();
        assertThatThrownBy(() -> service.updateRegularBuyer(order.id, null, 7L))
                .isInstanceOf(AppExceptions.NotFound.class);
    }

    @Test
    void sameArchivedBuyerRetainsHistoricalSnapshotWithoutAudit() {
        buyer.archived = true;
        order.regularBuyerId = buyer.id;
        order.regularBuyerName = "ИП Старое имя";
        assertThat(service.updateRegularBuyer(order.id, buyer.id, 7L).regularBuyerName())
                .isEqualTo("ИП Старое имя");
        verifyNoInteractions(audit);
    }

    @Test
    void barcodeCreationCapturesBuyerAndRejectsArchivedBuyer() {
        OrderService orderService = mock(OrderService.class);
        BarcodeOrderService barcode = new BarcodeOrderService(orders, mock(ProductRepository.class),
                mock(ProductImageRepository.class), mock(UserService.class), orderService,
                mock(PriceChangeSnapshotRepository.class), buyerService);
        BarcodeOrderCreateRequest request = new BarcodeOrderCreateRequest(null, null, null,
                PriceTier.RETAIL, LocalDate.now(), List.of(), null, false, buyer.id);
        barcode.create(request, 7L);
        var captured = org.mockito.ArgumentCaptor.forClass(Order.class);
        verify(orders).save(captured.capture());
        assertThat(captured.getValue().regularBuyerId).isEqualTo(buyer.id);
        assertThat(captured.getValue().regularBuyerName).isEqualTo("ИП Получатель");
        buyer.archived = true;
        assertThatThrownBy(() -> barcode.create(request, 7L)).isInstanceOf(AppExceptions.BadRequest.class);
    }
}
