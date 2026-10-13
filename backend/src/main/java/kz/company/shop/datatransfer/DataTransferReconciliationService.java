package kz.company.shop.datatransfer;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.time.LocalDate;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.warehouse.service.WarehouseLedgerReplayService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Native-only reconciliation. Opening balances are proved before SQL merge, never guessed afterward. */
@Service
@Profile("desktop")
public class DataTransferReconciliationService {
    public record Entry(UUID uid, String id, String type, String amount, String balanceAfter,
            UUID orderId, Instant createdAt) {}
    public record SourceWallet(UUID uid, String balance, long transactionCount, boolean complete,
            List<UUID> deletedTransactionUids, List<Entry> transactions) {}
    public record WalletCandidate(String walletId, SourceWallet source) {}
    public record WarehouseUnit(String warehouseId, String productId, boolean complete) {}
    public record IncomingOrder(UUID id, LocalDate orderNumberDate, String dailyNumber) {}
    public record PreflightRequest(List<WalletCandidate> wallets, List<WarehouseUnit> warehouses,
            List<IncomingOrder> incomingOrders) {}
    public record WalletDecision(String walletId, boolean allowed, String reason, String openingBalance,
            String closingBalance, List<UUID> transactionUids) {}
    public record WarehouseDecision(String warehouseId, String productId, boolean allowed, String reason) {}
    public record PreflightResult(UUID planId, List<WalletDecision> wallets,
            List<WarehouseDecision> warehouses, List<IncomingOrder> orderNumbers) {}
    public record ApplyRequest(UUID planId, List<String> walletIds, List<WarehouseUnit> warehouses,
            List<UUID> orderIds) {}
    public record ApplyResult(int wallets, int warehouseProducts, int orders) {}
    public record WalletPlan(String walletId, UUID uid, String opening, String closing, List<Entry> entries) {}
    public record SavedPlan(Instant createdAt, List<WalletPlan> wallets,
            List<WarehouseUnit> warehouses, List<IncomingOrder> orders) {}
    private record LocalWallet(UUID uid, String balance, List<Entry> entries, boolean tombstones) {}
    private final JdbcTemplate jdbc;
    private final WarehouseLedgerReplayService warehouseReplay;
    private final ObjectMapper mapper;
    private final Path plans;
    @PersistenceContext private EntityManager entities;

    @Autowired
    public DataTransferReconciliationService(JdbcTemplate jdbc,
            WarehouseLedgerReplayService warehouseReplay, ObjectMapper mapper,
            @Value("${APP_DESKTOP_DATA_DIR}") String dataDir) {
        this(jdbc, warehouseReplay, mapper, Path.of(dataDir));
    }

