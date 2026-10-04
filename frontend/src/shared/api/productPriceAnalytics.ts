import { api } from "@/shared/api/http";
import { PagedResult } from "@/shared/types/models";

export type ProductPriceLevel = {
  type: "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO";
  price: number | null;
  markupPercent: number | null;
  belowIncoming: boolean;
};

export type ProductPriceAnalytics = {
  id: number;
  sku: string;
  nameRu: string;
  categoryNameRu: string | null;
  active: boolean;
  incomingPrice: number | null;
  priceLevels: ProductPriceLevel[];
  hasPriceBelowIncoming: boolean;
};

export type ProductPriceLevelSummary = {
  type: ProductPriceLevel["type"];
  productCount: number;
  averageMarkupPercent: number | null;
  minimumMarkupPercent: number | null;
  maximumMarkupPercent: number | null;
};

export type ProductPriceAnalyticsCategory = {
  categoryId: number | null;
  categoryNameRu: string;
  productCount: number;
  priceLevels: ProductPriceLevelSummary[];
};

type ProductPriceAnalyticsParams = {
  page?: number;
  size?: number;
  search?: string;
  categoryId?: number;
  minMarkupPercent?: number;
  maxMarkupPercent?: number;
  priceTypes?: ProductPriceLevel["type"][];
  matchAllPriceTypes?: boolean;
};

export function fetchProductPriceAnalytics({
  page = 1,
  size = 20,
  search,
  categoryId,
  minMarkupPercent,
  maxMarkupPercent,
  priceTypes,
  matchAllPriceTypes,
}: ProductPriceAnalyticsParams = {}) {
  const query = new URLSearchParams({ page: String(page), size: String(size) });
  if (search?.trim()) query.set("search", search.trim());
  if (categoryId) query.set("categoryId", String(categoryId));
  if (minMarkupPercent !== undefined) query.set("minMarkupPercent", String(minMarkupPercent));
  if (maxMarkupPercent !== undefined) query.set("maxMarkupPercent", String(maxMarkupPercent));
  priceTypes?.forEach((type) => query.append("priceType", type));
  if (matchAllPriceTypes) query.set("matchAllPriceTypes", "true");
  return api<PagedResult<ProductPriceAnalytics>>(`/api/products/price-analytics?${query}`);
}

export function fetchProductPriceAnalyticsCategories() {
  return api<ProductPriceAnalyticsCategory[]>("/api/products/price-analytics/categories");
}
