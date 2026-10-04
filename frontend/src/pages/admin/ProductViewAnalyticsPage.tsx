import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ExternalLink, Eye } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import {
  fetchProductViewAnalytics,
  fetchProductViewAnalyticsHistory,
  type ProductViewAnalyticsGroupBy,
  type ProductViewAnalyticsItem,
} from "@/shared/api/productViews";
import { ALMATY_TIME_ZONE } from "@/shared/lib/dateTime";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppChart, AppChartTooltip, appChartColors } from "@/shared/ui/AppChart";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import "./ProductViewAnalyticsPage.css";

const numberFormat = new Intl.NumberFormat("ru-KZ");

const groupByItems: { value: ProductViewAnalyticsGroupBy; label: string }[] = [
  { value: "day", label: "Дни" },
  { value: "month", label: "Месяцы" },
  { value: "year", label: "Годы" },
];

function formatPeriod(period: string, groupBy: ProductViewAnalyticsGroupBy) {
  if (groupBy === "year") return period;

  const dateValue = groupBy === "month" ? `${period}-01T12:00:00Z` : `${period}T12:00:00Z`;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return period;

  return new Intl.DateTimeFormat("ru-KZ", {
    day: groupBy === "day" ? "2-digit" : undefined,
    month: "short",
    year: groupBy === "day" ? undefined : "numeric",
    timeZone: ALMATY_TIME_ZONE,
  }).format(date);
}

function ProductViewHistory({ product }: { product: ProductViewAnalyticsItem }) {
  const [groupBy, setGroupBy] = useState<ProductViewAnalyticsGroupBy>("day");
  const historyQuery = useQuery({
    queryKey: ["products", product.productId, "view-analytics", groupBy],
    queryFn: () => fetchProductViewAnalyticsHistory(product.productId, groupBy),
  });
  const chartData = useMemo(
    () =>
      (historyQuery.data?.points ?? []).map((point) => ({
        ...point,
        label: formatPeriod(point.period, groupBy),
      })),
    [groupBy, historyQuery.data?.points],
  );

  return (
    <section
      className="product-view-analytics__history"
      aria-label={`График просмотров ${product.nameRu}`}
    >
      <header className="product-view-analytics__history-heading">
        <div>
          <span>Динамика просмотров</span>
          <strong>{product.nameRu}</strong>
        </div>
        <SegmentedControl
          items={groupByItems}
          value={groupBy}
          onValueChange={(value) => setGroupBy(value as ProductViewAnalyticsGroupBy)}
          ariaLabel="Группировка графика просмотров"
        />
      </header>

      {historyQuery.isLoading ? (
        <div className="product-view-analytics__history-loading">
          <AppSkeleton />
        </div>
      ) : historyQuery.isError ? (
        <AppAlert
          title="Не удалось загрузить динамику просмотров"
          tone="danger"
          onRetry={() => historyQuery.refetch()}
        >
          Попробуйте ещё раз.
        </AppAlert>
      ) : chartData.length === 0 ? (
        <p className="product-view-analytics__history-empty">За этот период просмотров не было.</p>
      ) : (
        <AppChart
          title={`Просмотры товара: ${product.nameRu}`}
          description="Количество открытий карточки товара за выбранный период"
          height={270}
        >
          <BarChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={26} />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              width={42}
              tickFormatter={(value) => numberFormat.format(Number(value))}
            />
            <AppChartTooltip
              formatter={(value) => [numberFormat.format(Number(value)), "Просмотров"]}
            />
            <Bar
              dataKey="views"
              name="Просмотров"
              fill={appChartColors.orange}
              radius={[5, 5, 0, 0]}
            />
          </BarChart>
        </AppChart>
      )}
    </section>
  );
}

