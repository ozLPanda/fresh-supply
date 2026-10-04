import { api } from "@/shared/api/http";
import {
  reconcileCategoryImageCache,
  reconcileProductImageCache,
} from "@/shared/images/imageCache";
import { Category, PagedResult, Product, ProductCatalogAnalytics } from "@/shared/types/models";
import { normalizeProductSearchText, productSearchVariants } from "@/shared/lib/productSearch";

type QueryValue = string | number | boolean | null | undefined;

export type ProductPriceHistoryPeriod = "week" | "month" | "year" | "5years" | "all";

export type ProductPriceHistoryPoint = {
  changedAt: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
};

export type ProductPriceHistory = {
  period: ProductPriceHistoryPeriod;
  points: ProductPriceHistoryPoint[];
};

export type ProductActivityCategory = "PRODUCT_CHANGE" | "DOCUMENT" | "ORDER_FULFILLMENT";

export type ProductActivity = {
  id: string;
  category: ProductActivityCategory;
  type: string;
  action: string;
  description: string;
  changes?: { field: string; before: string; after: string }[];
  actorUserId?: number | null;
  actorName?: string | null;
  occurredAt: string;
  documentId?: string | null;
  documentNumber?: string | null;
  orderId?: string | null;
};

export type ProductActivityFilterOptions = {
  users: { id: number; name: string }[];
  types: { category: ProductActivityCategory; type: string; label: string }[];
};

function buildQuery(params: Record<string, QueryValue>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export async function fetchProductPage(params: Record<string, QueryValue>) {
  return api<PagedResult<Product>>(`/api/products${buildQuery(params)}`);
}

export async function fetchStoreProductPage(params: Record<string, QueryValue>) {
  const result = await fetchProductPage({ ...params, active: true });
  reconcileProductImageCache(result.items);
  return result;
}

export async function fetchStoreProduct(productId: string | number) {
  const product = await api<Product>(`/api/products/${productId}/storefront`);
  reconcileProductImageCache([product]);
  return product;
}

export async function fetchProductCatalogAnalytics(params: Record<string, QueryValue>) {
  return api<ProductCatalogAnalytics>(`/api/products/analytics${buildQuery(params)}`);
}

function normalizeExactSearchValue(value: string | null | undefined) {
  return normalizeProductSearchText(value).replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function productSearchId(product: Product) {
  return String(product.id ?? product.sku);
}

function isExactProductSearchMatch(product: Product, rawQuery: string) {
  const exactValues = new Set([
    normalizeExactSearchValue(product.nameRu),
    normalizeExactSearchValue(product.nameKk),
    normalizeExactSearchValue(product.sku),
  ]);
  return productSearchVariants(rawQuery)
    .map((variant) => normalizeExactSearchValue(variant))
    .some((variant) => exactValues.has(variant));
}

function withExactProductsFirst(result: PagedResult<Product>, exactProducts: Product[]) {
  const exactIds = new Set(exactProducts.map(productSearchId));
  return {
    ...result,
    items: [
      ...exactProducts,
      ...result.items.filter((product) => !exactIds.has(productSearchId(product))),
    ].slice(0, result.size),
  };
}

/**
 * Keeps AI recommendations while guaranteeing that an exact product name or article is first.
 */
export async function fetchStoreProductSearchPage(params: Record<string, QueryValue>) {
  const result = await fetchStoreProductPage(params);
  const rawQuery = typeof params.search === "string" ? params.search : "";
  const query = normalizeExactSearchValue(rawQuery);
  const page = typeof params.page === "number" ? params.page : Number(params.page ?? 1);

  if (!query || page !== 1) return result;

  const exactSemanticProducts = result.items.filter((product) =>
    isExactProductSearchMatch(product, rawQuery),
  );
  if (exactSemanticProducts.length > 0) {
    return withExactProductsFirst(result, exactSemanticProducts);
  }

  const lexicalResult = await fetchStoreProductPage({
    ...params,
    page: 1,
    size: 200,
    lexicalOnly: true,
  });
  const exactProducts = lexicalResult.items.filter((product) =>
    isExactProductSearchMatch(product, rawQuery),
  );

  if (exactProducts.length === 0) return result;
  return withExactProductsFirst(result, exactProducts);
}

export async function fetchCategoryPage(params: Record<string, QueryValue>) {
  return api<PagedResult<Category>>(`/api/categories${buildQuery(params)}`);
}

export async function fetchStoreCategoryPage(params: Record<string, QueryValue>) {
  const result = await fetchCategoryPage(params);
  reconcileCategoryImageCache(result.items);
  return result;
}

export async function fetchStoreCategoryTree() {
  const categories = await api<Category[]>("/api/categories/tree");
  reconcileCategoryImageCache(categories);
  return categories;
}

export async function fetchCategoryCounts() {
  return api<Record<string, number>>("/api/products/category-counts");
}

export function fetchProductPriceHistory(productId: number, period: ProductPriceHistoryPeriod) {
  return api<ProductPriceHistory>(
    `/api/products/${productId}/price-history${buildQuery({ period })}`,
  );
}

export function fetchProductActivity(productId: number, params: Record<string, QueryValue>) {
  return api<PagedResult<ProductActivity>>(
    `/api/admin/products/${productId}/activity${buildQuery(params)}`,
  );
}

export function fetchProductActivityFilterOptions(productId: number) {
  return api<ProductActivityFilterOptions>(
    `/api/admin/products/${productId}/activity/filter-options`,
  );
}

async function fetchAllPages<T>(
  fetchPage: (params: Record<string, QueryValue>) => Promise<PagedResult<T>>,
  params: Record<string, QueryValue>,
  size = 200,
) {
  const firstPage = await fetchPage({ ...params, page: 1, size });
  if (firstPage.totalPages <= 1) return firstPage.items;

  const items = [...firstPage.items];
  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    const nextPage = await fetchPage({ ...params, page, size });
    items.push(...nextPage.items);
  }
  return items;
}

export function fetchAllProducts(params: Record<string, QueryValue> = {}) {
  return fetchAllPages(fetchProductPage, params);
}

export function fetchAllStoreProducts(params: Record<string, QueryValue> = {}) {
  return fetchAllPages(fetchStoreProductPage, params);
}

export function fetchAllCategories(params: Record<string, QueryValue> = {}) {
  return fetchAllPages(fetchCategoryPage, params);
}
