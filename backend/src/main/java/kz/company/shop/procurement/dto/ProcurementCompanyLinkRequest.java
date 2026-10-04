package kz.company.shop.procurement.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ProcurementCompanyLinkRequest(
        @NotBlank @Size(max = 500) String name,
        @NotBlank
                @Size(max = 4000)
                @Pattern(regexp = "https?://.+", message = "Укажите корректную ссылку")
                String url) {}
