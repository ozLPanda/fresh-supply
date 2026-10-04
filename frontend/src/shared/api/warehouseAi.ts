import { api, API_URL } from "@/shared/api/http";
import { type WarehousePriceType } from "@/shared/api/warehouse";
import type { ApiResponse } from "@/shared/types/models";

export const AI_PRICE_TYPES: WarehousePriceType[] = [
  "RETAIL",
  "WHOLESALE",
  "BULK_WHOLESALE",
  "SKO",
  "GSKO",
  "INCOMING",
];

export type AiPriceValue = {
  oldPrice: number | null;
  newPrice: number | null;
  changePercent: number | null;
  reason: string;
};

export type AiPriceRow = {
  productId: number;
  sku: string | null;
  productName: string;
  quantity: number;
  unitCost: number | null;
  catalogOnly?: boolean;
  prices: Partial<Record<WarehousePriceType, AiPriceValue>>;
};

export type AiPriceSession = {
  id: string;
  receiptId: string;
  groupId: string;
  groupName: string;
  status: "QUESTIONS" | "PREVIEW" | "CONFIRMED";
  assistantMessage: string | null;
  questions: string[];
  messages: Array<{ role: "assistant" | "user"; content: string }>;
  rows: AiPriceRow[];
  createdDocumentIds: string[];
  canRegenerate: boolean;
  activeGeneratedDocumentIds: string[];
};

export type AiPriceInputRow = {
  productId: number;
  prices: Partial<Record<WarehousePriceType, number>>;
};

export type AiPriceGroupSelection = {
  groupId: string | null;
  sessionId: string | null;
};

export function fetchWarehouseAiPriceGroup(receiptId: string) {
  return api<AiPriceGroupSelection>(
    `/api/admin/warehouse/documents/${encodeURIComponent(receiptId)}/ai-price-group`,
  );
}

export function updateWarehouseAiPriceGroup(receiptId: string, groupId: string | null) {
  return api<AiPriceGroupSelection>(
    `/api/admin/warehouse/documents/${encodeURIComponent(receiptId)}/ai-price-group`,
    {
      method: "PUT",
      body: JSON.stringify({ groupId }),
    },
  );
}

export function createWarehouseAiPriceSession(
  receiptId: string,
  groupId: string,
  message?: string,
) {
  return api<AiPriceSession>(
    `/api/admin/warehouse/price-sources/${encodeURIComponent(receiptId)}/ai-price-sessions`,
    {
      method: "POST",
      body: JSON.stringify({ groupId, ...(message?.trim() ? { message: message.trim() } : {}) }),
    },
  );
}

export function fetchWarehouseAiPriceSession(sessionId: string) {
  return api<AiPriceSession>(
    `/api/admin/warehouse/ai-price-sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function fetchWarehouseAiPricePreviewPdf(sessionId: string): Promise<Blob> {
  const response = await fetch(
    `${API_URL}/api/admin/warehouse/ai-price-sessions/${encodeURIComponent(sessionId)}/preview.pdf`,
    { credentials: "include" },
  );
  if (!response.ok) {
    let message = "Не удалось сформировать PDF-таблицу";
    try {
      const error = (await response.json()) as ApiResponse<unknown>;
      if (error.message) message = error.message;
    } catch {
      // The server can return a non-JSON error page.
    }
    throw new Error(message);
  }
  return response.blob();
}

export function sendWarehouseAiPriceMessage(sessionId: string, message: string) {
  return api<AiPriceSession>(
    `/api/admin/warehouse/ai-price-sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ message }),
    },
  );
}

export function updateWarehouseAiPrices(sessionId: string, rows: AiPriceInputRow[]) {
  return api<AiPriceSession>(
    `/api/admin/warehouse/ai-price-sessions/${encodeURIComponent(sessionId)}/prices`,
    {
      method: "PUT",
      body: JSON.stringify({ rows }),
    },
  );
}

export function confirmWarehouseAiPrices(sessionId: string) {
  return api<AiPriceSession>(
    `/api/admin/warehouse/ai-price-sessions/${encodeURIComponent(sessionId)}/confirm`,
    {
      method: "POST",
    },
  );
}

export function regenerateWarehouseAiPrices(sessionId: string, message?: string) {
  return api<AiPriceSession>(
    `/api/admin/warehouse/ai-price-sessions/${encodeURIComponent(sessionId)}/regenerate`,
    {
      method: "POST",
      body: JSON.stringify(message?.trim() ? { message: message.trim() } : {}),
    },
  );
}
