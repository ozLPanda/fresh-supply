package kz.company.shop.priceImports.dto;

import java.util.List;

public record ImportCreatedProductActivationResultDto(
        int activatedProducts, List<ImportCreatedProductActivationSkipDto> skippedProducts) {}