export function ProductViewAnalyticsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sorting, setSorting] = useState<SortingState>([{ id: "views", desc: true }]);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const viewsQuery = useQuery({
    queryKey: ["products", "view-analytics", deferredSearch, page, pageSize, sorting],
    queryFn: () => {
      const sort = sorting[0]?.id;
      return fetchProductViewAnalytics({
        page,
        size: pageSize,
        search: deferredSearch,
        sort: sort === "sku" || sort === "nameRu" || sort === "views" ? sort : "views",
        direction: sorting[0]?.desc ? "desc" : "asc",
      });
    },
  });
  const items = viewsQuery.data?.items ?? [];

  const columns: AppDataTableColumn<ProductViewAnalyticsItem>[] = [
    {
      id: "sku",
      header: "Артикул",
      accessor: "sku",
      sortable: true,
      width: 132,
      cell: (row) => <code>{row.sku}</code>,
    },
    {
      id: "nameRu",
      header: "Товар",
      accessor: "nameRu",
      sortable: true,
      cell: (row) => <strong className="product-view-analytics__name">{row.nameRu}</strong>,
    },
    {
      id: "categoryNameRu",
      header: "Категория",
      value: (row) => row.categoryNameRu ?? "",
      cell: (row) => row.categoryNameRu ?? "Без категории",
    },
    {
      id: "views",
      header: "Просмотров",
      accessor: "views",
      sortable: true,
      searchable: false,
      align: "right",
      cell: (row) => (
        <AppBadge tone="blue" className="product-view-analytics__count">
          <Eye size={14} />
          {numberFormat.format(row.views)}
        </AppBadge>
      ),
    },
    {
      id: "actions",
      header: "",
      hideable: false,
      width: 54,
      align: "right",
      cell: (row) => (
        <AppButton asChild variant="ghost" aria-label={`Открыть товар: ${row.nameRu}`}>
          <Link to={`/admin/products/${row.productId}`}>
            <ExternalLink size={17} />
          </Link>
        </AppButton>
      ),
    },
  ];

  return (
    <AdminPage eyebrow="Товары и услуги" title="Просмотры товаров">
      <AppAlert title="Детализация по товару" tone="info">
        Нажмите на строку, чтобы развернуть график просмотров по дням, месяцам или годам.
      </AppAlert>

      <DataPanel title="Популярность товаров" className="product-view-analytics__panel">
        <AppDataTable
          className="product-view-analytics__table"
          data={items}
          columns={columns}
          rowId={(row) => String(row.productId)}
          loading={viewsQuery.isLoading}
          error={viewsQuery.isError ? "Попробуйте обновить страницу." : undefined}
          selectable={false}
          contextMenuActions={(row) => [
            {
              label: "Открыть товар",
              icon: <ExternalLink size={17} />,
              onSelect: () => navigate(`/admin/products/${row.productId}`),
            },
          ]}
          contextMenuLabel={(row) => `Действия: ${row.nameRu}`}
          mode="server"
          defaultPageSize={20}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
            setExpandedRowId(null);
          }}
          sortingState={sorting}
          onSortingStateChange={(value) => {
            setSorting(value);
            setPage(1);
            setExpandedRowId(null);
          }}
          page={viewsQuery.data?.page ?? page}
          pageSize={viewsQuery.data?.size ?? pageSize}
          totalItems={viewsQuery.data?.totalItems ?? 0}
          totalPages={viewsQuery.data?.totalPages ?? 1}
          onPageChange={(value) => {
            setPage(value);
            setExpandedRowId(null);
          }}
          onPageSizeChange={(value) => {
            setPageSize(value);
            setPage(1);
            setExpandedRowId(null);
          }}
          expandedRowId={expandedRowId}
          onExpandedRowIdChange={(rowId) => setExpandedRowId(rowId)}
          renderExpandedRow={(row) => <ProductViewHistory product={row} />}
          emptyTitle="Просмотров пока нет"
          emptyDescription="Товары появятся здесь после первых открытий их карточек клиентами."
        />
      </DataPanel>
    </AdminPage>
  );
}
