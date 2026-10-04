package kz.company.shop.reviews.dto;

import jakarta.validation.constraints.NotNull;
import kz.company.shop.reviews.entity.ReviewStatus;

public record ReviewStatusUpdateRequest(@NotNull ReviewStatus status) {}
