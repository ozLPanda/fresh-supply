package kz.company.shop.orders.dto;

import jakarta.validation.constraints.Size;

public record OrderPrintCommentUpdateRequest(@Size(max = 4000) String printComment) {}
