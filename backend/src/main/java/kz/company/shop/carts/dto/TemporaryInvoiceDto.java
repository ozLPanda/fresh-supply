package kz.company.shop.carts.dto;

import java.math.BigDecimal;
import java.util.List;

public record TemporaryInvoiceDto(List<TemporaryInvoiceItemDto> items, BigDecimal total) {}
