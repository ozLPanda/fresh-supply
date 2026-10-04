package kz.company.shop.products.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.products.entity.MeasurementUnit;

public record ProductDto(
        Long id,
        String sku,
        @NotBlank String nameRu,
        String nameKk,
        String shortDescriptionRu,
        String shortDescriptionKk,
        String descriptionRu,
        String descriptionKk,
        @NotNull @DecimalMin("0.01") BigDecimal price,
        BigDecimal wholesalePrice,
        BigDecimal bulkWholesalePrice,
        @JsonInclude(JsonInclude.Include.NON_NULL) BigDecimal skoPrice,
        @JsonInclude(JsonInclude.Include.NON_NULL) BigDecimal gskoPrice,
        Long categoryId,
        String categoryNameRu,
        boolean active,
        boolean madeToOrder,
        Integer deliveryDaysFrom,
        Integer deliveryDaysTo,
        List<ProductImageDto> images,
        @JsonInclude(JsonInclude.Include.NON_NULL) BigDecimal regularPrice,
        @JsonInclude(JsonInclude.Include.NON_NULL) BigDecimal personalDiscountPercent,
        @JsonInclude(JsonInclude.Include.NON_NULL) BigDecimal incomingPrice,
        MeasurementUnit measurementUnit) {
    /** Compatibility overload for callers that predate invoice measurement metadata. */
    public ProductDto(
            Long id,
            String sku,
            String nameRu,
            String nameKk,
            String shortDescriptionRu,
            String shortDescriptionKk,
            String descriptionRu,
            String descriptionKk,
            BigDecimal price,
            BigDecimal wholesalePrice,
            BigDecimal bulkWholesalePrice,
            BigDecimal skoPrice,
            BigDecimal gskoPrice,
            Long categoryId,
            String categoryNameRu,
            boolean active,
            boolean madeToOrder,
            Integer deliveryDaysFrom,
            Integer deliveryDaysTo,
            List<ProductImageDto> images,
            BigDecimal regularPrice,
            BigDecimal personalDiscountPercent,
            BigDecimal incomingPrice) {
        this(
                id,
                sku,
                nameRu,
                nameKk,
                shortDescriptionRu,
                shortDescriptionKk,
                descriptionRu,
                descriptionKk,
                price,
                wholesalePrice,
                bulkWholesalePrice,
                skoPrice,
                gskoPrice,
                categoryId,
                categoryNameRu,
                active,
                madeToOrder,
                deliveryDaysFrom,
                deliveryDaysTo,
                images,
                regularPrice,
                personalDiscountPercent,
                incomingPrice,
                null);
    }
}
