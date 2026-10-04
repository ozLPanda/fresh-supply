import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
  fetchCategoryCounts,
  fetchStoreCategoryTree,
  fetchStoreProductSearchPage,
} from "@/shared/api/catalog";
import { recordSearchQuery } from "@/shared/api/searchQueries";
import { StoreLayout } from "@/layouts/StoreLayout";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppCard } from "@/shared/ui/AppCard";
import { AppButton } from "@/shared/ui/AppButton";
import { ActiveFilterTags } from "@/pages/public/ActiveFilterTags";
import { CatalogFilters } from "@/pages/public/CatalogFilters";
import { CatalogToolbar } from "@/pages/public/CatalogToolbar";
import { Pagination } from "@/pages/public/Pagination";
import { ProductGrid } from "@/pages/public/ProductGrid";
import { StoreEmptyState } from "@/pages/public/StoreEmptyState";
import { StoreSearch } from "@/pages/public/StoreSearch";
import { SeoMeta } from "@/shared/seo/SeoMeta";
import {
  type CatalogFiltersState,
  buildCatalogQuery,
  flattenCategories,
  parseCatalogFilters,
} from "@/pages/public/store-utils";
import "./CatalogPage.css";

const DEFAULT_FILTERS: CatalogFiltersState = {
  query: "",
  category: "",
  minPrice: "",
  maxPrice: "",
  inStock: false,
  sort: "popular",
  page: 1,
  size: 12,
};
const SEARCH_DEBOUNCE_MS = 350;

