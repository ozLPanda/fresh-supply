package kz.company.shop.procurement.dto;

import jakarta.validation.constraints.NotNull;
import kz.company.shop.procurement.entity.ProcurementStatus;

public record ProcurementStatusChangeRequest(@NotNull ProcurementStatus status, String comment) {}
