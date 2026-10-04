import { AppCheckbox } from "@/shared/ui/AppControls";
import { AppInput, AppSelect } from "@/shared/ui/AppField";
import { Category } from "@/shared/types/models";
import { flattenCategories } from "./store-utils";
import "./CatalogFilters.css";

export type CatalogFilterValue = {
  query: string;
  category: string;
  minPrice: string;
  maxPrice: string;
  inStock: boolean;
};

export function CatalogFilters({
  categories,
  categoryCounts,
  value,
  onChange,
}: {
  categories: Category[];
  categoryCounts: Record<string, number>;
  value: CatalogFilterValue;
  onChange: (next: CatalogFilterValue) => void;
}) {
  const flatCategories = flattenCategories(categories);

  return (
    <aside className="catalog-filters">
      <div className="catalog-filters__head">
        <div>
          <p>Фильтры</p>
          <h2>Подбор каталога</h2>
        </div>
      </div>

      <div className="catalog-filters__group">
        <AppSelect
          label="Категория"
          hint="Выберите раздел каталога — количество товаров указано рядом."
          options={[
            { value: "", label: "Все категории" },
            ...flatCategories.map((category) => ({
              value: category.slug,
              label: `${category.nameRu} (${categoryCounts[String(category.id ?? category.slug)] ?? 0})`,
            })),
          ]}
          value={value.category}
          onValueChange={(next) => onChange({ ...value, category: String(next) })}
        />
      </div>

      <div className="catalog-filters__group">
        <span className="catalog-filters__label">Цена</span>
        <div className="catalog-filters__price">
          <AppInput
            type="number"
            inputMode="numeric"
            label="От"
            value={value.minPrice}
            onChange={(event) => onChange({ ...value, minPrice: event.target.value })}
          />
          <AppInput
            type="number"
            inputMode="numeric"
            label="До"
            value={value.maxPrice}
            onChange={(event) => onChange({ ...value, maxPrice: event.target.value })}
          />
        </div>
      </div>

      <div className="catalog-filters__group">
        <AppCheckbox
          label="Только в наличии"
          description="Показывать только товары, доступные к заказу"
          checked={value.inStock}
          onCheckedChange={(checked) => onChange({ ...value, inStock: checked })}
        />
      </div>
    </aside>
  );
}
