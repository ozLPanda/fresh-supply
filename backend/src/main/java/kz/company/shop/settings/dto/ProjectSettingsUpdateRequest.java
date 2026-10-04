package kz.company.shop.settings.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record ProjectSettingsUpdateRequest(
        @NotNull Boolean searchAiEnabled,
        @NotNull @Min(1) @Max(999) Integer wholesaleMinQuantity,
        @Size(max = 100) List<@Size(min = 1, max = 120) String> priceImportExcludedNameTerms) {}
