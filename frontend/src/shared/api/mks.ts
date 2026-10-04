import { api } from "@/shared/api/http";

export type MksStatus = {
  configured: boolean;
  connected: boolean;
  lastConnectedAt: string | null;
  message: string;
};

export type MksProduct = {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  model: string | null;
  price: number | null;
  availability: string | null;
  unit: string | null;
  imageUrl: string | null;
  productUrl: string | null;
};

export type MksProductDetails = {
  product: MksProduct;
  barcode: string | null;
  retailPrice: number | null;
  minimumPrice: number | null;
  series: string | null;
  minQuantity: string | null;
  innerQuantity: string | null;
  outerQuantity: string | null;
  images: string[];
  characteristics: { name: string; value: string }[];
  description: string | null;
  advantages: string | null;
  usage: string | null;
};

export type MksFilter = {
  id: string;
  label: string;
  type: "select" | "multiselect" | "boolean" | "number" | "text";
  options: { value: string; label: string }[];
};

export type MksFilterValue = string | string[] | boolean | number;

export type MksSearchRequest = {
  query: string;
  page: number;
  size: number;
  filters: Record<string, MksFilterValue>;
};

export type MksSearchResult = {
  items: MksProduct[];
  page: number;
  size: number;
  totalItems: number | null;
  totalPages: number | null;
  hasMore: boolean;
  filters: MksFilter[];
  warnings: string[];
};

export function fetchMksStatus() {
  return api<MksStatus>("/api/admin/mks/status");
}

export function connectMks() {
  return api<MksStatus>("/api/admin/mks/connect", { method: "POST" });
}

export function searchMks(request: MksSearchRequest) {
  return api<MksSearchResult>("/api/admin/mks/search", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function fetchMksProductDetails(id: string) {
  return api<MksProductDetails>(`/api/admin/mks/products/${encodeURIComponent(id)}`);
}
