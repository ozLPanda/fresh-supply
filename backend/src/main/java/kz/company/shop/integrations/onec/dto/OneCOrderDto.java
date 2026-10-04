package kz.company.shop.integrations.onec.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

public record OneCOrderDto(
        String code,
        String customer,
        String contactPhone,
        Instant createdAt,
        BigDecimal total,
        int itemCount,
        List<OneCOrderItemDto> items) {}
