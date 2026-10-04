package kz.company.shop.reviews.dto;

public record ReviewImageDto(
        Long id,
        String fileName,
        String filePath,
        String originalFileName,
        long fileSize,
        int sortOrder) {}
