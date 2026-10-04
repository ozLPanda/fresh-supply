package kz.company.shop.users.dto;

import jakarta.validation.constraints.Size;

public record OrderSettingsUpdateRequest(@Size(max = 2000) String invoiceTemplate) {}
