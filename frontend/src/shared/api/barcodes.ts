import { api, API_URL } from "@/shared/api/http";
import type { ApiResponse } from "@/shared/types/models";

export type BarcodePdfItem = {
  value: string;
  quantity: number;
  name?: string;
};

export type BarcodePdfMode = "COMPACT" | "WITH_NAME";

export type BarcodePdfRequest = {
  mode: BarcodePdfMode;
  excludeIncompleteSheet: boolean;
  items: BarcodePdfItem[];
};

export type BarcodePdfDownload = {
  blob: Blob;
  fileName: string;
};

export type BarcodeProductLookup = {
  id: number;
  name: string | null;
};

export async function findBarcodeProducts(
  skus: string[],
): Promise<Record<string, BarcodeProductLookup>> {
  return api<Record<string, BarcodeProductLookup>>("/api/admin/barcodes/product-names", {
    method: "POST",
    body: JSON.stringify({ skus }),
  });
}

function responseFileName(header: string | null) {
  if (!header) return "barcodes.pdf";

  const encodedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) return decodeURIComponent(encodedMatch[1]);

  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? "barcodes.pdf";
}

export async function generateBarcodePdf(request: BarcodePdfRequest): Promise<BarcodePdfDownload> {
  const headers = new Headers({ "Content-Type": "application/json" });

  const response = await fetch(`${API_URL}/api/admin/barcodes/pdf`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    let message = "Не удалось сгенерировать PDF";
    try {
      const error = (await response.json()) as ApiResponse<unknown>;
      if (error.message) message = error.message;
    } catch {
      // The server can return an empty or non-JSON response for infrastructure errors.
    }
    throw new Error(message);
  }

  return {
    blob: await response.blob(),
    fileName: responseFileName(response.headers.get("Content-Disposition")),
  };
}
