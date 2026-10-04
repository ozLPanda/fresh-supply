import type { MeasurementUnit } from "@/shared/types/models";

export const measurementUnitOptions = [
  { value: "KG", label: "кг" },
  { value: "PIECE", label: "шт" },
] satisfies Array<{ value: MeasurementUnit; label: string }>;

export function measurementUnitLabel(unit?: MeasurementUnit) {
  return unit === "KG" ? "кг" : "шт";
}
