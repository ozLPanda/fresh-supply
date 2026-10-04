package kz.company.shop.categories.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

public record CategoryDto(
        Long id,
        Long parentId,
        @NotBlank String nameRu,
        @NotBlank String nameKk,
        String parentNameRu,
        String descriptionRu,
        String descriptionKk,
        String imageFileName,
        String imageOriginalFileName,
        String imageFilePath,
        String imageContentHash,
        @NotBlank String slug,
        int sortOrder,
        boolean active,
        List<CategoryDto> children) {}
