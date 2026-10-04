package kz.company.shop.analytics.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import kz.company.shop.analytics.dto.SalesAnalyticsDto;
import kz.company.shop.categories.repository.CategoryRepository;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderItem;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentStatus;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.products.entity.Product;
import kz.company.shop.products.repository.ProductRepository;
import kz.company.shop.users.repository.UserRepository;
import org.junit.jupiter.api.Test;

class SalesAnalyticsServiceTest {
    @Test
    void resolvesCategoryNameWithoutLoadingProductCategoryRelation() {
        OrderRepository orders = mock(OrderRepository.class);
        UserRepository users = mock(UserRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        CategoryRepository categories = mock(CategoryRepository.class);
        SalesAnalyticsService service =
                new SalesAnalyticsService(orders, users, products, categories);

        long categoryId = 9L;
        String categoryName = "Вентиляторы";
        CategoryRepository.NameRuProjection category =
                new CategoryRepository.NameRuProjection() {
                    @Override
                    public Long getId() {
                        return categoryId;
                    }

                    @Override
                    public String getNameRu() {
                        return categoryName;
                    }
                };

        Product product = new Product();
        product.id = 1L;
        product.categoryId = categoryId;

        OrderItem item = new OrderItem();
        item.productId = product.id;
        item.nameRu = "Product";
        item.quantity = BigDecimal.ONE;
        item.lineTotal = new BigDecimal("100.00");

        Order order = new Order();
        order.status = OrderStatus.COMPLETED;
        order.paymentStatus = PaymentStatus.PAID;
        order.createdAt = Instant.now();
        order.items.add(item);

        when(orders.findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any()))
                .thenReturn(List.of(order));
        when(products.findAllById(any())).thenReturn(List.of(product));
        when(categories.findNamesRuByIdIn(any())).thenReturn(List.of(category));

        LocalDate today = LocalDate.now(ZoneId.of("Asia/Qyzylorda"));
        SalesAnalyticsDto analytics = service.get("day", today, today);

        assertThat(analytics.categories())
                .singleElement()
                .satisfies(
                        value -> {
                            assertThat(value.id()).isEqualTo(categoryId);
                            assertThat(value.name()).isEqualTo(categoryName);
                        });
    }

    @Test
    void calculatesNetProfitFromTheIncomingPriceSnapshotStoredInAnOrder() {
        OrderRepository orders = mock(OrderRepository.class);
        UserRepository users = mock(UserRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        CategoryRepository categories = mock(CategoryRepository.class);
        SalesAnalyticsService service =
                new SalesAnalyticsService(orders, users, products, categories);

        Product product = new Product();
        product.id = 1L;
        product.incomingPrice = new BigDecimal("30.00");

        OrderItem item = new OrderItem();
        item.productId = product.id;
        item.nameRu = "Товар";
        item.quantity = new BigDecimal("2");
        item.lineTotal = new BigDecimal("100.00");
        item.confirmedLineTotal = item.lineTotal;
        item.incomingPrice = new BigDecimal("35.00");

        Order order = new Order();
        order.status = OrderStatus.COMPLETED;
        order.paymentStatus = PaymentStatus.PAID;
        order.createdAt = Instant.now();
        order.items.add(item);
        when(orders.findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any()))
                .thenReturn(List.of(order));
        when(products.findAllById(any())).thenReturn(List.of(product));
        when(categories.findNamesRuByIdIn(any())).thenReturn(List.of());

        LocalDate today = LocalDate.now(ZoneId.of("Asia/Qyzylorda"));
        SalesAnalyticsDto analytics = service.get("day", today, today);

        assertThat(analytics.totals().netProfit()).isEqualByComparingTo("30.00");
        assertThat(analytics.products())
                .singleElement()
                .satisfies(value -> assertThat(value.netProfit()).isEqualByComparingTo("30.00"));
    }

    @Test
    void skipsUnknownIncomingCostAndOrdersThatAreNotCompleted() {
        OrderRepository orders = mock(OrderRepository.class);
        UserRepository users = mock(UserRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        CategoryRepository categories = mock(CategoryRepository.class);
        SalesAnalyticsService service =
                new SalesAnalyticsService(orders, users, products, categories);

        Order completed = new Order();
        completed.status = OrderStatus.COMPLETED;
        completed.paymentStatus = PaymentStatus.PAID;
        completed.createdAt = Instant.now();
        completed.items = List.of(item("1000.00", "400.00"), item("1000.00", null));

        Order processing = new Order();
        processing.status = OrderStatus.PROCESSING;
        processing.paymentStatus = PaymentStatus.PAID;
        processing.createdAt = Instant.now();
        processing.items = List.of(item("900.00", "100.00"));

        when(orders.findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any()))
                .thenReturn(List.of(completed, processing));
        when(products.findAllById(any())).thenReturn(List.of());
        when(categories.findNamesRuByIdIn(any())).thenReturn(List.of());

        LocalDate today = LocalDate.now(ZoneId.of("Asia/Qyzylorda"));
        SalesAnalyticsDto analytics = service.get("day", today, today);

        assertThat(analytics.totals().revenue()).isEqualByComparingTo("2000.00");
        assertThat(analytics.totals().netProfit()).isEqualByComparingTo("600.00");
        assertThat(analytics.totals().orders()).isEqualTo(1);
    }

