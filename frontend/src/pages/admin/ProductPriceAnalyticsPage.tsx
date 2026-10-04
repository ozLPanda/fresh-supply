import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Edit,
  FileSpreadsheet,
  FolderTree,
  Package,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import { PriceStatisticsContent } from "@/pages/admin/PriceStatisticsPage";
import {
  fetchProductPriceAnalytics,
  fetchProductPriceAnalyticsCategories,
  type ProductPriceAnalytics,
  type ProductPriceAnalyticsCategory,
  type ProductPriceLevel,
  type ProductPriceLevelSummary,
} from "@/shared/api/productPriceAnalytics";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import {
  AppDataTable,
  type AppDataTableColumn,
  type AppDataTableFilterValues,
} from "@/shared/ui/AppDataTable";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { AppNumberInput, AppSelect } from "@/shared/ui/AppField";
import { AppTabs } from "@/shared/ui/AppControls";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./ProductPriceAnalyticsPage.css";

const moneyFormat = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 });

const priceTypes: Array<{ type: ProductPriceLevel["type"]; label: string }> = [
  { type: "RETAIL", label: "Розница" },
  { type: "WHOLESALE", label: "Опт" },
  { type: "BULK_WHOLESALE", label: "Крупный опт" },
  { type: "SKO", label: "СКО" },
];

type AnalyticsView = "current" | "changes";

function analyticsViewFromTab(tab: string | null): AnalyticsView {
  return tab === "changes" || tab === "sales-history" || tab === "incoming-history"
    ? "changes"
    : "current";
}

