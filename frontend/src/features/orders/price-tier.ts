import { PriceTier } from "@/shared/types/models";

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  RETAIL: "Розница",
  WHOLESALE: "Опт",
  BULK_WHOLESALE: "Крупный опт",
  SKO: "СКО",
};

export function priceTierTone(priceTier: PriceTier): "slate" | "blue" | "green" | "orange" {
  if (priceTier === "RETAIL") return "slate";
  if (priceTier === "WHOLESALE") return "blue";
  if (priceTier === "BULK_WHOLESALE") return "green";
  return "orange";
}