function mapCatalogSort(sort: CatalogFiltersState["sort"]) {
  switch (sort) {
    case "price-asc":
      return { sort: "price", direction: "asc" } as const;
    case "price-desc":
      return { sort: "price", direction: "desc" } as const;
    case "name":
      return { sort: "nameRu", direction: "asc" } as const;
    case "newest":
      return { sort: "createdAt", direction: "desc" } as const;
    case "popular":
    default:
      return { sort: "popular", direction: "asc" } as const;
  }
}

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const filters = useMemo(() => parseCatalogFilters(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(filters.query);
  const searchDraftRef = useRef(searchDraft);
  const lastLoggedSearch = useRef("");
  const searchOrigin = searchParams.get("searchSource") === "HOME" ? "HOME" : "CATALOG";
  const sortParams = mapCatalogSort(filters.sort);

  const productsQuery = useQuery({
    queryKey: ["products", "catalog", filters],
    queryFn: () =>
      fetchStoreProductSearchPage({
        page: filters.page,
        size: filters.size,
        search: filters.query || undefined,
        category: filters.category || undefined,
        minPrice: filters.minPrice || undefined,
        maxPrice: filters.maxPrice || undefined,
        inStock: filters.inStock || undefined,
        sort: sortParams.sort,
        direction: sortParams.direction,
      }),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", "tree"],
    queryFn: fetchStoreCategoryTree,
  });
  const categoryCountsQuery = useQuery({
    queryKey: ["products", "category-counts"],
    queryFn: () => fetchCategoryCounts(),
  });

  const categories = categoriesQuery.data ?? [];
  const flatCategories = useMemo(() => flattenCategories(categories), [categories]);
  const products = productsQuery.data?.items ?? [];
  const pagination = productsQuery.data;
  const productCounts = categoryCountsQuery.data ?? {};

  useEffect(() => {
    if (!pagination || filters.page === pagination.page) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (pagination.page > 1) next.set("page", String(pagination.page));
        else next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [filters.page, pagination, setSearchParams]);

  function updateFilters(next: CatalogFiltersState, resetPage = true) {
    const query = buildCatalogQuery({ ...next, page: resetPage ? 1 : next.page });
    setSearchParams(query, { replace: true });
  }

  function resetFilters() {
    setSearchParams(buildCatalogQuery(DEFAULT_FILTERS), { replace: true });
  }

  useEffect(() => {
    searchDraftRef.current = searchDraft;
  }, [searchDraft]);

  useEffect(() => {
    // A debounced search deliberately strips only outer whitespace before writing the URL.
    // Do not feed that normalized value back into the input while it is being edited:
    // otherwise a pause after a space makes the next word join the previous one.
    if (filters.query === searchDraftRef.current.trim()) return;
    setSearchDraft(filters.query);
  }, [filters.query]);

  useEffect(() => {
    const query = filters.query.trim();
    if (!query) {
      lastLoggedSearch.current = "";
      return;
    }

    const searchKey = `${searchOrigin}:${filters.category}:${query}`;
    if (lastLoggedSearch.current === searchKey) return;
    lastLoggedSearch.current = searchKey;
    if (searchOrigin === "HOME") return;
    void recordSearchQuery({
      query,
      source: "CATALOG",
      categorySlug: filters.category || null,
    });
  }, [filters.category, filters.query, searchOrigin]);

  useEffect(() => {
    const query = searchDraft.trim();
    if (query === filters.query) return;
    const timeout = window.setTimeout(
      () => updateFilters({ ...filters, query }),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [filters, searchDraft]);

  useEffect(() => {
    if (!mobileFiltersOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileFiltersOpen(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileFiltersOpen]);

  const activeTags = [
    filters.query && {
      id: "query",
      label: `Поиск: ${filters.query}`,
      onRemove: () => updateFilters({ ...filters, query: "" }),
    },
    filters.category && {
      id: "category",
      label: `Категория: ${flatCategories.find((category) => category.slug === filters.category)?.nameRu ?? "Категория"}`,
      onRemove: () => updateFilters({ ...filters, category: "" }),
    },
    filters.minPrice && {
      id: "minPrice",
      label: `От ${filters.minPrice}`,
      onRemove: () => updateFilters({ ...filters, minPrice: "" }),
    },
    filters.maxPrice && {
      id: "maxPrice",
      label: `До ${filters.maxPrice}`,
      onRemove: () => updateFilters({ ...filters, maxPrice: "" }),
    },
    filters.inStock && {
      id: "inStock",
      label: "В наличии",
      onRemove: () => updateFilters({ ...filters, inStock: false }),
    },
  ].filter(Boolean) as Array<{ id: string; label: string; onRemove: () => void }>;

  const canonicalPath = `/catalog${filters.page > 1 ? `?page=${filters.page}` : ""}`;
  const filtered = activeTags.length > 0 || filters.sort !== "popular" || filters.size !== 12;

  return (
    <StoreLayout categories={categories}>
      <SeoMeta
        title={`Каталог товаров для отопления и сантехники${filters.page > 1 ? ` — страница ${filters.page}` : ""} | Фирма «Актив»`}
        description="Каталог товаров для отопления, водоснабжения и сантехники. Выбирайте оборудование и комплектующие по названию, артикулу и категории."
        canonicalPath={canonicalPath}
        robots={filtered || productsQuery.isError ? "noindex,follow" : "index,follow"}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Каталог отопительного оборудования и сантехники",
          description:
            "Каталог отопительного оборудования, водоснабжения и сантехники в Павлодаре.",
          url: `${window.location.origin}${canonicalPath}`,
        }}
      />
      <section className="catalog-page">
        <div className="catalog-page__top">
          <CatalogToolbar
            query={filters.query}
            totalItems={pagination?.totalItems ?? 0}
            page={pagination?.page ?? filters.page}
            totalPages={pagination?.totalPages ?? 1}
            sort={filters.sort}
            onSortChange={(sort) => updateFilters({ ...filters, sort }, false)}
            onOpenFilters={() => setMobileFiltersOpen(true)}
          />
          <StoreSearch
            categories={categories}
            value={searchDraft}
            onValueChange={setSearchDraft}
            placeholder="Поиск"
            searchSource="CATALOG"
          />
        </div>

        <div className="catalog-page__active-tags" aria-live="polite">
          {activeTags.length > 0 ? (
            <ActiveFilterTags tags={activeTags} onReset={resetFilters} />
          ) : null}
        </div>

        <div className="catalog-page__content">
          <aside className="catalog-page__sidebar">
            {categoriesQuery.isLoading ? (
              <AppCard>
                <AppSkeleton />
              </AppCard>
            ) : (
              <CatalogFilters
                categories={categories}
                categoryCounts={productCounts}
                value={filters}
                onChange={(next) => updateFilters({ ...filters, ...next })}
              />
            )}
          </aside>

          <section className="catalog-page__results">
            {productsQuery.isLoading ? (
              <div className="catalog-page__loading">
                {Array.from({ length: 6 }, (_, index) => (
                  <AppCard key={index}>
                    <AppSkeleton />
                  </AppCard>
                ))}
              </div>
            ) : productsQuery.isError ? (
              <AppAlert
                title="Ошибка загрузки"
                tone="danger"
                onRetry={() => productsQuery.refetch()}
              >
                Не удалось получить товары. Проверьте API и повторите загрузку страницы.
              </AppAlert>
            ) : products.length > 0 && pagination ? (
              <>
                <ProductGrid products={products} />
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={(nextPage) => updateFilters({ ...filters, page: nextPage }, false)}
                />
              </>
            ) : (
              <StoreEmptyState
                title="Ничего не найдено"
                description="Попробуйте изменить фильтры, цену или поисковый запрос."
                actionLabel="Сбросить фильтры"
                onAction={resetFilters}
              />
            )}
          </section>
        </div>
      </section>

      {mobileFiltersOpen && (
        <div
          className="catalog-mobile-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Фильтры каталога"
        >
          <div
            className="catalog-mobile-sheet__backdrop"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="catalog-mobile-sheet__panel">
            <div className="catalog-mobile-sheet__head">
              <h2>Фильтры</h2>
              <AppButton
                type="button"
                variant="ghost"
                aria-label="Закрыть фильтры"
                onClick={() => setMobileFiltersOpen(false)}
              >
                <X size={19} />
              </AppButton>
            </div>
            <div className="catalog-mobile-sheet__body">
              <CatalogFilters
                categories={categories}
                categoryCounts={productCounts}
                value={filters}
                onChange={(next) => updateFilters({ ...filters, ...next })}
              />
            </div>
            <div className="catalog-mobile-sheet__footer">
              <AppButton
                type="button"
                variant="ghost"
                className="catalog-mobile-sheet__reset"
                aria-label="Сбросить фильтры"
                onClick={resetFilters}
              >
                Сбросить
              </AppButton>
              <AppButton
                type="button"
                className="catalog-mobile-sheet__apply"
                aria-label="Показать товары"
                onClick={() => setMobileFiltersOpen(false)}
              >
                Показать
              </AppButton>
            </div>
          </div>
        </div>
      )}
    </StoreLayout>
  );
}
