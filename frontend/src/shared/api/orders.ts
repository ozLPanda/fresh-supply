import { api } from "@/shared/api/http";
import type { ActivityChange } from "@/shared/components/activity/ActivityChanges";
import type { PagedResult } from "@/shared/types/models";

type QueryValue = string | number | boolean | null | undefined;

export type OrderActivityCategory = "ORDER_CHANGE" | "FULFILLMENT" | "PAYMENT";

export type OrderActivity = {
  id: string;
  category: OrderActivityCategory;
  action: string;
  description: string;
  changes: ActivityChange[];
  actorUserId?: number | null;
  actorName?: string | null;
  occurredAt: string;
};

export type OrderActivityFilterOptions = {
  users: { id: number; name: string }[];
  actions: { category: OrderActivityCategory; value: string; label: string }[];
};

function buildQuery(params: Record<string, QueryValue>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export function fetchOrderActivity(orderId: string, params: Record<string, QueryValue>) {
  return api<PagedResult<OrderActivity>>(
    `/api/admin/orders/${orderId}/activity${buildQuery(params)}`,
  );
}

export function fetchOrderActivityFilterOptions(orderId: string) {
  return api<OrderActivityFilterOptions>(`/api/admin/orders/${orderId}/activity/filter-options`);
}
