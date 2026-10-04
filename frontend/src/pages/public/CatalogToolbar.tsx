import { SlidersHorizontal } from "lucide-react";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppSelect } from "@/shared/ui/AppField";
import { CatalogSort } from "./store-utils";
import "./CatalogToolbar.css";

export type CatalogToolbarValue = {
  query: string;
  totalItems: number;
  page: number;
  totalPages: number;
  sort: CatalogSort;
  onSortChange: (sort: CatalogSort) => void;
  onOpenFilters: () => void;
};

export function CatalogToolbar({
  query,
  totalItems,
  page,
  totalPages,
  sort,
  onSortChange,
  onOpenFilters,
}: CatalogToolbarValue) {
  const compactQuery = query.length > 80 ? `${query.slice(0, 77)}…` : query;

  return (
    <section className="catalog-toolbar">
      <div className="catalog-toolbar__heading">
        <div>
          <p>Каталог</p>
          <h1 title={query || undefined}>
            {query ? `Результаты по запросу «${compactQuery}»` : "Каталог продуктов"}
          </h1>
        </div>
        <AppBadge tone="slate">
          {totalItems} {totalItems === 1 ? "товар" : "товаров"}
        </AppBadge>
      </div>

      <div className="catalog-toolbar__controls">
        <div className="catalog-toolbar__sort">
          <AppSelect
            label="Сортировка"
            options={[
              { value: "popular", label: "Популярные" },
              { value: "price-asc", label: "Сначала дешевле" },
              { value: "price-desc", label: "Сначала дороже" },
              { value: "newest", label: "Новинки" },
              { value: "name", label: "По названию" },
            ]}
            value={sort}
            onValueChange={(value) => onSortChange(value as CatalogSort)}
          />
        </div>
        <div className="catalog-toolbar__summary">
          <span>
            Страница <b>{page}</b> из <b>{totalPages}</b>
          </span>
          <AppButton
            type="button"
            variant="secondary"
            className="catalog-toolbar__filters"
            onClick={onOpenFilters}
          >
            <SlidersHorizontal size={17} />
            Фильтры
          </AppButton>
        </div>
      </div>
    </section>
  );
}
