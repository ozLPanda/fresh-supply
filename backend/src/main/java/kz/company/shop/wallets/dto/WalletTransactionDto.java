package kz.company.shop.wallets.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import kz.company.shop.wallets.entity.WalletTransactionType;

public record WalletTransactionDto(
        Long id,
        WalletTransactionType type,
        BigDecimal amount,
        BigDecimal balanceAfter,
        UUID orderId,
        Long actorUserId,
        String comment,
        Instant createdAt) {}
