package kz.company.shop.reviews.dto;

import java.time.Instant;
import kz.company.shop.reviews.entity.ReviewMessageAuthorType;

public record ReviewMessageDto(
        Long id,
        Long userId,
        String authorName,
        ReviewMessageAuthorType authorType,
        String content,
        Instant createdAt) {}
