package kz.company.shop.wallets.dto;

import java.math.BigDecimal;
import java.util.List;

public record WalletDto(BigDecimal balance, List<WalletTransactionDto> transactions) {}
