package kz.company.shop.integrations.onec.dto;

import java.math.BigDecimal;

public record OneCOrderItemDto(String sku, BigDecimal quantity) {}
