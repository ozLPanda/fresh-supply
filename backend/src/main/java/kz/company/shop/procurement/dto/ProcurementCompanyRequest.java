package kz.company.shop.procurement.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.util.List;
import kz.company.shop.procurement.entity.ProcurementCompanyStatus;

public record ProcurementCompanyRequest(
        @NotBlank @Size(max = 500) String name,
        String market,
        @Min(1800) @Max(3000) Integer marketSinceYear,
        @Min(1800) @Max(3000) Integer reviewsFromYear,
        @Min(1800) @Max(3000) Integer reviewsToYear,
        String comment,
        List<@Valid ProcurementCompanyLinkRequest> links,
        @DecimalMin(value = "0.00", message = "Цена компании не может быть отрицательной")
                @Digits(
                        integer = 12,
                        fraction = 2,
                        message =
                                "Цена компании может содержать не более двух знаков после запятой")
                BigDecimal price,
        String priceCurrency,
        ProcurementCompanyStatus companyStatus,
        @Size(max = 2000) String decisionComment) {}
