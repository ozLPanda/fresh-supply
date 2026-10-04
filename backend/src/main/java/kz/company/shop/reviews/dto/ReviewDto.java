package kz.company.shop.reviews.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import kz.company.shop.reviews.entity.ReviewStatus;

public record ReviewDto(
        Long id,
        Long productId,
        String productName,
        Long userId,
        String authorName,
        int rating,
        String content,
        ReviewStatus status,
        boolean verified,
        UUID verifiedOrderId,
        Instant createdAt,
        List<ReviewImageDto> images,
        List<ReviewMessageDto> messages) {}
