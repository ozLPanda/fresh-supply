package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import kz.company.shop.orders.entity.FulfillmentType;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.PaymentMethod;
import kz.company.shop.orders.repository.OrderRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class OrderAdminPageIntegrationTest {
    @Autowired private OrderService service;
    @Autowired private OrderRepository repository;

    @Test
    void searchesSubstringsAcrossDateAndDailyNumber() {
        Order target = order(5, null, null);
        target.orderNumberDate = LocalDate.of(2096, 9, 29);
        target.createdAt = Instant.parse("2096-09-29T06:00:00Z");
        Order other = order(6, null, null);
        other.orderNumberDate = target.orderNumberDate;
        other.createdAt = target.createdAt;
        repository.saveAllAndFlush(List.of(target, other));

        for (String search : List.of("09295", "9295", target.displayCode(), "20960929", "5")) {
            var result = service.adminPage(search, LocalDate.of(2096, 9, 29), LocalDate.of(2096, 9, 29),
                    List.of(), List.of(), null, "id", false, 1, 100);
            assertThat(result.items()).as("Search for %s", search)
                    .extracting(item -> item.id()).contains(target.id);
        }
    }

    @Test
    void ranksNumberSuffixMatchesBeforeOtherMatchesAndPagination() {
        Order suffix = order(43212, null, null);
        Order middle = order(124321, null, null);
        middle.createdAt = suffix.createdAt.plusSeconds(60);
        repository.saveAllAndFlush(List.of(suffix, middle));

        for (String sort : List.of("createdAt", "id")) {
            for (boolean descending : List.of(true, false)) {
                var firstPage = service.adminPage("12", LocalDate.of(2099, 1, 1), LocalDate.of(2099, 1, 1),
                        List.of(), List.of(), null, sort, descending, 1, 1);
                var secondPage = service.adminPage("12", LocalDate.of(2099, 1, 1), LocalDate.of(2099, 1, 1),
                        List.of(), List.of(), null, sort, descending, 2, 1);
                assertThat(firstPage.totalItems()).isEqualTo(2);
                assertThat(firstPage.items()).extracting(item -> item.id()).containsExactly(suffix.id);
                assertThat(secondPage.items()).extracting(item -> item.id()).containsExactly(middle.id);
            }
        }
    }

    @Test
    void searchesLongNumberSubstringsBeforePaginationAndCountsAllMatches() {
        Order first = order(123456789012L, null, null);
        Order second = order(123456789013L, null, null);
        Order deleted = order(123456789014L, null, null);
        deleted.deletedAt = Instant.now();
        repository.saveAllAndFlush(List.of(first, second, deleted));

        for (String search : List.of("0112345678901", "12345678901")) {
            var firstPage = service.adminPage(search, null, null, List.of(), List.of(), null,
                    "id", false, 1, 1);
            var secondPage = service.adminPage(search, null, null, List.of(), List.of(), null,
                    "id", false, 2, 1);
            assertThat(firstPage.totalItems()).as("Matches for %s", search).isEqualTo(2);
            assertThat(firstPage.totalPages()).isEqualTo(2);
            assertThat(List.of(firstPage.items().getFirst().id(), secondPage.items().getFirst().id()))
                    .containsExactly(first.id, second.id);
        }
    }

    @Test
    void searchesBothCommentsBeforePaginationAndCountsAllMatches() {
        Order first = order(999001, "Привезти котел меткапоиска2099", null);
        Order second = order(999002, null, "Печатать: котёл меткапоиска2099");
        repository.saveAllAndFlush(List.of(first, second));

        var firstPage = service.adminPage("котёл меткапоиска2099", null, null, List.of(), List.of(), null,
                "createdAt", true, 1, 1);
        var secondPage = service.adminPage("котел меткапоиска2099", null, null, List.of(), List.of(), null,
                "createdAt", true, 2, 1);

        assertThat(firstPage.totalItems()).isEqualTo(2);
        assertThat(firstPage.totalPages()).isEqualTo(2);
        assertThat(firstPage.items()).hasSize(1);
        assertThat(secondPage.items()).hasSize(1);
        assertThat(List.of(firstPage.items().getFirst().id(), secondPage.items().getFirst().id()))
                .containsExactlyInAnyOrder(first.id, second.id);

        var byNumber = service.adminPage(first.displayCode(), null, null, List.of(), List.of(), null,
                "id", false, 1, 10);
        assertThat(byNumber.items()).extracting(item -> item.id()).contains(first.id);
        var byDatePart = service.adminPage("20990101", null, null, List.of(), List.of(), null,
                "id", false, 1, 10);
        assertThat(byDatePart.items()).extracting(item -> item.id()).contains(first.id, second.id);

        assertThat(service.adminPage("меткапоиска2099", null, null, List.of(), List.of(), null,
                "customer", true, 1, 10).totalItems()).isEqualTo(2);
        assertThat(service.adminPage("меткапоиска2099", null, null, List.of(), List.of(), null,
                "fulfillment", true, 1, 10).totalItems()).isEqualTo(2);

        var summary = service.adminSummary(LocalDate.of(2099, 1, 1), LocalDate.of(2099, 1, 1));
        assertThat(summary.total()).isGreaterThanOrEqualTo(2);
        assertThat(summary.newOrders()).isGreaterThanOrEqualTo(2);
    }

    private Order order(long dailyNumber, String comment, String printComment) {
        Order order = new Order();
        order.id = UUID.randomUUID();
        order.orderNumberDate = LocalDate.of(2099, 1, 1);
        order.dailyNumber = dailyNumber;
        order.createdAt = Instant.parse("2099-01-01T06:00:00Z");
        order.fulfillmentType = FulfillmentType.PICKUP;
        order.paymentMethod = PaymentMethod.ON_RECEIPT;
        order.contactPhone = "+77000000000";
        order.comment = comment;
        order.printComment = printComment;
        order.total = BigDecimal.ZERO;
        order.paidTotal = BigDecimal.ZERO;
        return order;
    }
}