    DataTransferReconciliationService(JdbcTemplate jdbc, WarehouseLedgerReplayService warehouseReplay,
            ObjectMapper mapper, Path dataDir) {
        this.jdbc=jdbc; this.warehouseReplay=warehouseReplay; this.mapper=mapper;
        this.plans=dataDir.toAbsolutePath().normalize().resolve("temp/data-merge");
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    public PreflightResult preflight(PreflightRequest request) {
        List<WalletDecision> decisions=new ArrayList<>();
        List<WalletPlan> allowed=new ArrayList<>();
        Set<String> ids=new HashSet<>();
        for(WalletCandidate candidate: list(request.wallets())) {
            if(!ids.add(candidate.walletId()))throw bad("Кошелёк указан несколько раз");
            try {
                long walletId=id(candidate.walletId());
                LocalWallet local=local(walletId, false);
                SourceWallet source=candidate.source();
                if(local.tombstones() || source==null || !source.complete()
                        || !list(source.deletedTransactionUids()).isEmpty()
                        || source.transactionCount()!=list(source.transactions()).size())
                    throw bad("Не подтверждена полнота истории кошелька");
                WalletPlan plan=planWallet(candidate.walletId(), local.uid(), local.balance(), local.entries(), source);
                allowed.add(plan);
                decisions.add(new WalletDecision(candidate.walletId(),true,null,plan.opening(),plan.closing(),
                        plan.entries().stream().map(Entry::uid).toList()));
            } catch(AppExceptions.BadRequest error) {
                decisions.add(new WalletDecision(candidate.walletId(),false,error.getMessage(),null,null,List.of()));
            }
        }
        List<WarehouseUnit> units=new ArrayList<>();
        List<WarehouseDecision> warehouseDecisions=new ArrayList<>();
        Set<String> pairs=new HashSet<>();
        for(WarehouseUnit unit:list(request.warehouses())) {
            long warehouse=id(unit.warehouseId()),product=id(unit.productId());
            if(!pairs.add(warehouse+":"+product))throw bad("Складской журнал указан несколько раз");
            if(!unit.complete()) {
                warehouseDecisions.add(new WarehouseDecision(unit.warehouseId(),unit.productId(),false,
                        "Не подтверждён полный складской журнал"));
                continue;
            }
            // Node has verified complete immutable union events and FK mappings.
            // Existing ambiguous legacy movements must never be replaced silently.
            var preview=warehouseReplay.preview(warehouse,product);
            if(!preview.issues().isEmpty()) {
                warehouseDecisions.add(new WarehouseDecision(unit.warehouseId(),unit.productId(),false,
                        String.join("; ",preview.issues())));
                continue;
            }
            units.add(unit);
            warehouseDecisions.add(new WarehouseDecision(unit.warehouseId(),unit.productId(),true,null));
        }
        List<IncomingOrder> numbers=allocateNumbers(list(request.incomingOrders()));
        UUID planId=UUID.randomUUID();
        save(planId,new SavedPlan(Instant.now(),List.copyOf(allowed),List.copyOf(units),numbers));
        return new PreflightResult(planId,List.copyOf(decisions),List.copyOf(warehouseDecisions),numbers);
    }

    /** One DB transaction; the native caller restores its full backup if any unit fails. */
    @Transactional
    public ApplyResult apply(ApplyRequest request) {
        SavedPlan plan=read(request.planId());
        Set<String> selected=new HashSet<>(list(request.walletIds()));
        if(selected.size()!=list(request.walletIds()).size())throw bad("Повторный кошелёк в сверке");
        Map<String,WalletPlan> wallets=new HashMap<>();
        plan.wallets().forEach(item->wallets.put(item.walletId(),item));
        if(!wallets.keySet().containsAll(selected))throw bad("Кошелёк не прошёл предварительную проверку");
        // Imported metadata is seeded by Node; derived balance writes do not change its clocks.
        jdbc.queryForObject("select set_config('ovoshi.sync_tracking','off',true)",String.class);
        for(String walletId:selected.stream().sorted(Comparator.comparingLong(DataTransferReconciliationService::id)).toList()) {
            WalletPlan expected=wallets.get(walletId);
            LocalWallet actual=local(id(walletId),true);
            if(!Objects.equals(actual.uid(),expected.uid()) || actual.entries().size()!=expected.entries().size())
                throw bad("Объединённая история кошелька не совпадает с проверенным планом");
            Map<UUID,Entry> actualByUid=new HashMap<>();
            for(Entry entry:actual.entries())if(entry.uid()==null||actualByUid.put(entry.uid(),entry)!=null)
                throw bad("Неоднозначная идентичность объединённых операций кошелька");
            for(Entry wanted:expected.entries())if(!sameEffect(wanted,actualByUid.get(wanted.uid())))
                throw bad("Изменился состав или содержание операций кошелька");
            validateOrderCharges(id(walletId),expected.entries());
            BigDecimal running=money(expected.opening());
            for(Entry entry:expected.entries()) {
                running=nonnegative(running.add(delta(entry)));
                jdbc.update("update wallet_transactions set balance_after=? where id=? and wallet_id=?",
                        running,id(actualByUid.get(entry.uid()).id()),id(walletId));
            }
            if(running.compareTo(money(expected.closing()))!=0)throw bad("Не совпадает итоговый баланс кошелька");
            jdbc.update("update wallets set balance=?,updated_at=clock_timestamp() where id=?",running,id(walletId));
        }
        Set<String> approved=new HashSet<>();
        plan.warehouses().forEach(unit->approved.add(unit.warehouseId()+":"+unit.productId()));
        Set<String> selectedPairs=new HashSet<>();
        List<WarehouseUnit> units=list(request.warehouses()).stream()
                .sorted(Comparator.comparingLong((WarehouseUnit unit)->id(unit.warehouseId()))
                        .thenComparingLong(unit->id(unit.productId()))).toList();
        for(WarehouseUnit unit:units) {
            String pair=unit.warehouseId()+":"+unit.productId();
            if(!approved.contains(pair)||!selectedPairs.add(pair))throw bad("Складской журнал не прошёл проверку");
        }
        for(long warehouse:units.stream().map(unit->id(unit.warehouseId())).distinct().toList()) {
            if(jdbc.query("select id from warehouses where id=? for update",(row,n)->row.getLong(1),warehouse).isEmpty())
                throw bad("Склад не найден");
        }
        for(WarehouseUnit unit:units)warehouseReplay.apply(id(unit.warehouseId()),id(unit.productId()));
        if(!units.isEmpty()) {
            entities.flush();
            // Replay can create new FIFO layers and revision rows while native
            // tracking is off. Register only those new identities, without
            // manufacturing business update clocks or touching parent clocks.
            for(String table:List.of("stock_cost_layers","stock_ledger_revisions")) {
                jdbc.update("insert into sync_rows(table_name,pk,observed_at,aggregate_table,aggregate_pk) "
                        +"select ?,jsonb_build_object('id',t.id::text),t.created_at,owner->>'table',owner->'key' "
                        +"from public."+table+" t cross join lateral (select sync_aggregate(?,to_jsonb(t)) as owner) a "
                        +"where true "
                        +"on conflict(table_name,pk) where not deleted do nothing",table,table);
            }
        }
        Map<UUID,IncomingOrder> orders=new HashMap<>();plan.orders().forEach(order->orders.put(order.id(),order));
        Set<UUID> selectedOrders=new HashSet<>(list(request.orderIds()));
        if(selectedOrders.size()!=list(request.orderIds()).size()||!orders.keySet().containsAll(selectedOrders))
            throw bad("Заказ не прошёл предварительную проверку номера");
        for(UUID orderId:selectedOrders) {
            IncomingOrder wanted=orders.get(orderId);
            var found=jdbc.query("select order_number_date,daily_number from orders where id=?",
                    (row,n)->new IncomingOrder(orderId,row.getObject(1,LocalDate.class),row.getString(2)),orderId);
            if(found.size()!=1||!found.get(0).equals(wanted))throw bad("Номер заказа не совпадает с проверенным планом");
        }
        jdbc.update("""
                insert into order_daily_counters(order_number_date,last_daily_number)
                select order_number_date,max(daily_number) from orders group by order_number_date
                on conflict(order_number_date) do update set last_daily_number=
                greatest(order_daily_counters.last_daily_number,excluded.last_daily_number)
                """);
        return new ApplyResult(selected.size(),units.size(),selectedOrders.size());
    }

    static WalletPlan planWallet(String walletId,UUID localUid,String balance,List<Entry> local,SourceWallet source) {
        if(localUid==null||source.uid()==null||!localUid.equals(source.uid()))throw bad("Не подтверждён общий идентификатор кошелька");
        List<Entry> left=ordered(local),right=ordered(list(source.transactions()));
        BigDecimal opening=opening(balance,left),otherOpening=opening(source.balance(),right);
        if(opening.compareTo(otherOpening)!=0)throw bad("Начальные балансы кошелька не совпадают");
        Map<UUID,Entry> union=new LinkedHashMap<>();
        for(Entry entry:left)union.put(entry.uid(),entry);
        for(Entry entry:right) {
            Entry existing=union.get(entry.uid());
            if(existing!=null&&!sameEffect(existing,entry))throw bad("Одна операция кошелька содержит разные данные");
            union.putIfAbsent(entry.uid(),entry);
        }
        List<Entry> merged=ordered(List.copyOf(union.values()),false);
        Set<UUID> refundedOrders=new HashSet<>();
        for(Entry entry:merged)if("REFUND".equals(entry.type())&&entry.orderId()!=null&&!refundedOrders.add(entry.orderId()))
            throw bad("Заказ имеет несколько независимых возвратов по кошельку");
        Set<UUID> leftUids=new HashSet<>(),rightUids=new HashSet<>(),leftChangedOrders=new HashSet<>();
        left.forEach(entry->leftUids.add(entry.uid()));right.forEach(entry->rightUids.add(entry.uid()));
        for(Entry entry:left)if(entry.orderId()!=null&&!rightUids.contains(entry.uid()))leftChangedOrders.add(entry.orderId());
        for(Entry entry:right)if(entry.orderId()!=null&&!leftUids.contains(entry.uid())&&leftChangedOrders.contains(entry.orderId()))
            throw bad("Оплата одного заказа изменялась в обеих копиях: нужна проверка целого финансового блока");
        BigDecimal closing=opening;
        for(Entry entry:merged)closing=nonnegative(closing.add(delta(entry)));
        return new WalletPlan(walletId,localUid,opening.toPlainString(),closing.toPlainString(),merged);
    }

    private static List<Entry> ordered(List<Entry> entries) {
        return ordered(entries,true);
    }
    private static List<Entry> ordered(List<Entry> entries,boolean uniqueOriginalIds) {
        if(entries.size()>100_000)throw bad("Слишком большой журнал кошелька для автоматического объединения");
        if(entries.stream().anyMatch(entry->entry==null||entry.createdAt()==null))throw bad("Неполная операция кошелька");
        List<Entry> ordered=entries.stream().sorted(Comparator.comparing(Entry::createdAt)
                .thenComparingLong(entry->id(entry.id()))).toList();
        Set<UUID> uids=new HashSet<>();Set<Long> ids=new HashSet<>();
        Instant previous=null;
        for(Entry entry:ordered) {
            if(entry.uid()==null||!uids.add(entry.uid())||(uniqueOriginalIds&&!ids.add(id(entry.id()))))
                throw bad("Неполные или повторяющиеся операции кошелька");
            delta(entry);money(entry.balanceAfter());
            if(previous!=null&&!entry.createdAt().isAfter(previous))
                throw bad("Нельзя подтвердить порядок истории кошелька: операции имеют одинаковое время");
            previous=entry.createdAt();
        }
        return ordered;
    }
    private static BigDecimal opening(String terminal,List<Entry> entries) {
        BigDecimal balance=nonnegative(money(terminal));
        for(Entry entry:entries)balance=balance.subtract(delta(entry));
        BigDecimal opening=nonnegative(balance);
        for(Entry entry:entries) {
            balance=nonnegative(balance.add(delta(entry)));
            if(balance.compareTo(money(entry.balanceAfter()))!=0)throw bad("История и сохранённые балансы кошелька не согласованы");
        }
        return opening;
    }
    private static boolean sameEffect(Entry a,Entry b) {
        if(a==null||b==null)return false;
        return Objects.equals(a.uid(),b.uid())&&Objects.equals(a.type(),b.type())
                && money(a.amount()).compareTo(money(b.amount()))==0
                &&Objects.equals(a.orderId(),b.orderId())&&Objects.equals(a.createdAt(),b.createdAt());
    }
    private static BigDecimal delta(Entry entry) {
        BigDecimal amount=money(entry.amount());
        if(amount.signum()<=0)throw bad("Некорректная сумма операции кошелька");
        return switch(Objects.toString(entry.type(),"")) {
            case "CREDIT","REFUND","PRICE_REFUND" -> amount;
            case "DEBIT","PRICE_DEBIT" -> amount.negate();
            default -> throw bad("Неизвестный тип операции кошелька");
        };
    }
    private static BigDecimal money(String value) {
        if(value==null)throw bad("Не указана денежная сумма");
        try {
            BigDecimal amount=new BigDecimal(value).setScale(2,RoundingMode.UNNECESSARY);
            if(amount.precision()>14)throw bad("Сумма превышает допустимую точность");
            return amount;
        } catch(IllegalArgumentException|ArithmeticException error){throw bad("Некорректная денежная сумма");}
    }
    private static BigDecimal nonnegative(BigDecimal value) {
        if(value.signum()<0||value.precision()>14)throw bad("Объединение создаёт недопустимый баланс кошелька");
        return value;
    }
    private LocalWallet local(long walletId,boolean lock) {
        var balances=jdbc.query("select w.balance,s.uid from wallets w left join sync_rows s on s.table_name='wallets' "
                +"and not s.deleted and s.pk->>'id'=w.id::text where w.id=?"+(lock?" for update of w":""),
                (row,n)->new LocalWallet(row.getObject(2,UUID.class),row.getString(1),List.of(),false),walletId);
        if(balances.size()!=1)throw bad("Кошелёк не найден или имеет неоднозначную идентичность");
        var entries=jdbc.query("""
                select t.id,s.uid,t.type,t.amount,t.balance_after,t.order_id,t.created_at
                from wallet_transactions t left join sync_rows s on s.table_name='wallet_transactions'
                and not s.deleted and s.pk->>'id'=t.id::text where t.wallet_id=? order by t.id
                """,(row,n)->new Entry(row.getObject(2,UUID.class),row.getString(1),row.getString(3),
                        row.getString(4),row.getString(5),row.getObject(6,UUID.class),row.getTimestamp(7).toInstant()),walletId);
        boolean tombstones=Boolean.TRUE.equals(jdbc.queryForObject("select exists(select 1 from sync_rows where "
                +"table_name='wallet_transactions' and deleted and aggregate_table='wallets' and aggregate_pk->>'id'=?)",
                Boolean.class,String.valueOf(walletId)));
        LocalWallet row=balances.getFirst();
        return new LocalWallet(row.uid(),row.balance(),entries,tombstones);
    }
    private record OrderPayment(UUID id,String userId,String method,String status,String paid) {}
    private void validateOrderCharges(long walletId,List<Entry> entries) {
        Map<UUID,BigDecimal> charged=new HashMap<>();
        for(Entry entry:entries)if(entry.orderId()!=null)charged.merge(entry.orderId(),delta(entry).negate(),BigDecimal::add);
        String owner=jdbc.queryForObject("select user_id::text from wallets where id=?",String.class,walletId);
        var payments=jdbc.query("""
                select o.id,o.user_id::text,o.payment_method,o.payment_status,o.paid_total::text
                from orders o where (o.user_id::text=? and o.created_by_user_id is null and o.payment_method='BALANCE')
                or exists(select 1 from wallet_transactions t where t.wallet_id=? and t.order_id=o.id)
                """,(row,n)->new OrderPayment(row.getObject(1,UUID.class),row.getString(2),row.getString(3),row.getString(4),row.getString(5)),owner,walletId);
        Set<UUID> seen=new HashSet<>();
        for(OrderPayment payment:payments) {
            if(!Objects.equals(payment.userId(),owner))throw bad("Операция кошелька относится к другому покупателю заказа");
            BigDecimal expected="BALANCE".equals(payment.method())&&"PAID".equals(payment.status())?money(payment.paid()):BigDecimal.ZERO;
            if(charged.getOrDefault(payment.id(),BigDecimal.ZERO).compareTo(expected)!=0)
                throw bad("Журнал кошелька не согласован с оплатой объединённого заказа");
            seen.add(payment.id());
        }
        if(!seen.containsAll(charged.keySet()))throw bad("Не найден заказ для операции кошелька");
    }
    private List<IncomingOrder> allocateNumbers(List<IncomingOrder> incoming) {
        Map<LocalDate,Long> maximum=new HashMap<>();Map<LocalDate,Set<Long>> used=new HashMap<>();Set<UUID> ids=new HashSet<>();
        List<IncomingOrder> result=new ArrayList<>();
        for(IncomingOrder order:incoming) {
            if(order.id()==null||order.orderNumberDate()==null||!ids.add(order.id()))throw bad("Некорректные новые заказы");
            if(!jdbc.query("select id from orders where id=?",(row,n)->row.getObject(1,UUID.class),order.id()).isEmpty())
                throw bad("Для существующего заказа нельзя назначить новый номер");
            LocalDate date=order.orderNumberDate();
            if(!used.containsKey(date)) {
                var values=jdbc.query("select daily_number from orders where order_number_date=?",(row,n)->row.getLong(1),date);
                used.put(date,new HashSet<>(values));
                Long counter=jdbc.queryForObject("select coalesce(max(last_daily_number),0) from order_daily_counters where order_number_date=?",Long.class,date);
                maximum.put(date,Math.max(counter==null?0:counter,values.stream().mapToLong(Long::longValue).max().orElse(0)));
            }
            long number=id(order.dailyNumber());
            if(used.get(date).contains(number)) {
                try {number=Math.addExact(maximum.get(date),1);}catch(ArithmeticException error){throw bad("Исчерпаны номера заказов на дату");}
            }
            used.get(date).add(number);maximum.put(date,Math.max(maximum.get(date),number));
            result.add(new IncomingOrder(order.id(),date,String.valueOf(number)));
        }
        return List.copyOf(result);
    }
    private void save(UUID id,SavedPlan plan) {
        try {
            Files.createDirectories(plans);
            if(Files.isSymbolicLink(plans))throw bad("Некорректный каталог плана объединения");
            Path temporary=Files.createTempFile(plans,"plan-",".tmp");
            try {
                try {Files.setPosixFilePermissions(temporary,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));}
                catch(UnsupportedOperationException ignored) {}
                Files.write(temporary,mapper.writeValueAsBytes(plan));
                try(var channel=java.nio.channels.FileChannel.open(temporary,java.nio.file.StandardOpenOption.WRITE)){channel.force(true);}
                Files.move(temporary,plans.resolve(id+".json"),StandardCopyOption.ATOMIC_MOVE);
            } finally {Files.deleteIfExists(temporary);}
        } catch(IOException error){throw bad("Не удалось сохранить проверенный план объединения");}
    }
    private SavedPlan read(UUID id) {
        if(id==null)throw bad("Не указан проверенный план объединения");
        Path file=plans.resolve(id+".json");
        try {
            if(Files.isSymbolicLink(file)||Files.size(file)>32L*1024*1024)throw bad("Некорректный план объединения");
            SavedPlan plan=mapper.readValue(Files.readAllBytes(file),SavedPlan.class);
            if(plan.createdAt().isBefore(Instant.now().minusSeconds(3600)))throw bad("План объединения устарел. Повторите проверку");
            return plan;
        } catch(IOException error){throw bad("Не найден проверенный план объединения");}
    }
    private static long id(String value) {
        try {long id=Long.parseLong(value);if(id<=0)throw new NumberFormatException();return id;}
        catch(NumberFormatException error){throw bad("Некорректный идентификатор");}
    }
    private static <T> List<T> list(List<T> values){return values==null?List.of():values;}
    private static AppExceptions.BadRequest bad(String message){return new AppExceptions.BadRequest(message);}
}
