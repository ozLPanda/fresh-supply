package kz.company.shop.wallets.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.wallets.dto.BalanceCreditRequest;
import kz.company.shop.wallets.entity.Wallet;
import kz.company.shop.wallets.entity.WalletTransaction;
import kz.company.shop.wallets.entity.WalletTransactionType;
import kz.company.shop.wallets.repository.WalletRepository;
import kz.company.shop.wallets.repository.WalletTransactionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class WalletServiceTest {
    private WalletRepository walletRepository;
    private WalletTransactionRepository transactionRepository;
    private WalletService service;
    private Wallet wallet;

    @BeforeEach
    void setUp() {
        walletRepository = mock(WalletRepository.class);
        transactionRepository = mock(WalletTransactionRepository.class);
        service =
                new WalletService(
                        walletRepository, transactionRepository, mock(AuditService.class));
        wallet = new Wallet();
        wallet.id = 10L;
        wallet.userId = 7L;
        wallet.balance = new BigDecimal("100.00");
        when(walletRepository.findByUserId(7L)).thenReturn(Optional.of(wallet));
        when(walletRepository.findByUserIdForUpdate(7L)).thenReturn(Optional.of(wallet));
        when(transactionRepository.findByWalletIdOrderByCreatedAtDesc(10L)).thenReturn(List.of());
    }

    @Test
    void creditUpdatesBalanceAndAppendsLedgerEntry() {
        service.credit(7L, 1L, new BalanceCreditRequest(new BigDecimal("50.00"), "Бонус"));

        assertThat(wallet.balance).isEqualByComparingTo("150.00");
        ArgumentCaptor<WalletTransaction> captor = ArgumentCaptor.forClass(WalletTransaction.class);
        verify(transactionRepository).save(captor.capture());
        assertThat(captor.getValue().type).isEqualTo(WalletTransactionType.CREDIT);
        assertThat(captor.getValue().balanceAfter).isEqualByComparingTo("150.00");
        assertThat(captor.getValue().actorUserId).isEqualTo(1L);
    }

    @Test
    void refundIsIdempotentForOrder() {
        UUID orderId = UUID.fromString("00000000-0000-7000-8000-000000000042");
        when(transactionRepository.existsByOrderIdAndType(orderId, WalletTransactionType.REFUND))
                .thenReturn(true);

        service.refund(wallet, new BigDecimal("25.00"), orderId, "2026080342", 1L);

        assertThat(wallet.balance).isEqualByComparingTo("100.00");
        verify(walletRepository, never()).save(any());
        verify(transactionRepository, never()).save(any());
    }
}
