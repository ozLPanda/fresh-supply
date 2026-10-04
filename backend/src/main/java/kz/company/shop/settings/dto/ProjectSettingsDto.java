package kz.company.shop.settings.dto;

import java.util.List;

public record ProjectSettingsDto(
        boolean searchAiEnabled,
        boolean embeddingsConfigured,
        int wholesaleMinQuantity,
        List<String> priceImportExcludedNameTerms) {}
