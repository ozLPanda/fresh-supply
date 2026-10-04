package kz.company.shop.procurement.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record ProcurementTextFileUpdateRequest(
        @NotNull @Size(max = 50 * 1024 * 1024) String text) {}
