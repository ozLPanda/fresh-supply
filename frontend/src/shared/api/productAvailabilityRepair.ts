import { api } from "@/shared/api/http";

export type ProductAvailabilityRepairPreview = {
  id: number;
  sku: string;
  currentNameRu: string;
  correctedNameRu: string;
  active: boolean;
  madeToOrder: boolean;
  matchedKeywords: string[];
};

export type ProductAvailabilityRepairResult = {
  updatedCount: number;
  skippedCount: number;
};

export function previewProductAvailabilityRepair(keywords: string[]) {
  const params = new URLSearchParams();
  keywords.forEach((keyword) => params.append("keyword", keyword));
  return api<ProductAvailabilityRepairPreview[]>(
    `/api/products/availability-repair/preview?${params.toString()}`,
  );
}

export function applyProductAvailabilityRepair(productIds: number[], keywords: string[]) {
  return api<ProductAvailabilityRepairResult>("/api/products/availability-repair/apply", {
    method: "POST",
    body: JSON.stringify({ productIds, keywords }),
  });
}
