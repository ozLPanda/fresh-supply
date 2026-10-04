package kz.company.shop.wallets.repository;

import java.util.List;
import java.util.UUID;
import kz.company.shop.wallets.entity.WalletTransaction;
import kz.company.shop.wallets.entity.WalletTransactionType;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WalletTransactionRepository extends JpaRepository<WalletTransaction, Long> {
    List<WalletTransaction> findByWalletIdOrderByCreatedAtDesc(Long walletId);

    boolean existsByOrderIdAndType(UUID orderId, WalletTransactionType type);
}
