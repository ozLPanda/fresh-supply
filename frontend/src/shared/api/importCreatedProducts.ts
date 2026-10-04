import { api } from "@/shared/api/http";
import type { PagedResult } from "@/shared/types/models";

type QueryValue = string | number | boolean | null | undefined;

export type ImportCreatedProduct = {
  id: number;
  sku: string;
  nameRu: string;
  price: number;
  wholesalePrice: number | null;
  bulkWholesalePrice: number | null;
  skoPrice: number | null;
  active: boolean;
  categoryId: number | null;
  categoryName: string | null;
  importId: string;
  importFileName: string | null;
  importedAt: string;
};

export type ImportCreatedProductImport = {
  importId: string;
  fileName: string;
  completedAt: string;
  createdCount: number;
};

export type ImportCreatedProductActivationSkip = {
  productId: number;
  sku: string;
  nameRu: string;
  reasons: string[];
};

export type ImportCreatedProductActivationAnalysis = {
  totalDrafts: number;
  readyToActivate: number;
  excludedNameTerms: string[];
  skippedProducts: ImportCreatedProductActivationSkip[];
};

export type ImportCreatedProductActivationResult = {
  activatedProducts: number;
  skippedProducts: ImportCreatedProductActivationSkip[];
};

export type ImportCreatedProductParams = {
  page?: number;
  size?: number;
  search?: string;
  importId?: string;
  active?: boolean;
  sort?: string;
  direction?: "asc" | "desc";
};

function queryString(params: Record<string, QueryValue>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export function fetchImportCreatedProducts(params: ImportCreatedProductParams = {}) {
  return api<PagedResult<ImportCreatedProduct>>(
    `/api/admin/import-created-products${queryString({
      page: params.page ?? 1,
      size: params.size ?? 20,
      search: params.search?.trim(),
      importId: params.importId,
      active: params.active,
      sort: params.sort,
      direction: params.direction,
    })}`,
  );
}

export function fetchImportCreatedProductImports() {
  return api<ImportCreatedProductImport[]>("/api/admin/import-created-products/imports");
}

export function analyzeImportCreatedProductDrafts() {
  return api<ImportCreatedProductActivationAnalysis>(
    "/api/admin/import-created-products/drafts/activation-analysis",
    { method: "POST" },
  );
}

export function activateEligibleImportCreatedProductDrafts() {
  return api<ImportCreatedProductActivationResult>(
    "/api/admin/import-created-products/drafts/activate",
    { method: "POST" },
  );
}
