package kz.company.shop.wallets.service;

import java.math.BigDecimal;
import java.util.UUID;
import kz.company.shop.audit.service.AuditService;
import kz.company.shop.common.exception.AppExceptions;
import kz.company.shop.wallets.dto.*;
import kz.company.shop.wallets.entity.*;
import kz.company.shop.wallets.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WalletService {
    private final WalletRepository walletRepository;
    private final WalletTransactionRepository transactionRepository;
    private final AuditService auditService;

    public WalletService(
            WalletRepository walletRepository,
            WalletTransactionRepository transactionRepository,
            AuditService auditService) {
        this.walletRepository = walletRepository;
        this.transactionRepository = transactionRepository;
        this.auditService = auditService;
    }

    @Transactional
    public Wallet ensure(Long userId) {
        return walletRepository
                .findByUserId(userId)
                .orElseGet(
                        () -> {
                            Wallet wallet = new Wallet();
                            wallet.userId = userId;
                            return walletRepository.save(wallet);
                        });
    }

    public BigDecimal balance(Long userId) {
        return walletRepository
                .findByUserId(userId)
                .map(wallet -> wallet.balance)
                .orElse(BigDecimal.ZERO);
    }

    public WalletDto get(Long userId) {
        Wallet wallet = ensure(userId);
        return new WalletDto(
                wallet.balance,
                transactionRepository.findByWalletIdOrderByCreatedAtDesc(wallet.id).stream()
                        .map(this::toDto)
                        .toList());
    }

    @Transactional
    public WalletDto credit(Long userId, Long actorUserId, BalanceCreditRequest request) {
        Wallet wallet = locked(userId);
        wallet.balance = wallet.balance.add(request.amount());
        walletRepository.save(wallet);
        record(
                wallet,
                WalletTransactionType.CREDIT,
                request.amount(),
                null,
                actorUserId,
                request.comment());
        auditService.record(
                "CREDIT",
                "USER",
                userId,
                "Начислил "
                        + request.amount().stripTrailingZeros().toPlainString()
                        + " ₸ на баланс пользователя #"
                        + userId);
        return get(userId);
    }

    public Wallet locked(Long userId) {
        ensure(userId);
        return walletRepository
                .findByUserIdForUpdate(userId)
                .orElseThrow(() -> new AppExceptions.NotFound("Кошелёк не найден"));
    }

    public void debit(Wallet wallet, BigDecimal amount, UUID orderId, String orderDisplayCode) {
        debit(
                wallet,
                amount,
                orderId,
                wallet.userId,
                WalletTransactionType.DEBIT,
                "Оплата заказа #" + orderDisplayCode);
    }

    public void refund(
            Wallet wallet,
            BigDecimal amount,
            UUID orderId,
            String orderDisplayCode,
            Long actorUserId) {
        if (transactionRepository.existsByOrderIdAndType(orderId, WalletTransactionType.REFUND)) {
            return;
        }
        wallet.balance = wallet.balance.add(amount);
        walletRepository.save(wallet);
        record(
                wallet,
                WalletTransactionType.REFUND,
                amount,
                orderId,
                actorUserId,
                "Возврат по отменённому заказу #" + orderDisplayCode);
    }

    public void priceDebit(
            Wallet wallet, BigDecimal amount, UUID orderId, String orderDisplayCode) {
        debit(
                wallet,
                amount,
                orderId,
                wallet.userId,
                WalletTransactionType.PRICE_DEBIT,
                "Доплата после уточнения цен заказа #" + orderDisplayCode);
    }

    public void priceRefund(
            Wallet wallet,
            BigDecimal amount,
            UUID orderId,
            String orderDisplayCode,
            Long actorUserId) {
        wallet.balance = wallet.balance.add(amount);
        walletRepository.save(wallet);
        record(
                wallet,
                WalletTransactionType.PRICE_REFUND,
                amount,
                orderId,
                actorUserId,
                "Корректировка после уточнения цен заказа #" + orderDisplayCode);
    }

    private void debit(
            Wallet wallet,
            BigDecimal amount,
            UUID orderId,
            Long actorUserId,
            WalletTransactionType type,
            String comment) {
        if (wallet.balance.compareTo(amount) < 0) {
            throw new AppExceptions.BadRequest("Недостаточно средств на балансе");
        }
        wallet.balance = wallet.balance.subtract(amount);
        walletRepository.save(wallet);
        record(wallet, type, amount, orderId, actorUserId, comment);
    }

    private void record(
            Wallet wallet,
            WalletTransactionType type,
            BigDecimal amount,
            UUID orderId,
            Long actorUserId,
            String comment) {
        WalletTransaction transaction = new WalletTransaction();
        transaction.walletId = wallet.id;
        transaction.type = type;
        transaction.amount = amount;
        transaction.balanceAfter = wallet.balance;
        transaction.orderId = orderId;
        transaction.actorUserId = actorUserId;
        transaction.comment = comment;
        transactionRepository.save(transaction);
    }

    private WalletTransactionDto toDto(WalletTransaction transaction) {
        return new WalletTransactionDto(
                transaction.id,
                transaction.type,
                transaction.amount,
                transaction.balanceAfter,
                transaction.orderId,
                transaction.actorUserId,
                transaction.comment,
                transaction.createdAt);
    }
}
