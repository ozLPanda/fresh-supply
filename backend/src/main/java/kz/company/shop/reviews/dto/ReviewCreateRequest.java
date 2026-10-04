package kz.company.shop.reviews.dto;

import jakarta.validation.constraints.*;

public record ReviewCreateRequest(
        @NotNull Long productId,
        @Min(1) @Max(5) int rating,
        @NotBlank @Size(min = 10, max = 3000) String content) {}
