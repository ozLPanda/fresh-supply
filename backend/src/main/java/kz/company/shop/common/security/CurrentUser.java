package kz.company.shop.common.security;

import java.math.BigDecimal;
import java.util.Set;

public record CurrentUser(
        Long id,
        String email,
        String name,
        String phone,
        Set<String> permissions,
        boolean adminAccess,
        BigDecimal balance,
        BigDecimal personalDiscountPercent) {

    public CurrentUser(
            Long id,
            String email,
            String name,
            String phone,
            Set<String> permissions,
            boolean adminAccess,
            BigDecimal balance) {
        this(id, email, name, phone, permissions, adminAccess, balance, BigDecimal.ZERO);
    }
}
