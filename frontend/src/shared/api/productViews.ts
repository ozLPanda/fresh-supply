import { api } from "@/shared/api/http";
import { PagedResult } from "@/shared/types/models";

export type ProductViewAnalyticsItem = {
  productId: number;
  sku: string;
  nameRu: string;
  categoryNameRu: string | null;
  views: number;
};

export type ProductViewAnalyticsGroupBy = "day" | "month" | "year";

export type ProductViewAnalyticsPoint = {
  period: string;
  views: number;
};

export type ProductViewAnalyticsHistory = {
  productId: number;
  points: ProductViewAnalyticsPoint[];
};

type ProductViewAnalyticsParams = {
  page?: number;
  size?: number;
  search?: string;
  sort?: "views" | "nameRu" | "sku";
  direction?: "asc" | "desc";
};

export function fetchProductViewAnalytics({
  page = 1,
  size = 20,
  search,
  sort = "views",
  direction = "desc",
}: ProductViewAnalyticsParams = {}) {
  const query = new URLSearchParams({
    page: String(page),
    size: String(size),
    sort,
    direction,
  });
  if (search?.trim()) query.set("search", search.trim());

  return api<PagedResult<ProductViewAnalyticsItem>>(`/api/products/view-analytics?${query}`);
}

export function fetchProductViewAnalyticsHistory(
  productId: number,
  groupBy: ProductViewAnalyticsGroupBy,
) {
  const query = new URLSearchParams({ groupBy });
  return api<ProductViewAnalyticsHistory>(`/api/products/${productId}/view-analytics?${query}`);
}
