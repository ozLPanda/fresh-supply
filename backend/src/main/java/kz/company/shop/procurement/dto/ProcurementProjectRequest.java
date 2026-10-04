package kz.company.shop.procurement.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ProcurementProjectRequest(
        @NotBlank @Size(max = 500) String name, String purchaseInformation) {}
