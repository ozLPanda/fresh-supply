package kz.company.shop.products.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record ProductAvailabilityRepairApplyRequest(
        @NotEmpty List<@NotNull Long> productIds,
        @NotEmpty List<@NotBlank @Size(max = 120) String> keywords) {}
