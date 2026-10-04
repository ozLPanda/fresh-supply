package kz.company.shop.carts.dto;

import jakarta.validation.Valid;
import java.util.List;

public record CartMergeRequest(List<@Valid CartItemRequest> items) {}
