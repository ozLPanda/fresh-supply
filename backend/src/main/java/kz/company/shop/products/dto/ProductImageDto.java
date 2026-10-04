package kz.company.shop.products.dto;

public record ProductImageDto(
        Long id,
        String fileName,
        String originalFileName,
        String filePath,
        String contentHash,
        int sortOrder,
        boolean mainImage) {}
