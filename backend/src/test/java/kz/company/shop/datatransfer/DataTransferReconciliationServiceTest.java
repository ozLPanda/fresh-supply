package kz.company.shop.datatransfer;

import static org.assertj.core.api.Assertions.*;
import java.time.Instant;
import java.util.*;
import kz.company.shop.common.exception.AppExceptions;
import org.junit.jupiter.api.Test;
import kz.company.shop.datatransfer.DataTransferReconciliationService.*;

class DataTransferReconciliationServiceTest {
    private final UUID wallet=UUID.randomUUID();
    private final Instant time=Instant.parse("2026-10-13T00:00:00Z");
    private long tick;
    private Entry entry(String id,String type,String amount,String after) {
        return new Entry(UUID.randomUUID(),id,type,amount,after,null,time.plusSeconds(tick++));
    }
    private SourceWallet source(String balance,List<Entry> entries) {
        return new SourceWallet(wallet,balance,entries.size(),true,List.of(),entries);
    }

    @Test void independentCreditsWithCollidingNumericIdsAreAddedOnceByUid() {
        Entry local=entry("1","CREDIT","50.00","50.00"),remote=entry("1","CREDIT","100.00","100.00");
        WalletPlan plan=DataTransferReconciliationService.planWallet("1",wallet,"50.00",List.of(local),source("100.00",List.of(remote)));
        assertThat(plan.opening()).isEqualTo("0.00");
        assertThat(plan.closing()).isEqualTo("150.00");
        assertThat(plan.entries()).extracting(Entry::uid).containsExactly(local.uid(),remote.uid());
    }

    @Test void preservesAnExplicitlyDerivedNonzeroOpeningBalance() {
        Entry local=entry("1","CREDIT","50.00","150.00"),remote=entry("1","CREDIT","100.00","200.00");
        WalletPlan plan=DataTransferReconciliationService.planWallet("1",wallet,"150.00",List.of(local),source("200.00",List.of(remote)));
        assertThat(plan.opening()).isEqualTo("100.00");assertThat(plan.closing()).isEqualTo("250.00");
    }

    @Test void commonUidIsNeverCreditedTwiceAndDerivedSnapshotBalancesMayDiffer() {
        Entry shared=entry("1","CREDIT","100.00","100.00"),local=entry("2","DEBIT","30.00","70.00"),remote=entry("2","PRICE_REFUND","10.00","110.00");
        WalletPlan plan=DataTransferReconciliationService.planWallet("1",wallet,"70.00",List.of(shared,local),source("110.00",List.of(shared,remote)));
        assertThat(plan.entries()).hasSize(3);assertThat(plan.closing()).isEqualTo("80.00");
    }

