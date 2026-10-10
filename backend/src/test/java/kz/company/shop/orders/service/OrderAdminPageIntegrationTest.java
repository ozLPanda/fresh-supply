package kz.company.shop.orders.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import kz.company.shop.files.service.ObjectStorageService;
import kz.company.shop.orders.entity.FulfillmentType;
import kz.company.shop.orders.entity.Order;
import kz.company.shop.orders.entity.OrderStatus;
import kz.company.shop.orders.entity.PaymentMethod;
import kz.company.shop.orders.entity.PriceTier;
import kz.company.shop.orders.repository.OrderRepository;
import kz.company.shop.regularbuyers.entity.RegularBuyer;
import kz.company.shop.regularbuyers.repository.RegularBuyerRepository;
import kz.company.shop.users.entity.User;
import kz.company.shop.users.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class OrderAdminPageIntegrationTest {
    @MockBean private ObjectStorageService objectStorage;
    @Autowired private OrderService service;
    @Autowired private OrderRepository repository;
    @Autowired private RegularBuyerRepository buyers;
    @Autowired private UserRepository users;

    @Test
    void filtersByBuyerIdsAcrossNamesAndAccountsBeforePagination() {
        RegularBuyer archived = buyer("Переименован", true);
        RegularBuyer active = buyer("Совпадающее имя", false);
        RegularBuyer other = buyer(active.name, false);
        Order first = order(999301, "фильтрпокупателей2099", null);
        first.regularBuyerId = archived.id;
        first.regularBuyerName = "Старое имя";
        first.userId = customer(active.name).id;
        Order second = order(999302, first.comment, null);
        second.regularBuyerId = active.id;
        second.regularBuyerName = active.name;
        Order third = order(999303, first.comment, null);
        third.regularBuyerId = archived.id;
        Order sameName = order(999304, first.comment, null);
        sameName.regularBuyerId = other.id;
        sameName.regularBuyerName = active.name;
        Order accountOnly = order(999305, first.comment, null);
        accountOnly.userId = first.userId;
        Order deleted = order(999306, first.comment, null);
        deleted.regularBuyerId = archived.id;
        deleted.deletedAt = Instant.now();
        repository.saveAllAndFlush(List.of(first, second, third, sameName, accountOnly, deleted));

        var archivedOnly = service.adminPage(first.comment, null, null,
                List.of(), List.of(), null, List.of(archived.id), "id", false, 1, 100);
        assertThat(archivedOnly.items()).extracting(item -> item.id())
                .containsExactly(first.id, third.id);
        assertThat(archivedOnly.items().getFirst().customerName()).isEqualTo(active.name);
        assertThat(archivedOnly.items().getFirst().regularBuyerName()).isEqualTo("Старое имя");

        var firstPage = service.adminPage(first.comment, null, null,
                List.of(), List.of(), null, List.of(archived.id, active.id), "id", false, 1, 2);
        var secondPage = service.adminPage(first.comment, null, null,
                List.of(), List.of(), null, List.of(archived.id, active.id), "id", false, 2, 2);
        assertThat(firstPage.totalItems()).isEqualTo(3);
        assertThat(firstPage.totalPages()).isEqualTo(2);
        assertThat(firstPage.items()).extracting(item -> item.id()).containsExactly(first.id, second.id);
        assertThat(secondPage.items()).extracting(item -> item.id()).containsExactly(third.id);
        assertThat(secondPage.totalItems()).isEqualTo(3);
        assertThat(service.adminPage(first.comment, null, null, List.of(), List.of(), null,
                List.of(UUID.randomUUID()), "id", false, 1, 10).totalItems()).isZero();
    }

    @Test
    void combinesBuyerSelectionWithOtherOrderFilters() {
        RegularBuyer selected = buyer("Выбранный", false);
        RegularBuyer other = buyer("Другой", false);
        Order matching = order(999401, "совместныйфильтр2099", null);
        Order wrongStatus = order(999402, matching.comment, null);
        Order wrongPrice = order(999403, matching.comment, null);
        Order wrongDate = order(999404, matching.comment, null);
        Order wrongSearch = order(999405, "несовпадение", null);
        Order wrongBuyer = order(999406, matching.comment, null);
        var orders = List.of(matching, wrongStatus, wrongPrice, wrongDate, wrongSearch, wrongBuyer);
        for (Order order : orders) {
            order.regularBuyerId = selected.id;
            order.status = OrderStatus.PROCESSING;
            order.priceTier = PriceTier.WHOLESALE;
        }
        wrongStatus.status = OrderStatus.NEW;
        wrongPrice.priceTier = PriceTier.RETAIL;
        wrongDate.createdAt = Instant.parse("2099-01-02T06:00:00Z");
        wrongBuyer.regularBuyerId = other.id;
        repository.saveAllAndFlush(orders);

        var result = service.adminPage(matching.comment, LocalDate.of(2099, 1, 1),
                LocalDate.of(2099, 1, 1), List.of(OrderStatus.PROCESSING),
                List.of(PriceTier.WHOLESALE), false, List.of(selected.id), "id", false, 1, 1);
        assertThat(result.totalItems()).isEqualTo(1);
        assertThat(result.totalPages()).isEqualTo(1);
        assertThat(result.items()).extracting(item -> item.id()).containsExactly(matching.id);
    }

    @Test
    void absentAndEmptyBuyerSelectionKeepExistingResults() {
        RegularBuyer selected = buyer("Покупатель", false);
        Order withBuyer = order(999501, "пустойфильтр2099", null);
        withBuyer.regularBuyerId = selected.id;
        Order withoutBuyer = order(999502, withBuyer.comment, null);
        repository.saveAllAndFlush(List.of(withBuyer, withoutBuyer));

        var original = service.adminPage(withBuyer.comment, null, null,
                List.of(), List.of(), null, "id", false, 1, 10);
        for (List<UUID> ids : java.util.Arrays.asList(null, List.<UUID>of())) {
            var result = service.adminPage(withBuyer.comment, null, null,
                    List.of(), List.of(), null, ids, "id", false, 1, 10);
            assertThat(result.totalItems()).isEqualTo(original.totalItems()).isEqualTo(2);
            assertThat(result.items()).extracting(item -> item.id())
                    .containsExactly(withBuyer.id, withoutBuyer.id);
        }
    }

    @Test
    void searchesRegularBuyerSnapshotBeforePaginationWithoutCustomerAccount() {
        RegularBuyer buyer = new RegularBuyer();
        buyer.id = UUID.randomUUID();
        buyer.name = "Переименованный покупатель";
        buyer.archived = true;
        buyers.saveAndFlush(buyer);

        Order first = order(999101, null, null);
        Order second = order(999102, null, null);
        Order deleted = order(999103, null, null);
        for (Order order : List.of(first, second, deleted)) {
            order.regularBuyerId = buyer.id;
            order.regularBuyerName = "ИП Котёл покупательпоиск2099";
        }
        deleted.deletedAt = Instant.now();
        repository.saveAllAndFlush(List.of(first, second, deleted));

        var firstPage = service.adminPage("КОТЁЛ покупательпоиск2099", null, null,
                List.of(), List.of(), null, "id", false, 1, 1);
        var secondPage = service.adminPage("котел покупательпоиск2099", null, null,
                List.of(), List.of(), null, "id", false, 2, 1);

        assertThat(firstPage.totalItems()).isEqualTo(2);
        assertThat(firstPage.totalPages()).isEqualTo(2);
        assertThat(firstPage.items()).extracting(item -> item.id()).containsExactly(first.id);
        assertThat(secondPage.items()).extracting(item -> item.id()).containsExactly(second.id);
        assertThat(firstPage.items().getFirst().userId()).isNull();
        assertThat(firstPage.items().getFirst().customerName()).isNull();
        assertThat(firstPage.items().getFirst().regularBuyerName())
                .isEqualTo("ИП Котёл покупательпоиск2099");
    }

    @Test
    void sortsByDisplayedBuyerNameWithAccountFallbackForBlankOrMissingSnapshot() {
        Order regular = order(999201, "покупательсортировка2099", null);
        regular.regularBuyerName = "  Alpha  ";
        regular.userId = customer("Zulu").id;
        Order blankSnapshot = order(999202, "покупательсортировка2099", null);
        blankSnapshot.regularBuyerName = "   ";
        blankSnapshot.userId = customer("  Beta  ").id;
        Order accountOnly = order(999203, "покупательсортировка2099", null);
        accountOnly.userId = customer("Charlie").id;
        Order buyerOnly = order(999204, "покупательсортировка2099", null);
        buyerOnly.regularBuyerName = "Delta";
        repository.saveAllAndFlush(List.of(regular, blankSnapshot, accountOnly, buyerOnly));

        var ascending = service.adminPage("покупательсортировка2099", null, null,
                List.of(), List.of(), null, "customer", false, 1, 10);
        var descending = service.adminPage("покупательсортировка2099", null, null,
                List.of(), List.of(), null, "customer", true, 1, 10);

        assertThat(ascending.items()).extracting(item -> item.id())
                .containsExactly(regular.id, blankSnapshot.id, accountOnly.id, buyerOnly.id);
        assertThat(descending.items()).extracting(item -> item.id())
                .containsExactly(buyerOnly.id, accountOnly.id, blankSnapshot.id, regular.id);
    }

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

    private RegularBuyer buyer(String name, boolean archived) {
        RegularBuyer buyer = new RegularBuyer();
        buyer.id = UUID.randomUUID();
        buyer.name = name;
        buyer.archived = archived;
        return buyers.saveAndFlush(buyer);
    }

    private User customer(String name) {
        User user = new User();
        user.name = name;
        user.passwordHash = "test-only";
        return users.saveAndFlush(user);
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