    @Test
    void countsDistinctProductOrdersAndBuildsLocalTimeProfilesForSelectedEntities() {
        OrderRepository orders = mock(OrderRepository.class);
        UserRepository users = mock(UserRepository.class);
        ProductRepository products = mock(ProductRepository.class);
        CategoryRepository categories = mock(CategoryRepository.class);
        SalesAnalyticsService service =
                new SalesAnalyticsService(orders, users, products, categories);
        Product product = new Product();
        product.id = 1L;
        product.categoryId = 9L;
        OrderItem first = item("100", "40");
        first.productId = 1L;
        OrderItem duplicate = item("200", "50");
        duplicate.productId = 1L;
        duplicate.quantity = new BigDecimal("2");
        Order completed = new Order();
        completed.status = OrderStatus.COMPLETED;
        completed.paymentStatus = PaymentStatus.PAID;
        completed.createdByUserId = 42L;
        // UTC Monday August 31 is Tuesday September 1 at 01:30 in Almaty.
        completed.createdAt = Instant.parse("2026-08-31T20:30:00Z");
        completed.items = List.of(first, duplicate);
        Order online = new Order();
        online.status = OrderStatus.COMPLETED;
        online.paymentStatus = PaymentStatus.PAID;
        online.createdAt = Instant.parse("2026-09-01T04:00:00Z");
        online.items = List.of(item("700", null));
        when(orders.findByPaymentStatusAndStatusAndCreatedAtGreaterThanEqualAndCreatedAtLessThan(
                        eq(PaymentStatus.PAID), eq(OrderStatus.COMPLETED), any(), any()))
                .thenReturn(List.of(completed, online));
        when(products.findAllById(any())).thenReturn(List.of(product));
        when(categories.findNamesRuByIdIn(any())).thenReturn(List.of());
        LocalDate date = LocalDate.of(2026, 9, 1);
        SalesAnalyticsDto all = service.get("day", date, date);
        assertThat(all.totals().orders()).isEqualTo(2);
        assertThat(
                        all.products().stream()
                                .filter(row -> Long.valueOf(1).equals(row.id()))
                                .findFirst()
                                .orElseThrow()
                                .orders())
                .isEqualTo(1);
        assertThat(
                        all.employees().stream()
                                .filter(row -> row.id() == null)
                                .findFirst()
                                .orElseThrow()
                                .name())
                .isEqualTo("Интернет-магазин");
        for (String dimension : List.of("products", "categories", "employees")) {
            long id = dimension.equals("products") ? 1L : dimension.equals("categories") ? 9L : 42L;
            SalesAnalyticsDto selected = service.get("day", date, date, dimension, id);
            assertThat(selected.totals().orders()).isEqualTo(1);
            assertThat(selected.totals().items()).isEqualByComparingTo("3");
            assertThat(selected.totals().revenue()).isEqualByComparingTo("300");
            assertThat(selected.totals().netProfit()).isEqualByComparingTo("160");
            assertThat(selected.series().getFirst().key()).isEqualTo("2026-09-01");
            assertThat(selected.months().get(8).items()).isEqualByComparingTo("3");
            assertThat(selected.weekdays().get(1).orders()).isEqualTo(1);
            assertThat(selected.activity()).hasSize(168);
            assertThat(
                            selected.activity().stream()
                                    .mapToLong(SalesAnalyticsDto.ActivityDto::orders)
                                    .sum())
                    .isEqualTo(1);
            SalesAnalyticsDto.ActivityDto activeHour =
                    selected.activity().stream()
                            .filter(cell -> cell.weekday() == 2 && cell.hour() == 1)
                            .findFirst()
                            .orElseThrow();
            assertThat(activeHour.orders()).isEqualTo(1);
            assertThat(activeHour.netProfit()).isEqualByComparingTo("160");
        }
        SalesAnalyticsDto missing = service.get("month", date, date, "employees", 999L);
        assertThat(missing.totals().orders()).isZero();
        assertThat(missing.activity()).allSatisfy(cell -> assertThat(cell.orders()).isZero());
        assertThat(service.get("week", date, date).series().getFirst().key())
                .isEqualTo("2026-08-31");
        assertThat(service.get("year", date, date).series().getFirst().key()).isEqualTo("2026");
    }

    @Test
    void rejectsUnsupportedOrIncompleteDrilldownsAndInvalidRanges() {
        SalesAnalyticsService service =
                new SalesAnalyticsService(
                        mock(OrderRepository.class),
                        mock(UserRepository.class),
                        mock(ProductRepository.class),
                        mock(CategoryRepository.class));
        LocalDate day = LocalDate.of(2026, 9, 1);
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> service.get("day", day, day, "unknown", 1L))
                .isInstanceOf(kz.company.shop.common.exception.AppExceptions.BadRequest.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> service.get("day", day, day, "products", null))
                .isInstanceOf(kz.company.shop.common.exception.AppExceptions.BadRequest.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(
                        () -> service.get("day", day, day.minusDays(1)))
                .isInstanceOf(kz.company.shop.common.exception.AppExceptions.BadRequest.class);
    }

    private OrderItem item(String soldAmount, String incomingPrice) {
        OrderItem item = new OrderItem();
        item.nameRu = "Товар";
        item.quantity = BigDecimal.ONE;
        item.lineTotal = new BigDecimal(soldAmount);
        item.confirmedLineTotal = item.lineTotal;
        item.incomingPrice = incomingPrice == null ? null : new BigDecimal(incomingPrice);
        return item;
    }
}
