package kz.company.shop.reviews.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ReviewMessageRequest(@NotBlank @Size(min = 2, max = 2000) String content) {}
