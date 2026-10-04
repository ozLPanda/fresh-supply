package kz.company.shop.orders.dto;

import jakarta.validation.constraints.Size;

public record OrderCommentUpdateRequest(@Size(max = 2000) String comment) {}
