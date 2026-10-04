package kz.company.shop.priceImports.dto;

import java.util.List;

public record ImportCreatedProductActivationSkipDto(
        Long productId, String sku, String nameRu, List<String> reasons) {}