    @Test void holdsAnInconsistentOrTruncatedLedgerInsteadOfInventingAnOpening() {
        Entry local=entry("1","CREDIT","50.00","50.00"),remote=entry("1","CREDIT","100.00","100.00");
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"51.00",List.of(local),source("100.00",List.of(remote))))
                .isInstanceOf(AppExceptions.BadRequest.class).hasMessageContaining("не согласованы");
        Entry firstRemoved=entry("2","CREDIT","50.00","150.00");
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"150.00",List.of(firstRemoved),source("100.00",List.of(remote))))
                .isInstanceOf(AppExceptions.BadRequest.class).hasMessageContaining("Начальные балансы");
    }

    @Test void rejectsChangedCommonTransactionAndAllowsProvenHistoricalCredits() {
        Entry shared=entry("2","CREDIT","100.00","100.00");
        Entry changed=new Entry(shared.uid(),"2","CREDIT","101.00","101.00",null,time);
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"100.00",List.of(shared),source("101.00",List.of(changed))))
                .hasMessageContaining("разные данные");
        Entry earlier=new Entry(UUID.randomUUID(),"1","CREDIT","50.00","50.00",null,time.minusSeconds(1));
        Entry laterShared=new Entry(shared.uid(),"2","CREDIT","100.00","150.00",null,time);
        WalletPlan historic=DataTransferReconciliationService.planWallet("1",wallet,"100.00",List.of(shared),source("150.00",List.of(earlier,laterShared)));
        assertThat(historic.closing()).isEqualTo("150.00");
        assertThat(historic.entries()).extracting(Entry::uid).containsExactly(earlier.uid(),shared.uid());
    }

    @Test void rejectsCombinedDoubleSpendingAndIndependentDuplicateOrderRefunds() {
        Entry common=entry("1","CREDIT","100.00","100.00"),local=entry("2","DEBIT","80.00","20.00"),remote=entry("2","DEBIT","70.00","30.00");
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"20.00",List.of(common,local),source("30.00",List.of(common,remote))))
                .hasMessageContaining("недопустимый баланс");
        UUID order=UUID.randomUUID();
        Entry a=new Entry(UUID.randomUUID(),"1","REFUND","10.00","10.00",order,time),b=new Entry(UUID.randomUUID(),"1","REFUND","10.00","10.00",order,time.plusSeconds(1));
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"10.00",List.of(a),source("10.00",List.of(b))))
                .hasMessageContaining("несколько независимых возвратов");
    }

    @Test void rejectsUnsharedIdentityUnknownTypesExcessPrecisionAndIncompleteEvents() {
        Entry local=entry("1","CREDIT","50.00","50.00");
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",UUID.randomUUID(),"50.00",List.of(local),source("50.00",List.of(local))))
                .hasMessageContaining("идентификатор");
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"1.00",List.of(entry("1","UNKNOWN","1.00","1.00")),source("0.00",List.of())))
                .hasMessageContaining("Неизвестный тип");
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"1.00",List.of(entry("1","CREDIT","1.001","1.00")),source("0.00",List.of())))
                .hasMessageContaining("денежная сумма");
    }

    @Test void holdsHistoricalDoubleSpendEvenWhenItsFinalSumIsNonnegative() {
        Entry common=new Entry(UUID.randomUUID(),"1","CREDIT","100.00","100.00",null,time);
        Entry localDebit=new Entry(UUID.randomUUID(),"2","DEBIT","80.00","20.00",null,time.plusSeconds(2));
        Entry localCredit=new Entry(UUID.randomUUID(),"3","CREDIT","70.00","90.00",null,time.plusSeconds(3));
        Entry sourceDebit=new Entry(UUID.randomUUID(),"2","DEBIT","80.00","20.00",null,time.plusSeconds(1));
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"90.00",
                List.of(common,localDebit,localCredit),source("20.00",List.of(common,sourceDebit))))
                .hasMessageContaining("недопустимый баланс");
    }

    @Test void holdsEqualClockAndNonchronologicalOriginalIdSequences() {
        Entry local=new Entry(UUID.randomUUID(),"1","CREDIT","50.00","50.00",null,time);
        Entry remote=new Entry(UUID.randomUUID(),"1","CREDIT","100.00","100.00",null,time);
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"50.00",List.of(local),source("100.00",List.of(remote))))
                .hasMessageContaining("одинаковое время");
        Entry earlier=new Entry(UUID.randomUUID(),"2","CREDIT","10.00","60.00",null,time.minusSeconds(1));
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"60.00",List.of(local,earlier),source("0.00",List.of())))
                .hasMessageContaining("не согласованы");
    }

    @Test void independentDebitsForTheSameOrderMustNotDoubleChargeOnePayment() {
        UUID order=UUID.randomUUID();
        Entry common=new Entry(UUID.randomUUID(),"1","CREDIT","500.00","500.00",null,time);
        Entry local=new Entry(UUID.randomUUID(),"2","DEBIT","100.00","400.00",order,time.plusSeconds(1));
        Entry remote=new Entry(UUID.randomUUID(),"2","DEBIT","100.00","400.00",order,time.plusSeconds(2));
        assertThatThrownBy(()->DataTransferReconciliationService.planWallet("1",wallet,"400.00",List.of(common,local),source("400.00",List.of(common,remote))))
                .hasMessageContaining("изменялась в обеих копиях");
    }
}
