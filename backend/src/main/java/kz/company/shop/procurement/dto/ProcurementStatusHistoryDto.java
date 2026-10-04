package kz.company.shop.procurement.dto;

import java.time.Instant;
import kz.company.shop.procurement.entity.ProcurementStatus;

public record ProcurementStatusHistoryDto(
        Long id,
        ProcurementStatus oldStatus,
        ProcurementStatus newStatus,
        String comment,
        Long actorUserId,
        String actorName,
        Instant createdAt) {}
