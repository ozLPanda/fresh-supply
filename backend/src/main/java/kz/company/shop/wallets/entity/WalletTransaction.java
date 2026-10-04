package kz.company.shop.wallets.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "wallet_transactions")
public class WalletTransaction {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;

    @Column(name = "wallet_id", nullable = false)
    public Long walletId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    public WalletTransactionType type;

    @Column(nullable = false, precision = 14, scale = 2)
    public BigDecimal amount;

    @Column(name = "balance_after", nullable = false, precision = 14, scale = 2)
    public BigDecimal balanceAfter;

    @Column(name = "order_id")
    public UUID orderId;

    @Column(name = "actor_user_id")
    public Long actorUserId;

    @Column(nullable = false, length = 500)
    public String comment;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt = Instant.now();
}
