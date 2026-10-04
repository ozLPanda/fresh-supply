import { api } from "@/shared/api/http";
import { SalesAnalyticsData, SalesAnalyticsGroupBy } from "@/shared/types/models";

export type SalesAnalyticsFilters = {
  from: string;
  to: string;
  groupBy: SalesAnalyticsGroupBy;
  dimension?: "employees" | "products" | "categories";
  entityId?: number;
};

export function fetchSalesAnalytics(filters: SalesAnalyticsFilters) {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    groupBy: filters.groupBy,
  });
  if (filters.dimension && filters.entityId !== undefined) {
    params.set("dimension", filters.dimension);
    params.set("entityId", String(filters.entityId));
  }
  return api<SalesAnalyticsData>(`/api/admin/analytics/sales?${params}`);
}
