package kz.company.shop.worktime;

import static kz.company.shop.worktime.WorkTimeDto.*;

import java.math.*;
import java.time.*;
import java.util.*;
import java.util.stream.Collectors;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.common.security.AuthContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WorkTimeService {
    private final JdbcTemplate db;
    private final AuthContext auth;
    private static final ZoneId ZONE = ZoneId.of("Asia/Almaty");

    public WorkTimeService(JdbcTemplate db, AuthContext auth) {
        this.db = db;
        this.auth = auth;
    }

    public boolean manager() {
        return auth.current().permissions().contains("worktime.manage");
    }

    private boolean canViewOthers() {
        return auth.current().permissions().contains("worktime.view_others");
    }

    void access(long id) {
        if (auth.current().id().equals(id)
                && (manager()
                        || auth.current().permissions().contains("pages.worktime.view"))) return;
        if (!auth.current().id().equals(id) && canViewOthers()) return;
        if (auth.current().id().equals(id))
            throw new AppExceptions.Forbidden(
                    "pages.worktime.view (свой табель) / worktime.manage");
        throw new AppExceptions.Forbidden(
                "worktime.view_others (табели других сотрудников)");
    }

    private void manage() {
        auth.require("worktime.manage");
    }

    private String user(long id, boolean lock) {
        var found =
                db.query(
                        "select name from users where id=?" + (lock ? " for update" : ""),
                        (rs, n) -> rs.getString(1),
                        id);
        if (found.isEmpty()) throw new AppExceptions.NotFound("Сотрудник не найден");
        return found.get(0);
    }

    static void range(LocalDate from, LocalDate to) {
        if (from == null || to == null || from.isAfter(to) || from.plusDays(3660).isBefore(to))
            throw new AppExceptions.BadRequest("Укажите корректный период до 10 лет");
    }

    public List<Employee> employees() {
        if (!canViewOthers()) {
            access(auth.current().id());
            return List.of(new Employee(auth.current().id(), auth.current().name()));
        }
        return db.query(
                """
          select distinct u.id,u.name from users u where
          exists(select 1 from user_permissions up join permissions p on p.id=up.permission_id
           where up.user_id=u.id and p.code in ('pages.worktime.view','worktime.manage'))
          or exists(select 1 from user_roles ur join roles r on r.id=ur.role_id and r.active=true
           join role_permissions rp on rp.role_id=r.id join permissions p on p.id=rp.permission_id
           where ur.user_id=u.id and p.code in ('pages.worktime.view','worktime.manage'))
          or exists(select 1 from employee_work_days d where d.user_id=u.id) order by u.name,u.id
          """,
                (rs, n) -> new Employee(rs.getLong(1), rs.getString(2)));
    }

    private Settings settings(long id) {
        return db
                .query(
                        "select daily_rate,norm_minutes,version from employee_work_settings where user_id=?",
                        (rs, n) -> new Settings(rs.getBigDecimal(1), rs.getInt(2), rs.getLong(3)),
                        id)
                .stream()
                .findFirst()
                .orElse(new Settings(BigDecimal.ZERO, 480, -1));
    }

    @Transactional(
            readOnly = true,
            isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public View view(long id, LocalDate from, LocalDate to) {
        access(id);
        range(from, to);
        String name = user(id, false);
        var payments =
                db.query(
                        """
            select p.*,u.name author from employee_work_payments p join users u on u.id=p.created_by
            where p.user_id=? and p.from_date<=? and p.to_date>=? order by p.id desc
            """,
                        (rs, n) ->
                                new Payment(
                                        rs.getLong("id"),
                                        rs.getObject("from_date", LocalDate.class),
                                        rs.getObject("to_date", LocalDate.class),
                                        rs.getObject("paid_on", LocalDate.class),
                                        rs.getBigDecimal("amount"),
                                        rs.getString("note"),
                                        rs.getString("author"),
                                        rs.getString("cancelled_at"),
                                        rs.getString("cancel_reason")),
                        id,
                        to,
                        from);
        var transactions =
                db.query(
                        """
            select t.*,author.name author,canceller.name cancelled_by_name
            from employee_work_transactions t
            join users author on author.id=t.created_by
            left join users canceller on canceller.id=t.cancelled_by
            where t.user_id=? and t.occurred_on between ? and ? order by t.id desc
            """,
                        (rs, n) ->
                                new Transaction(
                                        rs.getLong("id"),
                                        rs.getObject("occurred_on", LocalDate.class),
                                        rs.getBigDecimal("amount"),
                                        rs.getString("note"),
                                        rs.getString("author"),
                                        rs.getString("created_at"),
                                        rs.getString("cancelled_at"),
                                        rs.getString("cancelled_by_name"),
                                        rs.getString("cancel_reason")),
                        id,
                        from,
                        to);
        var balance =
                db.queryForObject(
                        """
           select coalesce(sum(d.amount + coalesce(extra.amount, 0)),0) amount,
           count(*) filter(where d.payment_id is null) days,
           coalesce(sum(d.minutes) filter(where d.payment_id is null),0) minutes,
           min(d.work_date) filter(where d.payment_id is null) first_unpaid,max(d.work_date) last_marked,
           count(*) filter(where d.payment_id is null and d.daily_rate=0) unpriced,
           coalesce((select sum(t.amount) from employee_work_transactions t
             where t.user_id=? and t.cancelled_at is null), 0) standalone_payments
           ,coalesce((select sum(p.amount) from employee_work_payments p
             where p.user_id=? and p.cancelled_at is null), 0) day_payments
           from employee_work_days d left join (
             select day_id,sum(amount) amount from employee_work_additional_payments group by day_id
           ) extra on extra.day_id=d.id where d.user_id=?
           """,
                        (rs, n) ->
                                new Balance(
                                        rs.getBigDecimal("amount")
                                                .subtract(rs.getBigDecimal("standalone_payments"))
                                                .subtract(rs.getBigDecimal("day_payments")),
                                        rs.getLong("days"),
                                        rs.getLong("minutes"),
                                        rs.getObject("first_unpaid", LocalDate.class),
                                        rs.getObject("last_marked", LocalDate.class),
                                        rs.getLong("unpriced")),
                        id,
                        id,
                        id);
        return new View(
                id, name, manager(), settings(id), days(id, from, to), payments, transactions, balance);
    }

    List<Day> days(long id, LocalDate from, LocalDate to) {
        Map<Long, List<Interval>> intervals = new HashMap<>();
        Map<Long, List<AdditionalPayment>> additionalPayments = new HashMap<>();
        db.query(
                """
          select i.* from employee_work_intervals i join employee_work_days d on d.id=i.day_id
          where d.user_id=? and d.work_date between ? and ? order by i.start_minute
          """,
                rs -> {
                    intervals
                            .computeIfAbsent(rs.getLong("day_id"), k -> new ArrayList<>())
                            .add(new Interval(rs.getInt("start_minute"), rs.getInt("end_minute")));
                },
                id,
                from,
                to);
        db.query(
                """
          select p.day_id,p.title,p.amount from employee_work_additional_payments p
          join employee_work_days d on d.id=p.day_id
          where d.user_id=? and d.work_date between ? and ? order by p.id
                """,
                (org.springframework.jdbc.core.RowCallbackHandler)
                        rs ->
                                additionalPayments
                                        .computeIfAbsent(
                                                rs.getLong("day_id"), k -> new ArrayList<>())
                                        .add(
                                                new AdditionalPayment(
                                                        rs.getString("title"),
                                                        rs.getBigDecimal("amount"))),
                id,
                from,
                to);
        return db.query(
                "select * from employee_work_days where user_id=? and work_date between ? and ? order by work_date desc",
                (rs, n) -> {
                    long dayId = rs.getLong("id");
                    var additions = additionalPayments.getOrDefault(dayId, List.of());
                    return new Day(
                            dayId,
                            rs.getObject("work_date", LocalDate.class),
                            rs.getBigDecimal("daily_rate"),
                            rs.getInt("norm_minutes"),
                            rs.getInt("minutes"),
                            rs.getBigDecimal("amount")
                                    .add(
                                            additions.stream()
                                                    .map(AdditionalPayment::amount)
                                                    .reduce(BigDecimal.ZERO, BigDecimal::add)),
                            rs.getString("note"),
                            rs.getLong("version"),
                            rs.getObject("payment_id", Long.class),
                            intervals.getOrDefault(dayId, List.of()),
                            additions);
                },
                id,
                from,
                to);
    }

    @Transactional
    public void saveSettings(long id, SettingsRequest req) {
        manage();
        user(id, true);
        var old = settings(id);
        if (old.version() != req.version()) stale();
        db.update(
                """
          insert into employee_work_settings(user_id,daily_rate,norm_minutes,updated_by) values(?,?,?,?)
          on conflict(user_id) do update set daily_rate=excluded.daily_rate,norm_minutes=excluded.norm_minutes,
          updated_by=excluded.updated_by,updated_at=now(),version=employee_work_settings.version+1
          """,
                id,
                req.dailyRate(),
                req.normMinutes(),
                auth.current().id());
    }

    static int minutes(List<Interval> intervals) {
        if (intervals == null || intervals.isEmpty() || intervals.size() > 24)
            throw new AppExceptions.BadRequest("Добавьте от 1 до 24 интервалов");
        var sorted = intervals.stream().sorted(Comparator.comparingInt(Interval::start)).toList();
        int previous = -1, total = 0;
        for (var i : sorted) {
            if (i.start() < 0 || i.end() > 1440 || i.end() <= i.start() || i.start() < previous)
                throw new AppExceptions.BadRequest(
                        "Интервалы должны быть внутри дня, без пересечений; уход позже прихода");
            previous = i.end();
            total += i.end() - i.start();
        }
        return total;
    }

    static BigDecimal amount(BigDecimal rate, int norm, int minutes) {
        if (rate == null || rate.signum() < 0 || norm < 1 || norm > 1440)
            throw new AppExceptions.BadRequest("Проверьте оклад и норму");
        return rate.multiply(BigDecimal.valueOf(minutes))
                .divide(BigDecimal.valueOf(norm), 2, RoundingMode.HALF_UP);
    }

    private static List<AdditionalPayment> additionalPayments(List<AdditionalPayment> payments) {
        if (payments == null) return List.of();
        if (payments.size() > 50)
            throw new AppExceptions.BadRequest(
                    "Можно добавить не более 50 дополнительных начислений");
        for (var payment : payments) {
            if (payment == null
                    || payment.title() == null
                    || payment.title().isBlank()
                    || payment.title().length() > 255
                    || payment.amount() == null
                    || payment.amount().signum() <= 0
                    || payment.amount().compareTo(new BigDecimal("9999999.99")) > 0
                    || payment.amount().scale() > 2)
                throw new AppExceptions.BadRequest("Проверьте дополнительное начисление");
        }
        return payments;
    }

    private static void stale() {
        throw new AppExceptions.BadRequest(
                "Данные изменились. Обновите табель и повторите действие");
    }

    private static void editable(Day day, long version) {
        if (day != null && day.paymentId() != null)
            throw new AppExceptions.BadRequest("День оплачен. Сначала отмените отметку выплаты");
        if ((day == null ? -1 : day.version()) != version) stale();
    }

    @Transactional
    public void saveDay(long id, LocalDate date, SaveDay req) {
        access(id);
        user(id, true);
        if (date.isAfter(LocalDate.now(ZONE)))
            throw new AppExceptions.BadRequest("Фактическое время нельзя записать на будущий день");
        int minutes = minutes(req.intervals());
        var additions = additionalPayments(req.additionalPayments());
        var old = days(id, date, date).stream().findFirst().orElse(null);
        editable(old, req.version());
        var settings = settings(id);
        if (old == null && settings.dailyRate().signum() <= 0)
            throw new AppExceptions.BadRequest(
                    "Сначала укажите оклад и норму рабочего дня");
        BigDecimal rate = old == null ? settings.dailyRate() : old.dailyRate();
        int norm = old == null ? settings.normMinutes() : old.normMinutes();
        Long dayId =
                db.queryForObject(
                        """
           insert into employee_work_days(user_id,work_date,daily_rate,norm_minutes,minutes,amount,note,updated_by)
           values(?,?,?,?,?,?,?,?) on conflict(user_id,work_date) do update set minutes=excluded.minutes,amount=excluded.amount,
           note=excluded.note,updated_by=excluded.updated_by,updated_at=now(),version=employee_work_days.version+1 returning id
           """,
                        Long.class,
                        id,
                        date,
                        rate,
                        norm,
                        minutes,
                        amount(rate, norm, minutes),
                        Objects.toString(req.note(), ""),
                        auth.current().id());
        db.update("delete from employee_work_intervals where day_id=?", dayId);
        for (var i : req.intervals())
            db.update(
                    "insert into employee_work_intervals(day_id,start_minute,end_minute) values(?,?,?)",
                    dayId,
                    i.start(),
                    i.end());
        db.update("delete from employee_work_additional_payments where day_id=?", dayId);
        for (var addition : additions)
            db.update(
                    "insert into employee_work_additional_payments(day_id,title,amount) values(?,?,?)",
                    dayId,
                    addition.title().trim(),
                    addition.amount());
    }

    @Transactional
    public void deleteDay(long id, LocalDate date, long version) {
        access(id);
        user(id, true);
        var day =
                days(id, date, date).stream()
                        .findFirst()
                        .orElseThrow(() -> new AppExceptions.NotFound("День не найден"));
        editable(day, version);
        db.update("delete from employee_work_days where id=?", day.id());
    }

    private List<Day> checkedUnpaid(long id, RangeRequest req) {
        range(req.from(), req.to());
        var unpaid =
                days(id, req.from(), req.to()).stream().filter(d -> d.paymentId() == null).toList();
        if (unpaid.isEmpty()) throw new AppExceptions.BadRequest("В периоде нет неоплаченных дней");
        var expected =
                req.expected().stream()
                        .map(e -> e.id() + ":" + e.version())
                        .collect(Collectors.toSet());
        var actual =
                unpaid.stream().map(d -> d.id() + ":" + d.version()).collect(Collectors.toSet());
        if (!expected.equals(actual) || expected.size() != req.expected().size()) stale();
        return unpaid;
    }

    @Transactional
    public void reprice(long id, RangeRequest req) {
        manage();
        user(id, true);
        var unpaid = checkedUnpaid(id, req);
        var s = settings(id);
        if (req.settingsVersion() == null || req.settingsVersion() != s.version()) stale();
        if (s.dailyRate().signum() <= 0)
            throw new AppExceptions.BadRequest("Сначала сохраните дневной оклад больше нуля");
        for (var d : unpaid)
            db.update(
                    """
          update employee_work_days set daily_rate=?,norm_minutes=?,amount=?,version=version+1,updated_by=?,updated_at=now() where id=?
          """,
                    s.dailyRate(),
                    s.normMinutes(),
                    amount(s.dailyRate(), s.normMinutes(), d.minutes()),
                    auth.current().id(),
                    d.id());
    }

    @Transactional
    public void pay(long id, RangeRequest req) {
        manage();
        user(id, true);
        var unpaid = checkedUnpaid(id, req);
        if (req.paidOn() == null
                || req.paidOn().isAfter(LocalDate.now(ZONE))
                || unpaid.stream().anyMatch(d -> d.date().isAfter(req.paidOn())))
            throw new AppExceptions.BadRequest(
                    "Дата выплаты должна быть не раньше оплачиваемых дней и не в будущем");
        if (unpaid.stream().anyMatch(d -> d.dailyRate().signum() <= 0))
            throw new AppExceptions.BadRequest(
                    "Для всех дней должен быть указан оклад. Примените условия к неоплаченным дням");
        BigDecimal total =
                unpaid.stream().map(Day::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal balance =
                db.queryForObject(
                        """
            select coalesce(sum(d.amount + coalesce(extra.amount, 0)),0)
              - coalesce((select sum(t.amount) from employee_work_transactions t
                    where t.user_id=? and t.cancelled_at is null), 0)
              - coalesce((select sum(p.amount) from employee_work_payments p
                    where p.user_id=? and p.cancelled_at is null), 0)
            from employee_work_days d left join (
              select day_id,sum(amount) amount from employee_work_additional_payments group by day_id
            ) extra on extra.day_id=d.id where d.user_id=?
            """,
                        BigDecimal.class,
                        id,
                        id,
                        id);
        BigDecimal amount = balance.max(BigDecimal.ZERO).min(total);
        Long payment =
                db.queryForObject(
                        """
           insert into employee_work_payments(user_id,from_date,to_date,paid_on,amount,note,created_by) values(?,?,?,?,?,?,?) returning id
           """,
                        Long.class,
                        id,
                        req.from(),
                        req.to(),
                        req.paidOn(),
                        amount,
                        Objects.toString(req.note(), ""),
                        auth.current().id());
        for (var day : unpaid)
            db.update(
                    "update employee_work_days set payment_id=?,version=version+1,updated_by=?,updated_at=now() where id=?",
                    payment,
                    auth.current().id(),
                    day.id());
    }

    @Transactional
    public void createTransaction(long id, TransactionRequest req) {
        manage();
        user(id, true);
        if (req.occurredOn().isAfter(LocalDate.now(ZONE)))
            throw new AppExceptions.BadRequest("Дата операции не может быть в будущем");
        db.update(
                """
          insert into employee_work_transactions(user_id,occurred_on,amount,note,created_by)
          values(?,?,?,?,?)
          """,
                id,
                req.occurredOn(),
                req.amount(),
                Objects.toString(req.note(), ""),
                auth.current().id());
    }

    @Transactional
    public void cancel(long id, long payment, String reason) {
        manage();
        user(id, true);
        int changed =
                db.update(
                        """
          update employee_work_payments set cancelled_at=now(),cancelled_by=?,cancel_reason=? where id=? and user_id=? and cancelled_at is null
          """,
                        auth.current().id(),
                        reason,
                        payment,
                        id);
        if (changed != 1) throw new AppExceptions.BadRequest("Выплата не найдена или уже отменена");
        db.update(
                "update employee_work_days set payment_id=null,version=version+1,updated_by=?,updated_at=now() where user_id=? and payment_id=?",
                auth.current().id(),
                id,
                payment);
    }

    @Transactional
    public void cancelTransaction(long id, long transaction, String reason) {
        manage();
        user(id, true);
        int changed =
                db.update(
                        """
          update employee_work_transactions
          set cancelled_at=now(),cancelled_by=?,cancel_reason=?
          where id=? and user_id=? and cancelled_at is null
          """,
                        auth.current().id(), reason, transaction, id);
        if (changed != 1) throw new AppExceptions.BadRequest("Операция не найдена или уже отменена");
    }
}
