package kz.company.shop.priceImports.dto;

import java.util.List;

public record ImportCreatedProductActivationAnalysisDto(
        int totalDrafts,
        int readyToActivate,
        List<String> excludedNameTerms,
        List<ImportCreatedProductActivationSkipDto> skippedProducts) {}