function formatMoney(value: number | null) {
  return value === null ? "—" : `${moneyFormat.format(value)} ₸`;
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${percentFormat.format(value)}%`;
}

function productWord(value: number) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "товаров";
  if (last === 1) return "товар";
  if (last >= 2 && last <= 4) return "товара";
  return "товаров";
}

function priceTypeWord(value: number) {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "типов";
  if (last === 1) return "тип";
  if (last >= 2 && last <= 4) return "типа";
  return "типов";
}

function priceLevel(row: ProductPriceAnalytics, type: ProductPriceLevel["type"]) {
  return row.priceLevels.find((level) => level.type === type);
}

function PriceLevelCell({ level }: { level?: ProductPriceLevel }) {
  if (!level || level.price === null) {
    return <span className="product-price-analytics__empty">—</span>;
  }
  const percent = level.markupPercent;
  const tone = level.belowIncoming ? "red" : percent !== null && percent > 0 ? "green" : "slate";
  return (
    <div className="product-price-analytics__price-level">
      <strong>{formatMoney(level.price)}</strong>
      <AppBadge tone={tone}>
        {percent !== null && percent > 0 ? <ArrowUpRight size={13} /> : null}
        {level.belowIncoming ? <ArrowDownRight size={13} /> : null}
        {percent === null
          ? "Нет базы"
          : `${percent > 0 ? "+" : ""}${percentFormat.format(percent)}%`}
      </AppBadge>
    </div>
  );
}

function PriceLevelSummaryCell({ summary }: { summary?: ProductPriceLevelSummary }) {
  if (!summary || summary.productCount === 0) {
    return <span className="product-price-analytics__empty">—</span>;
  }
  const tone =
    summary.averageMarkupPercent !== null && summary.averageMarkupPercent < 0 ? "red" : "green";
  return (
    <div className="product-price-analytics__price-summary">
      <AppBadge tone={tone}>Средняя {formatPercent(summary.averageMarkupPercent)}</AppBadge>
      <span>
        Мин. {formatPercent(summary.minimumMarkupPercent)} · Макс.{" "}
        {formatPercent(summary.maximumMarkupPercent)}
      </span>
      <small>{summary.productCount} товаров</small>
    </div>
  );
}

function categoryPriceLevel(row: ProductPriceAnalyticsCategory, type: ProductPriceLevel["type"]) {
  return row.priceLevels.find((level) => level.type === type);
}

export function ProductPriceAnalyticsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filterValues, setFilterValues] = useState<AppDataTableFilterValues>({});
  const [minMarkupPercent, setMinMarkupPercent] = useState("");
  const [maxMarkupPercent, setMaxMarkupPercent] = useState("");
  const [selectedPriceTypes, setSelectedPriceTypes] = useState<ProductPriceLevel["type"][]>(
    priceTypes.map(({ type }) => type),
  );
  const [priceTypeMatch, setPriceTypeMatch] = useState<"any" | "all">("any");
  const analyticsView = analyticsViewFromTab(searchParams.get("tab"));
  const [currentPriceView, setCurrentPriceView] = useState<"products" | "categories">("products");
  const deferredSearch = useDeferredValue(search.trim());
  const categoryId = Number(filterValues.category?.[0]) || undefined;
  const parsedMinMarkupPercent = minMarkupPercent === "" ? undefined : Number(minMarkupPercent);
  const parsedMaxMarkupPercent = maxMarkupPercent === "" ? undefined : Number(maxMarkupPercent);
  const activePriceTypes = selectedPriceTypes;
  const hasInvalidPercentRange =
    parsedMinMarkupPercent !== undefined &&
    parsedMaxMarkupPercent !== undefined &&
    parsedMinMarkupPercent > parsedMaxMarkupPercent;

  const productsQuery = useQuery({
    queryKey: [
      "products",
      "price-analytics",
      page,
      pageSize,
      deferredSearch,
      categoryId,
      parsedMinMarkupPercent,
      parsedMaxMarkupPercent,
      activePriceTypes,
      priceTypeMatch,
    ],
    queryFn: () =>
      fetchProductPriceAnalytics({
        page,
        size: pageSize,
        search: deferredSearch,
        categoryId,
        minMarkupPercent: parsedMinMarkupPercent,
        maxMarkupPercent: parsedMaxMarkupPercent,
        priceTypes: activePriceTypes,
        matchAllPriceTypes: priceTypeMatch === "all",
      }),
    enabled: !hasInvalidPercentRange && activePriceTypes.length > 0,
  });
  const categoryAnalyticsQuery = useQuery({
    queryKey: ["products", "price-analytics", "categories"],
    queryFn: () => fetchProductPriceAnalyticsCategories(),
  });
  const belowIncomingQuery = useQuery({
    queryKey: ["products", "price-analytics", "below-incoming"],
    queryFn: () =>
      fetchProductPriceAnalytics({
        page: 1,
        size: 1,
        maxMarkupPercent: -0.01,
        priceTypes: priceTypes.map(({ type }) => type),
      }),
  });

  const categoryOptions = useMemo(
    () =>
      (categoryAnalyticsQuery.data ?? [])
        .filter((category) => category.categoryId !== null)
        .map((category) => ({
          value: String(category.categoryId),
          label: category.categoryNameRu,
        })),
    [categoryAnalyticsQuery.data],
  );

  const columns: AppDataTableColumn<ProductPriceAnalytics>[] = [
    {
      id: "sku",
      header: "Артикул",
      accessor: "sku",
      width: 120,
      cell: (row) => <code>{row.sku}</code>,
    },
    {
      id: "nameRu",
      header: "Товар",
      accessor: "nameRu",
      cell: (row) => (
        <div className="product-price-analytics__product">
          <strong>{row.nameRu}</strong>
          <span>{row.categoryNameRu || "Без категории"}</span>
        </div>
      ),
    },
    {
      id: "category",
      header: "Категория",
      value: (row) => row.categoryNameRu ?? "",
      filterable: true,
      filterOptions: categoryOptions,
      initialHidden: true,
    },
    {
      id: "incomingPrice",
      header: "Приходная",
      accessor: "incomingPrice",
      align: "right",
      cell: (row) => <strong>{formatMoney(row.incomingPrice)}</strong>,
    },
    ...priceTypes.map(
      ({ type, label }): AppDataTableColumn<ProductPriceAnalytics> => ({
        id: type,
        header: label,
        align: "right",
        cell: (row) => <PriceLevelCell level={priceLevel(row, type)} />,
      }),
    ),
    {
      id: "actions",
      header: "",
      hideable: false,
      width: 52,
      align: "right",
      cell: (row) => (
        <AppButton asChild variant="ghost" aria-label={`Редактировать: ${row.nameRu}`}>
          <Link to={`/admin/products/${row.id}`}>
            <Edit size={17} />
          </Link>
        </AppButton>
      ),
    },
  ];

  const categoryColumns: AppDataTableColumn<ProductPriceAnalyticsCategory>[] = [
    {
      id: "categoryNameRu",
      header: "Категория",
      accessor: "categoryNameRu",
      cell: (row) => <strong>{row.categoryNameRu}</strong>,
    },
    {
      id: "productCount",
      header: "Товаров",
      accessor: "productCount",
      align: "right",
      sortable: true,
    },
    ...priceTypes.map(
      ({ type, label }): AppDataTableColumn<ProductPriceAnalyticsCategory> => ({
        id: type,
        header: label,
        value: (row) =>
          categoryPriceLevel(row, type)?.averageMarkupPercent ?? Number.NEGATIVE_INFINITY,
        align: "right",
        sortable: true,
        cell: (row) => <PriceLevelSummaryCell summary={categoryPriceLevel(row, type)} />,
      }),
    ),
  ];

  return (
    <AdminPage
      eyebrow="Товары и услуги"
      title="Аналитика цен"
      actions={
        <AppButton asChild>
          <Link to="/admin/products/import-prices">
            <FileSpreadsheet size={18} />
            Импортировать цены
          </Link>
        </AppButton>
      }
    >
      <div className="product-price-analytics__workspace">
        <div className="product-price-analytics__view-switch">
          <AppTabs
            value={analyticsView}
            onValueChange={(value) => {
              const nextView = value as AnalyticsView;
              setSearchParams(nextView === "current" ? {} : { tab: "changes" });
            }}
            variant="underline"
            items={[
              {
                value: "current",
                label: "Текущие цены",
                count: productsQuery.data?.totalItems ?? 0,
                content: null,
              },
              { value: "changes", label: "Изменения цен", content: null },
            ]}
          />
        </div>

        {analyticsView === "changes" ? (
          <PriceStatisticsContent scope="SALES" />
        ) : analyticsView === "current" ? (
          <>
            <section className="product-price-analytics__summary" aria-label="Сводка текущих цен">
              <MetricCard
                icon={<Package size={20} />}
                label="В текущей выборке"
                value={productsQuery.data?.totalItems ?? "—"}
                size="compact"
              />
              <MetricCard
                icon={<AlertTriangle size={20} />}
                label="Ниже приходной"
                value={belowIncomingQuery.data?.totalItems ?? "—"}
                accent
                size="compact"
              />
              <MetricCard
                icon={<FolderTree size={20} />}
                label="Категорий"
                value={categoryAnalyticsQuery.data?.length ?? "—"}
                size="compact"
              />
            </section>

            <div className="product-price-analytics__current-heading">
              <div>
                <h2>Сравнение с приходной ценой</h2>
                <p>Наценка указана относительно приходной цены. Рискованные позиции выделены.</p>
              </div>
              <SegmentedControl
                value={currentPriceView}
                onValueChange={(value) => {
                  const nextView = value as "products" | "categories";
                  setCurrentPriceView(nextView);
                }}
                ariaLabel="Представление текущих цен"
                items={[
                  { value: "products", label: "Товары" },
                  { value: "categories", label: "Категории" },
                ]}
              />
            </div>

            {(belowIncomingQuery.data?.totalItems ?? 0) > 0 && (
              <AppAlert title="Есть цены ниже приходной" tone="warning">
                {belowIncomingQuery.data!.totalItems}{" "}
                {productWord(belowIncomingQuery.data!.totalItems)} нужно проверить перед продажей.
                Такие позиции отмечены в таблице.
              </AppAlert>
            )}

            {currentPriceView === "products" ? (
              <DataPanel title="Цены товаров" className="product-price-analytics__panel">
                <AppDataTable
                  className="product-price-analytics__table"
                  data={productsQuery.data?.items ?? []}
                  columns={columns}
                  rowId={(row) => String(row.id)}
                  rowClassName={(row) =>
                    row.hasPriceBelowIncoming
                      ? "product-price-analytics__row--below-cost"
                      : undefined
                  }
                  loading={productsQuery.isLoading}
                  error={productsQuery.isError ? "Попробуйте обновить страницу." : undefined}
                  selectable={false}
                  contextMenuActions={(row) => [
                    {
                      label: "Редактировать",
                      icon: <Edit size={17} />,
                      onSelect: () => navigate(`/admin/products/${row.id}`),
                    },
                  ]}
                  contextMenuLabel={(row) => `Действия: ${row.nameRu}`}
                  mode="server"
                  defaultPageSize={20}
                  toolbarFilters={
                    <div className="product-price-analytics__percent-filter">
                      <AppNumberInput
                        value={minMarkupPercent}
                        onChange={(event) => setMinMarkupPercent(event.target.value)}
                        step="0.01"
                        suffix="%"
                        placeholder="Наценка от, %"
                        aria-label="Минимальная наценка в процентах"
                      />
                      <AppNumberInput
                        value={maxMarkupPercent}
                        onChange={(event) => setMaxMarkupPercent(event.target.value)}
                        step="0.01"
                        suffix="%"
                        placeholder="Наценка до, %"
                        aria-label="Максимальная наценка в процентах"
                        error={
                          hasInvalidPercentRange
                            ? "Минимальный процент больше максимального"
                            : undefined
                        }
                      />
                      <div className="product-price-analytics__type-filter">
                        <AppSelect
                          options={priceTypes.map(({ type, label }) => ({ value: type, label }))}
                          value={selectedPriceTypes}
                          onValueChange={(value) =>
                            setSelectedPriceTypes(value as ProductPriceLevel["type"][])
                          }
                          multiple
                          searchable={false}
                          showSelectedTags={false}
                          multipleValueLabel={(selected) =>
                            selected.length === priceTypes.length
                              ? "Все типы цен"
                              : `Выбрано: ${selected.length} ${priceTypeWord(selected.length)}`
                          }
                          placeholder="Выберите типы"
                          ariaLabel="Типы цен для фильтра"
                          error={
                            selectedPriceTypes.length === 0
                              ? "Выберите хотя бы один тип"
                              : undefined
                          }
                        />
                      </div>
                      {selectedPriceTypes.length > 1 && (
                        <div className="product-price-analytics__type-match">
                          <SegmentedControl
                            value={priceTypeMatch}
                            onValueChange={(value) => setPriceTypeMatch(value as "any" | "all")}
                            ariaLabel="Условие для выбранных типов цен"
                            items={[
                              { value: "any", label: "Любой тип" },
                              { value: "all", label: "Все типы" },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  }
                  activeToolbarFilters={
                    Number(parsedMinMarkupPercent !== undefined) +
                    Number(parsedMaxMarkupPercent !== undefined) +
                    Number(selectedPriceTypes.length !== priceTypes.length)
                  }
                  onClearToolbarFilters={() => {
                    setMinMarkupPercent("");
                    setMaxMarkupPercent("");
                    setSelectedPriceTypes(priceTypes.map(({ type }) => type));
                    setPriceTypeMatch("any");
                  }}
                  searchValue={search}
                  onSearchChange={setSearch}
                  filterValues={filterValues}
                  onFilterValuesChange={setFilterValues}
                  page={productsQuery.data?.page ?? page}
                  pageSize={productsQuery.data?.size ?? pageSize}
                  totalItems={productsQuery.data?.totalItems ?? 0}
                  totalPages={productsQuery.data?.totalPages ?? 1}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                  emptyTitle="Товары не найдены"
                  emptyDescription="Измените условия поиска или выберите другую категорию."
                />
              </DataPanel>
            ) : (
              <DataPanel title="Наценка по категориям" className="product-price-analytics__panel">
                <AppDataTable
                  className="product-price-analytics__table"
                  data={categoryAnalyticsQuery.data ?? []}
                  columns={categoryColumns}
                  rowId={(row) => String(row.categoryId ?? "without-category")}
                  loading={categoryAnalyticsQuery.isLoading}
                  error={
                    categoryAnalyticsQuery.isError ? "Попробуйте обновить страницу." : undefined
                  }
                  selectable={false}
                  defaultPageSize={20}
                  emptyTitle="Нет данных для анализа"
                  emptyDescription="Добавьте приходную и продажную цены товарам выбранной категории."
                />
              </DataPanel>
            )}
          </>
        ) : null}
      </div>
    </AdminPage>
  );
}
