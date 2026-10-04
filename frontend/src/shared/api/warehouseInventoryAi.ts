import { api } from "@/shared/api/http";

export type InventoryAiRow = {
  pageNumber: number;
  sourceNumber: number | null;
  sourceName: string;
  quantity: number | null;
  productId: number | null;
  productName: string | null;
  sku: string | null;
  suggestedProductId: number | null;
  suggestedProductName: string | null;
  suggestedSku: string | null;
  question: string | null;
};

export type InventoryAiResult = {
  assistantMessage: string;
  rows: InventoryAiRow[];
  questions: string[];
};

export function analyzeInventoryPhotos(files: File[]) {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  return api<InventoryAiResult>("/api/admin/warehouse/inventory/ai/analyze", {
    method: "POST",
    body,
  });
}

export function clarifyInventoryPhotos(rows: InventoryAiRow[], message: string) {
  return api<InventoryAiResult>("/api/admin/warehouse/inventory/ai/clarify", {
    method: "POST",
    body: JSON.stringify({ rows, message }),
  });
}
