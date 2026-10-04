import { api } from "@/shared/api/http";

export type SearchQuerySource = "HOME" | "CATALOG" | "CATEGORY";

export function recordSearchQuery(input: {
  query: string;
  source: SearchQuerySource;
  categorySlug?: string | null;
}) {
  return api<void>("/api/search-queries", {
    method: "POST",
    body: JSON.stringify(input),
  }).catch(() => undefined);
}
