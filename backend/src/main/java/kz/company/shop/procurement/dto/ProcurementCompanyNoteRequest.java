package kz.company.shop.procurement.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ProcurementCompanyNoteRequest(@NotBlank @Size(max = 10000) String content) {}
