package kz.company.shop.procurement.dto;

import java.time.Instant;

public record ProcurementFileDto(
        Long id,
        Long companyId,
        String displayName,
        String fileName,
        String filePath,
        String originalFileName,
        String contentType,
        long fileSize,
        Long uploadedByUserId,
        Instant createdAt) {}
