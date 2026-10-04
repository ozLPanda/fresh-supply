import { api } from "@/shared/api/http";
import type { PagedResult } from "@/shared/types/models";

export type PriceType = "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO" | "GSKO" | "INCOMING";
export type PriceStatisticsScope = "SALES" | "INCOMING";
export type PriceStatisticsSource = "IMPORT" | "WAREHOUSE_PRICE_SETTING";

export type PriceStatisticImportSummary = {
  importId: string;
  startedAt: string;
  completedAt: string;
  fileNames: string[];
  createdByNames: string[];
  importCount: number;
  changedProducts: number;
  changedPricePoints: number;
  averageChangePercent: number | null;
  priceTypes: PriceStatisticPriceTypeSummary[];
  source: PriceStatisticsSource;
  sourceName: string;
};

export type PriceStatisticPriceTypeSummary = {
  priceType: PriceType;
  changedProducts: number;
  changedPricePoints: number;
  averageChangePercent: number | null;
};

export type PriceStatisticImportDetail = {
  summary: PriceStatisticImportSummary;
};

export type PriceStatisticCategory = {
  categoryId: number | null;
  categoryName: string;
  changedProducts: number;
  changedPricePoints: number;
  averageChangePercent: number | null;
};

export type ProductPriceChange = {
  priceType: PriceType;
  oldPrice: number | null;
  newPrice: number | null;
  changePercent: number | null;
};

export type PriceStatisticProduct = {
  productId: number | null;
  sku: string;
  productName: string;
  categoryId: number | null;
  categoryName: string | null;
  changedPricePoints: number;
  averageChangePercent: number | null;
  changes: ProductPriceChange[];
};

export type PriceStatisticProductParams = {
  page?: number;
  size?: number;
  categoryId?: number | null;
  query?: string;
  scope?: PriceStatisticsScope;
};

export type PriceStatisticProductTrend = {
  productId: number | null;
  sku: string;
  productName: string;
  categoryId: number | null;
  categoryName: string;
  startPrice: number;
  currentPrice: number;
  netChangePercent: number;
  updateCount: number;
  increaseCount: number;
  decreaseCount: number;
  averageAbsoluteChangePercent: number;
  maximumAbsoluteChangePercent: number;
};

export type PriceStatisticCategoryTrend = {
  categoryId: number | null;
  categoryName: string;
  productCount: number;
  increasedProducts: number;
  decreasedProducts: number;
  updateCount: number;
  averageNetChangePercent: number;
  averageVolatilityPercent: number;
  maximumVolatilityPercent: number;
};

export type PriceStatisticPeriodAnalytics = {
  priceType: PriceType;
  period: "week" | "month" | "year" | "5years" | "all";
  changedProducts: number;
  increasedProducts: number;
  decreasedProducts: number;
  unstableProducts: number;
  averageNetChangePercent: number | null;
  products: PriceStatisticProductTrend[];
  categories: PriceStatisticCategoryTrend[];
};

export type PriceStatisticProductTrendHistory = {
  productId: number;
  sku: string;
  productName: string;
  priceType: PriceType;
  period: PriceStatisticPeriodAnalytics["period"];
  points: Array<{
    changedAt: string;
    oldPrice: number | null;
    newPrice: number | null;
    changePercent: number | null;
    source: PriceStatisticsSource;
    sourceName: string;
  }>;
};

function queryString(params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") {
      searchParams.set(key, String(value));
    }
  });
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function importPath(importId: string, suffix = "") {
  return `/api/admin/price-statistics/imports/${encodeURIComponent(importId)}${suffix}`;
}

export function fetchPriceStatisticImports(page = 1, size = 100) {
  return api<PagedResult<PriceStatisticImportSummary>>(
    `/api/admin/price-statistics/imports${queryString({ page, size })}`,
  );
}

export function fetchPriceStatisticImport(importId: string) {
  return api<PriceStatisticImportDetail>(importPath(importId));
}

export function fetchPriceStatisticCategories(importId: string, scope: PriceStatisticsScope) {
  return api<PriceStatisticCategory[]>(
    `${importPath(importId, "/categories")}${queryString({ scope })}`,
  );
}

export function fetchPriceStatisticProducts(
  importId: string,
  params: PriceStatisticProductParams = {},
) {
  return api<PagedResult<PriceStatisticProduct>>(
    `${importPath(importId, "/products")}${queryString({
      page: params.page ?? 1,
      size: params.size ?? 200,
      categoryId: params.categoryId,
      query: params.query?.trim(),
      scope: params.scope ?? "SALES",
    })}`,
  );
}

export function fetchPriceStatisticPeriodAnalytics(
  priceType: PriceType,
  period: PriceStatisticPeriodAnalytics["period"],
) {
  return api<PriceStatisticPeriodAnalytics>(
    `/api/admin/price-statistics/analytics${queryString({ priceType, period })}`,
  );
}

export function fetchPriceStatisticProductTrendHistory(
  productId: number,
  priceType: PriceType,
  period: PriceStatisticPeriodAnalytics["period"],
) {
  return api<PriceStatisticProductTrendHistory>(
    `/api/admin/price-statistics/analytics/products/${productId}/history${queryString({ priceType, period })}`,
  );
}
