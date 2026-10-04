import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { fetchStoreProductSearchPage } from "@/shared/api/catalog";
import { SearchQuerySource } from "@/shared/api/searchQueries";
import { AppButton } from "@/shared/ui/AppButton";
import { AppSearchInput } from "@/shared/ui/AppField";
import { Category, Product } from "@/shared/types/models";
import {
  buildCatalogQuery,
  formatMoney,
  getCategorySearchIndex,
  normalizeText,
} from "./store-utils";
import "./StoreSearch.css";

const SEARCH_DEBOUNCE_MS = 300;
const SUGGESTIONS_LIMIT = 6;

type SearchSuggestion =
  | {
      type: "category";
      id: string;
      label: string;
      meta: string;
      href: string;
    }
  | {
      type: "product";
      id: string;
      label: string;
      meta: string;
      href: string;
    };

type ProductSearchSuggestion = Extract<SearchSuggestion, { type: "product" }> & {
  exactMatch: boolean;
};

export function StoreSearch({
  categories,
  value,
  onValueChange,
  className = "",
  placeholder = "Поиск",
  searchSource,
  onSearchCommitted,
}: {
  categories: Category[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  searchSource?: SearchQuerySource;
  onSearchCommitted?: (query: string) => void;
}) {
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [debouncedQuery, setDebouncedQuery] = useState(value.trim());

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(value.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [value]);

  const productsQuery = useQuery({
    queryKey: ["products", "store-search-suggestions", debouncedQuery],
    queryFn: () =>
      fetchStoreProductSearchPage({
        page: 1,
        size: SUGGESTIONS_LIMIT,
        search: debouncedQuery,
        active: true,
      }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  const suggestions = useMemo<SearchSuggestion[]>(() => {
    const query = normalizeText(debouncedQuery);
    if (query.length < 2) return [];

    const categoryMatches = categories
      .filter((category) => category.active !== false)
      .filter((category) => getCategorySearchIndex(category).includes(query))
      .slice(0, 3)
      .map((category) => ({
        type: "category" as const,
        id: `category-${category.id ?? category.slug}`,
        label: category.nameRu || category.nameKk,
        meta: "Категория",
        href: `/catalog?${buildCatalogQuery({
          query: "",
          category: category.slug,
          minPrice: "",
          maxPrice: "",
          inStock: false,
          sort: "popular",
          page: 1,
          size: 12,
        })}`,
      }));

    const productMatches: ProductSearchSuggestion[] = (productsQuery.data?.items ?? []).map(
      (product: Product) => ({
        type: "product",
        id: `product-${product.id ?? product.sku}`,
        label: product.nameRu || product.nameKk,
        meta: `Артикул: ${product.sku} • ${formatMoney(product.price)}`,
        href: `/product/${product.id}`,
        exactMatch:
          normalizeText(product.nameRu) === query ||
          normalizeText(product.nameKk) === query ||
          normalizeText(product.sku) === query,
      }),
    );
    const exactProducts = productMatches.filter((product) => product.exactMatch);
    const recommendedProducts = productMatches.filter((product) => !product.exactMatch);

    return [
      ...exactProducts.map(({ exactMatch: _, ...suggestion }) => suggestion),
      ...categoryMatches,
      ...recommendedProducts.map(({ exactMatch: _, ...suggestion }) => suggestion),
    ].slice(0, SUGGESTIONS_LIMIT);
  }, [categories, debouncedQuery, productsQuery.data]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) setActiveIndex(-1);
  }, [open]);

  function commitSearch(nextValue = value) {
    const query = nextValue.trim();
    if (query) onSearchCommitted?.(query);
    setOpen(false);
    const searchParams = new URLSearchParams(
      buildCatalogQuery({
        query,
        category: "",
        minPrice: "",
        maxPrice: "",
        inStock: false,
        sort: "popular",
        page: 1,
        size: 12,
      }),
    );
    if (searchSource) searchParams.set("searchSource", searchSource);
    navigate(`/catalog?${searchParams.toString()}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.min(current + 1, suggestions.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const activeSuggestion = suggestions[activeIndex];
      if (activeSuggestion) {
        if (value.trim()) onSearchCommitted?.(value.trim());
        navigate(activeSuggestion.href);
      } else commitSearch();
    }
  }

  const queryReady = value.trim().length >= 2;
  const loading = queryReady && (debouncedQuery !== value.trim() || productsQuery.isFetching);

  return (
    <div className={`store-search ${className}`} ref={rootRef}>
      <div className="store-search__field">
        <AppSearchInput
          ref={inputRef}
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={200}
          aria-label={placeholder}
        />
        {value && (
          <AppButton
            type="button"
            variant="ghost"
            className="store-search__clear"
            aria-label="Очистить поиск"
            onClick={() => {
              onValueChange("");
              inputRef.current?.focus();
              setOpen(true);
            }}
          >
            <X size={16} />
          </AppButton>
        )}
      </div>
      {open && queryReady && (
        <div className="store-search__panel" role="listbox" aria-label="Подсказки поиска">
          {loading ? (
            <div className="store-search__status">Подбираем подходящие товары…</div>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion, index) => (
              <Link
                key={suggestion.id}
                className={`store-search__item ${index === activeIndex ? "is-active" : ""}`}
                to={suggestion.href}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  if (value.trim()) onSearchCommitted?.(value.trim());
                  setOpen(false);
                }}
              >
                <b>{suggestion.label}</b>
                <span>{suggestion.meta}</span>
              </Link>
            ))
          ) : (
            <div className="store-search__empty">
              Ничего подходящего не найдено. Попробуйте другие слова или артикул.
            </div>
          )}
          <p className="store-search__hint">Можно с опечаткой, на русском или казахском.</p>
        </div>
      )}
    </div>
  );
}
