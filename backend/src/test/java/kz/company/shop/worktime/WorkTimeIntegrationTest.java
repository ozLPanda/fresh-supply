package kz.company.shop.worktime;

import static kz.company.shop.worktime.WorkTimeDto.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class WorkTimeIntegrationTest {
    @Autowired WorkTimeService service;
    @Autowired JdbcTemplate db;
    @MockBean AuthContext auth;
    long employee;
    LocalDate day = LocalDate.of(2026, 1, 10);

    @BeforeEach
    void setup() {
        employee =
                db.queryForObject(
                        "insert into users(name,password_hash,active) values('Work time integration fixture','disabled',false) returning id",
                        Long.class);
        asManager();
    }

    void asManager() {
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                employee,
                                "",
                                "Fixture",
                                "",
                                Set.of("worktime.manage", "pages.worktime.view"),
                                true,
                                BigDecimal.ZERO));
    }

    void asEmployee() {
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                employee,
                                "",
                                "Fixture",
                                "",
                                Set.of("pages.worktime.view"),
                                true,
                                BigDecimal.ZERO));
        org.mockito.Mockito.doAnswer(
                        i -> {
                            throw new AppExceptions.Forbidden("worktime.manage");
                        })
                .when(auth)
                .require("worktime.manage");
    }

    void asViewerOfOthers() {
        when(auth.current())
                .thenReturn(
                        new CurrentUser(
                                employee,
                                "",
                                "Fixture",
                                "",
                                Set.of("pages.worktime.view", "worktime.view_others"),
                                true,
                                BigDecimal.ZERO));
    }

    void settings(String rate, int norm, long version) {
        service.saveSettings(employee, new SettingsRequest(new BigDecimal(rate), norm, version));
    }

    SaveDay entry(long version) {
        return new SaveDay(
                List.of(new Interval(540, 720), new Interval(780, 960)), "break", version);
    }

    View view() {
        return service.view(employee, day, day.plusDays(1));
    }

    RangeRequest request(View view) {
        return new RangeRequest(
                day,
                day.plusDays(1),
                view.days().stream()
                        .filter(d -> d.paymentId() == null)
                        .map(d -> new Expected(d.id(), d.version()))
                        .toList(),
                view.settings().version(),
                day.plusDays(1),
                "test");
    }

    @Test
    void preservesSnapshotsPaysOnlyUnpaidAndRetainsCancellationHistory() {
        settings("10000", 480, -1);
        service.saveDay(employee, day, entry(-1));
        settings("12000", 360, 0);
        service.saveDay(employee, day.plusDays(1), entry(-1));
        View before = view();
        assertThat(before.days()).hasSize(2);
        assertThat(before.balance().amount()).isEqualByComparingTo("19500.00");
        service.pay(employee, request(before));
        assertThat(view().balance().amount()).isZero();
        assertThatThrownBy(() -> service.pay(employee, request(before)))
                .isInstanceOf(AppExceptions.BadRequest.class);
        Day paid = view().days().get(0);
        assertThatThrownBy(() -> service.saveDay(employee, paid.date(), entry(paid.version())))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(() -> service.deleteDay(employee, paid.date(), paid.version()))
                .isInstanceOf(AppExceptions.BadRequest.class);
        long payment = view().payments().get(0).id();
        service.cancel(employee, payment, "Wrong payment mark");
        assertThat(view().payments().get(0).cancelledAt()).isNotNull();
        assertThat(view().balance().amount()).isEqualByComparingTo("19500.00");
        service.reprice(employee, request(view()));
        assertThat(view().balance().amount()).isEqualByComparingTo("24000.00");
    }

    @Test
    void detectsConcurrentEditsAndReportsGlobalUnpaidBalanceOutsideFilter() {
        settings("8000", 480, -1);
        service.saveDay(employee, day, entry(-1));
        var stale = request(view());
        service.saveDay(employee, day, entry(0));
        assertThatThrownBy(() -> service.pay(employee, stale))
                .isInstanceOf(AppExceptions.BadRequest.class);
        assertThatThrownBy(() -> service.saveDay(employee, day, entry(0)))
                .isInstanceOf(AppExceptions.BadRequest.class);
        var filtered = service.view(employee, day.plusDays(1), day.plusDays(2));
        assertThat(filtered.days()).isEmpty();
        assertThat(filtered.balance().amount()).isEqualByComparingTo("6000");
        assertThat(filtered.balance().firstUnpaid()).isEqualTo(day);
        var rates = request(view());
        settings("9000", 480, 0);
        assertThatThrownBy(() -> service.reprice(employee, rates))
                .isInstanceOf(AppExceptions.BadRequest.class);
    }

    @Test
    void includesAdditionalPaymentsInDayBalanceAndPayment() {
        settings("8000", 480, -1);
        service.saveDay(
                employee,
                day,
                new SaveDay(
                        List.of(new Interval(540, 1020)),
                        "",
                        -1,
                        List.of(
                                new AdditionalPayment("Премия", new BigDecimal("1500.00")),
                                new AdditionalPayment(
                                        "Компенсация дороги", new BigDecimal("750.50")))));

        var saved = view().days().get(0);
        assertThat(saved.amount()).isEqualByComparingTo("10250.50");
        assertThat(saved.additionalPayments())
                .extracting(AdditionalPayment::title)
                .containsExactly("Премия", "Компенсация дороги");
        assertThat(view().balance().amount()).isEqualByComparingTo("10250.50");

        service.pay(employee, request(view()));
        assertThat(view().payments().get(0).amount()).isEqualByComparingTo("10250.50");
    }

    @Test
    void recordsIssuedAmountsAsNegativeBalanceWithoutChangingDayPaymentStatus() {
        settings("8000", 480, -1);
        service.saveDay(employee, day, entry(-1));

        service.createTransaction(
                employee,
                new TransactionRequest(
                        day, new BigDecimal("7500.00"), "выдача до начисления"));
        service.createTransaction(
                employee,
                new TransactionRequest(
                        day, new BigDecimal("1200.00"), "ещё одна выдача"));

        var withTransactions = view();
        assertThat(withTransactions.balance().amount()).isEqualByComparingTo("-2700.00");
        assertThat(withTransactions.days()).allMatch(workDay -> workDay.paymentId() == null);
        assertThat(withTransactions.transactions()).hasSize(2);

        long paymentTransaction =
                withTransactions.transactions().stream()
                        .findFirst()
                        .orElseThrow()
                        .id();
        service.cancelTransaction(employee, paymentTransaction, "ошибка");

        assertThat(view().balance().amount()).isEqualByComparingTo("-1500.00");
        assertThat(view().transactions())
                .filteredOn(transaction -> transaction.id() == paymentTransaction)
                .allMatch(transaction -> transaction.cancelledAt() != null);
    }

    @Test
    void paysOnlyTheRemainingAmountAfterStandaloneIssuance() {
        settings("8000", 480, -1);
        service.saveDay(employee, day, entry(-1));
        service.createTransaction(
                employee,
                new TransactionRequest(day, new BigDecimal("5000.00"), "часть выплаты"));

        var beforePayment = view();
        assertThat(beforePayment.balance().amount()).isEqualByComparingTo("1000.00");
        service.pay(employee, request(beforePayment));

        var paid = view();
        assertThat(paid.payments()).singleElement().satisfies(payment -> {
            assertThat(payment.amount()).isEqualByComparingTo("1000.00");
            assertThat(payment.from()).isEqualTo(day);
        });
        assertThat(paid.balance().amount()).isZero();
        assertThat(paid.days()).allMatch(workDay -> workDay.paymentId() != null);
    }

    @Test
    void employeeCanEditOwnTimeButCannotAccessOtherPeopleOrManagePay() {
        settings("8000", 480, -1);
        asEmployee();
        service.saveDay(employee, day, entry(-1));
        assertThat(view().days()).hasSize(1);
        assertThatThrownBy(() -> service.view(employee + 1, day, day))
                .isInstanceOf(AppExceptions.Forbidden.class);
        assertThatThrownBy(() -> service.saveDay(employee + 1, day, entry(-1)))
                .isInstanceOf(AppExceptions.Forbidden.class);
        assertThatThrownBy(() -> settings("9000", 480, 0))
                .isInstanceOf(AppExceptions.Forbidden.class);
        assertThatThrownBy(() -> service.pay(employee, request(view())))
                .isInstanceOf(AppExceptions.Forbidden.class);
    }

    @Test
    void separatePermissionAllowsViewingOtherEmployeesWithoutManagement() {
        long other =
                db.queryForObject(
                        "insert into users(name,password_hash,active) values('Second fixture','disabled',false) returning id",
                        Long.class);
        db.update(
                """
          insert into user_permissions(user_id,permission_id)
          select ?,id from permissions where code='pages.worktime.view'
          """,
                other);
        asViewerOfOthers();

        assertThat(service.view(other, day, day).name()).isEqualTo("Second fixture");
        assertThat(service.employees()).extracting(Employee::id).contains(other);
    }

    @Test
    void rejectsNewDaysWithoutSalaryAndFutureEntries() {
        assertThatThrownBy(() -> service.saveDay(employee, day, entry(-1)))
                .isInstanceOf(AppExceptions.BadRequest.class);
        settings("8000", 480, -1);
        assertThatThrownBy(() -> service.saveDay(employee, LocalDate.now().plusDays(2), entry(-1)))
                .isInstanceOf(AppExceptions.BadRequest.class);
    }
}
