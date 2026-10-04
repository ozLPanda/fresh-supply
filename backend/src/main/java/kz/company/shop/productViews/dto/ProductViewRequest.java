package kz.company.shop.productViews.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ProductViewRequest(@NotBlank @Size(max = 120) String visitorId) {}
