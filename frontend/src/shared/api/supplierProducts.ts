import { api } from "@/shared/api/http";
import type { MksProductDetails, MksFilterValue } from "@/shared/api/mks";

export type Supplier = { code: string; name: string };
export type SupplierProduct = {
  id: number;
  supplierCode: string;
  supplierName: string;
  externalId: string;
  sku: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  images: string[];
  purchasePrice: number | null;
  retailPrice: number | null;
  brand: string | null;
  availability: string | null;
  details: MksProductDetails | null;
  syncedAt: string;
};
export type SupplierProductPage = {
  items: SupplierProduct[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
};
export type SupplierImportScope = "SELECTED" | "FILTERED" | "ALL";
export type SupplierImportJob = {
  id: number;
  supplierCode: string;
  supplierName: string;
  scope: SupplierImportScope;
  status: "QUEUED" | "DISCOVERING" | "RUNNING" | "COMPLETED" | "FAILED";
  discovered: number;
  processed: number;
  failed: number;
  pending: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SupplierSyncStatus = {
  totalProducts: number;
  activeJobs: number;
  pending: number;
  failed: number;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
};
export const fetchSupplierSyncStatus = () =>
  api<SupplierSyncStatus>("/api/admin/supplier-products/sync-status");
export type SupplierImportRequest = {
  supplierCode: string;
  scope: SupplierImportScope;
  productIds?: string[];
  query?: string;
  filters?: Record<string, MksFilterValue>;
  categoryIds?: string[];
};
export const SUPPLIER_PRODUCTS_KEY = ["supplier-products"];
export const SUPPLIER_IMPORTS_KEY = ["supplier-product-imports"];
export const fetchSuppliers = () => api<Supplier[]>("/api/admin/supplier-products/suppliers");
export function fetchSupplierProducts(request: {
  supplier: string;
  query: string;
  page: number;
  size: number;
  sort: string;
  direction: "asc" | "desc";
}) {
  const params = new URLSearchParams({
    supplier: request.supplier,
    query: request.query,
    page: String(request.page),
    size: String(request.size),
    sort: request.sort,
    direction: request.direction,
  });
  return api<SupplierProductPage>(`/api/admin/supplier-products?${params}`);
}
export const fetchSupplierProduct = (id: number) =>
  api<SupplierProduct>(`/api/admin/supplier-products/${id}`);
export const fetchSupplierImports = () =>
  api<SupplierImportJob[]>("/api/admin/supplier-products/imports");
export const createSupplierImport = (request: SupplierImportRequest) =>
  api<SupplierImportJob>("/api/admin/supplier-products/imports", {
    method: "POST",
    body: JSON.stringify(request),
  });
export const retrySupplierImport = (id: number) =>
  api<SupplierImportJob>(`/api/admin/supplier-products/imports/${id}/retry`, { method: "POST" });
