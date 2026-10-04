package kz.company.shop.orders.dto;

import jakarta.validation.constraints.NotNull;
import kz.company.shop.products.entity.MeasurementUnit;

public record OrderItemMeasurementUnitUpdateRequest(@NotNull MeasurementUnit measurementUnit) {}
