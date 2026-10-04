package kz.company.shop.alibabaSourcing.dto;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;

public record AlibabaSourcingConfigUpdateRequest(
        @NotNull Boolean enabled,
        @Size(max = 500) String searchQuery,
        @DecimalMin("0.01") BigDecimal minimumOrderQuantity,
        @Min(0) Integer minimumCompanyAgeYears) {}
