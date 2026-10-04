import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  FileSpreadsheet,
  Layers3,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { useSearchParams } from "react-router-dom";
import { ALMATY_TIME_ZONE } from "@/shared/lib/dateTime";
import {
  fetchPriceStatisticImports,
  fetchPriceStatisticPeriodAnalytics,
  fetchPriceStatisticProductTrendHistory,
  type PriceStatisticCategoryTrend,
  type PriceStatisticImportSummary,
  type PriceStatisticProductTrend,
  type PriceStatisticsSource,
  type PriceType,
  type PriceStatisticsScope,
} from "@/shared/api/priceStatistics";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppChart, AppChartTooltip, appChartColors } from "@/shared/ui/AppChart";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppSelect } from "@/shared/ui/AppField";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import "./PriceStatisticsPage.css";

const numberFormat = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ALMATY_TIME_ZONE,
});
const shortDateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  timeZone: ALMATY_TIME_ZONE,
});

const priceTypeLabels: Record<PriceType, string> = {
  RETAIL: "Розничная",
  WHOLESALE: "Оптовая",
  BULK_WHOLESALE: "Крупный опт",
  SKO: "СКО",
  GSKO: "ГСКО",
  INCOMING: "Приходная",
};

const salesPriceTypes: PriceType[] = ["RETAIL", "WHOLESALE", "BULK_WHOLESALE", "SKO", "GSKO"];
const periodOptions = [
  { value: "week", label: "7 дней" },
  { value: "month", label: "30 дней" },
  { value: "year", label: "Год" },
  { value: "5years", label: "5 лет" },
  { value: "all", label: "Всё время" },
] as const;
type AnalyticsPeriod = (typeof periodOptions)[number]["value"];
type DetailView = "products" | "categories";
type RankingKind = "growth" | "volatility";

function priceTypeSummary(summary: PriceStatisticImportSummary, priceType: PriceType) {
  return summary.priceTypes.find((item) => item.priceType === priceType) ?? null;
}

function safeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string, compact = false) {
  const date = safeDate(value);
  return date ? (compact ? shortDateFormat.format(date) : dateFormat.format(date)) : "—";
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${numberFormat.format(value)}%`;
}

function formatMoney(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${numberFormat.format(value)} ₸`;
}

function isPriceType(value: string | null): value is PriceType {
  return Boolean(value && value in priceTypeLabels);
}

function isAnalyticsPeriod(value: string | null): value is AnalyticsPeriod {
  return periodOptions.some((option) => option.value === value);
}

function isRankingKind(value: string | null): value is RankingKind {
  return value === "growth" || value === "volatility";
}

function fileCountLabel(count: number) {
  const remainder = count % 100;
  const lastDigit = count % 10;
  const word =
    remainder >= 11 && remainder <= 14
      ? "файлов"
      : lastDigit === 1
        ? "файл"
        : lastDigit >= 2 && lastDigit <= 4
          ? "файла"
          : "файлов";
  return `${count} ${word}`;
}

function sourceLabel(source: PriceStatisticsSource) {
  return source === "WAREHOUSE_PRICE_SETTING" ? "Установка цен" : "Импорт цен";
}

function updateGroupLabel(summary: PriceStatisticImportSummary) {
  if (summary.source === "WAREHOUSE_PRICE_SETTING") {
    return `${sourceLabel(summary.source)} · ${summary.sourceName} · ${formatDate(summary.completedAt, true)}`;
  }
  return `Импорт · ${formatDate(summary.completedAt, true)} · ${fileCountLabel(summary.importCount)}`;
}

function percentTone(value: number | null) {
  if (value === null || value === 0) return "slate" as const;
  return value > 0 ? ("orange" as const) : ("green" as const);
}

function PercentBadge({ value }: { value: number | null }) {
  return (
    <AppBadge tone={percentTone(value)}>
      {value !== null && value > 0 ? <ArrowUpRight size={13} /> : null}
      {value !== null && value < 0 ? <ArrowDownRight size={13} /> : null}
      {formatPercent(value)}
    </AppBadge>
  );
}

function TrendList({
  title,
  description,
  items,
  kind,
  onOpen,
}: {
  title: string;
  description: string;
  items: PriceStatisticProductTrend[];
  kind: RankingKind;
  onOpen: (kind: RankingKind) => void;
}) {
  const open = () => onOpen(kind);
  return (
    <div
      className="price-statistics-ranking__trigger"
      role="link"
      tabIndex={0}
      aria-label={`${title}: открыть полную таблицу`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <DataPanel
        title={title}
        size="compact"
        className="price-statistics-ranking"
        actions={<span className="price-statistics-ranking__open">Открыть таблицу</span>}
      >
        <p className="price-statistics-ranking__description">{description}</p>
        {items.length ? (
          <ol className="price-statistics-ranking__list">
            {items.map((item) => (
              <li key={`${kind}-${item.productId ?? item.sku}`}>
                <span className="price-statistics-ranking__number" aria-hidden="true" />
                <div className="price-statistics-ranking__product">
                  <strong>{item.productName}</strong>
                  <span>
                    {item.categoryName || "Без категории"} · {item.updateCount} пересм.
                  </span>
                </div>
                <div className="price-statistics-ranking__value">
                  <PercentBadge
                    value={
                      kind === "growth" ? item.netChangePercent : item.averageAbsoluteChangePercent
                    }
                  />
                  <small>
                    {kind === "growth"
                      ? "за период"
                      : `макс. ${formatPercent(item.maximumAbsoluteChangePercent)}`}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="price-statistics-ranking__empty">Недостаточно изменений за период.</p>
        )}
      </DataPanel>
    </div>
  );
}

const productTrendColumns: AppDataTableColumn<PriceStatisticProductTrend>[] = [
  {
    id: "productName",
    header: "Товар",
    accessor: "productName",
    cell: (row) => (
      <div className="price-statistics-product-name">
        <strong>{row.productName}</strong>
        <span>{row.categoryName || "Без категории"}</span>
      </div>
    ),
  },
  { id: "sku", header: "Артикул", accessor: "sku", width: 110 },
  {
    id: "netChangePercent",
    header: "Итог",
    accessor: "netChangePercent",
    sortable: true,
    align: "right",
    cell: (row) => <PercentBadge value={row.netChangePercent} />,
  },
  {
    id: "updateCount",
    header: "Пересмотров",
    accessor: "updateCount",
    sortable: true,
    align: "right",
  },
  {
    id: "averageAbsoluteChangePercent",
    header: "Нестабильность",
    accessor: "averageAbsoluteChangePercent",
    sortable: true,
    align: "right",
    cell: (row) => <PercentBadge value={row.averageAbsoluteChangePercent} />,
  },
];

const categoryTrendColumns: AppDataTableColumn<PriceStatisticCategoryTrend>[] = [
  {
    id: "categoryName",
    header: "Категория",
    accessor: "categoryName",
    cell: (row) => <strong>{row.categoryName || "Без категории"}</strong>,
  },
  {
    id: "productCount",
    header: "Товаров",
    accessor: "productCount",
    sortable: true,
    align: "right",
  },
  {
    id: "averageNetChangePercent",
    header: "Среднее",
    accessor: "averageNetChangePercent",
    sortable: true,
    align: "right",
    cell: (row) => <PercentBadge value={row.averageNetChangePercent} />,
  },
  {
    id: "updateCount",
    header: "Пересмотров",
    accessor: "updateCount",
    sortable: true,
    align: "right",
  },
  {
    id: "averageVolatilityPercent",
    header: "Нестабильность",
    accessor: "averageVolatilityPercent",
    sortable: true,
    align: "right",
    cell: (row) => <PercentBadge value={row.averageVolatilityPercent} />,
  },
];

function rankingColumns(priceType: PriceType): AppDataTableColumn<PriceStatisticProductTrend>[] {
  const priceLabel = priceTypeLabels[priceType];
  return [
    {
      id: "productName",
      header: "Товар",
      accessor: "productName",
      cell: (row) => (
        <div className="price-statistics-product-name">
          <strong>{row.productName}</strong>
          <span>{row.categoryName || "Без категории"}</span>
        </div>
      ),
    },
    { id: "sku", header: "Артикул", accessor: "sku", width: 112 },
    {
      id: "startPrice",
      header: `Было · ${priceLabel}`,
      accessor: "startPrice",
      sortable: true,
      align: "right",
      cell: (row) => <strong>{formatMoney(row.startPrice)}</strong>,
    },
    {
      id: "currentPrice",
      header: `Стало · ${priceLabel}`,
      accessor: "currentPrice",
      sortable: true,
      align: "right",
      cell: (row) => <strong>{formatMoney(row.currentPrice)}</strong>,
    },
    {
      id: "netChangePercent",
      header: "Итог",
      accessor: "netChangePercent",
      sortable: true,
      align: "right",
      cell: (row) => <PercentBadge value={row.netChangePercent} />,
    },
    {
      id: "updateCount",
      header: "Изменений",
      accessor: "updateCount",
      sortable: true,
      align: "right",
    },
  ];
}

function ProductTrendHistory({
  product,
  priceType,
  period,
}: {
  product: PriceStatisticProductTrend;
  priceType: PriceType;
  period: AnalyticsPeriod;
}) {
  const historyQuery = useQuery({
    queryKey: ["price-statistics", "product-trend-history", product.productId, priceType, period],
    queryFn: () => fetchPriceStatisticProductTrendHistory(product.productId!, priceType, period),
    enabled: product.productId !== null,
    retry: false,
  });

  if (product.productId === null) {
    return <p className="price-statistics-history__empty">История для этой записи недоступна.</p>;
  }

  if (historyQuery.isLoading) return <AppSkeleton />;

  if (historyQuery.isError) {
    return (
      <AppAlert title="Не удалось загрузить историю цены" tone="danger">
        Повторите попытку позднее.
      </AppAlert>
    );
  }

  const points = historyQuery.data?.points ?? [];
  return (
    <div className="price-statistics-history">
      <div className="price-statistics-history__heading">
        <strong>{priceTypeLabels[priceType]} цена: все изменения за период</strong>
        <span>Нажмите на строку ещё раз, чтобы свернуть историю.</span>
      </div>
      {points.length ? (
        <ol className="price-statistics-history__list">
          {points.map((point) => (
            <li key={`${point.changedAt}-${point.oldPrice}-${point.newPrice}`}>
              <span className="price-statistics-history__date">
                <time dateTime={point.changedAt}>{formatDate(point.changedAt)}</time>
                <small>{`${sourceLabel(point.source)} · ${point.sourceName}`}</small>
              </span>
              <span>
                {formatMoney(point.oldPrice)} <b aria-hidden="true">→</b>{" "}
                {formatMoney(point.newPrice)}
              </span>
              <PercentBadge value={point.changePercent} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="price-statistics-history__empty">За этот период изменений не найдено.</p>
      )}
    </div>
  );
}

export function PriceStatisticsContent({ scope = "SALES" }: { scope?: PriceStatisticsScope }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const ranking = isRankingKind(searchParams.get("ranking")) ? searchParams.get("ranking") : null;
  const selectedRanking = ranking as RankingKind | null;
  const [chartPriceType, setChartPriceType] = useState<PriceType>("RETAIL");
  const [analyticsPeriod, setAnalyticsPeriod] = useState<AnalyticsPeriod>("year");
  const [detailView, setDetailView] = useState<DetailView>("products");

  useEffect(() => {
    setChartPriceType(scope === "INCOMING" ? "INCOMING" : "RETAIL");
  }, [scope]);

  useEffect(() => {
    const priceType = searchParams.get("priceType");
    const period = searchParams.get("period");
    if (isPriceType(priceType)) setChartPriceType(priceType);
    if (isAnalyticsPeriod(period)) setAnalyticsPeriod(period);
  }, [searchParams]);

  const importsQuery = useQuery({
    queryKey: ["price-statistics", "imports"],
    queryFn: () => fetchPriceStatisticImports(1, 100),
    retry: false,
  });
  const periodAnalyticsQuery = useQuery({
    queryKey: ["price-statistics", "period-analytics", chartPriceType, analyticsPeriod],
    queryFn: () => fetchPriceStatisticPeriodAnalytics(chartPriceType, analyticsPeriod),
    retry: false,
  });

  const imports = importsQuery.data?.items ?? [];
  const chartPriceTypeOptions = [...salesPriceTypes, "INCOMING" as PriceType];
  const historyChartData = useMemo(
    () =>
      [...imports].reverse().map((item) => ({
        id: item.importId,
        label: formatDate(item.completedAt, true),
        groupLabel: updateGroupLabel(item),
        average: priceTypeSummary(item, chartPriceType)?.averageChangePercent ?? null,
        products: priceTypeSummary(item, chartPriceType)?.changedProducts ?? 0,
      })),
    [chartPriceType, imports],
  );
  const rankedGrowth = useMemo(
    () =>
      [...(periodAnalyticsQuery.data?.products ?? [])]
        .filter((item) => item.netChangePercent > 0)
        .sort((left, right) => right.netChangePercent - left.netChangePercent),
    [periodAnalyticsQuery.data?.products],
  );
  const rankedVolatility = useMemo(
    () =>
      [...(periodAnalyticsQuery.data?.products ?? [])].sort(
        (left, right) =>
          right.averageAbsoluteChangePercent - left.averageAbsoluteChangePercent ||
          right.updateCount - left.updateCount,
      ),
    [periodAnalyticsQuery.data?.products],
  );
  const groupColumns = useMemo<AppDataTableColumn<PriceStatisticImportSummary>[]>(
    () => [
      {
        id: "group",
        header: "Группа обновления",
        value: (row) => updateGroupLabel(row),
        sortable: true,
        cell: (row) => (
          <div className="price-statistics-group-name">
            {row.source === "WAREHOUSE_PRICE_SETTING" ? (
              <Layers3 size={17} aria-hidden="true" />
            ) : (
              <FileSpreadsheet size={17} aria-hidden="true" />
            )}
            <span>
              <strong>{row.sourceName || formatDate(row.completedAt)}</strong>
              <small>
                {row.source === "WAREHOUSE_PRICE_SETTING"
                  ? `${sourceLabel(row.source)} · ${formatDate(row.completedAt)}`
                  : fileCountLabel(row.importCount)}
              </small>
            </span>
          </div>
        ),
      },
      {
        id: "changedProducts",
        header: "Товаров",
        value: (row) => priceTypeSummary(row, chartPriceType)?.changedProducts ?? 0,
        sortable: true,
        align: "right",
      },
      {
        id: "averageChangePercent",
        header: "Среднее",
        value: (row) => priceTypeSummary(row, chartPriceType)?.averageChangePercent ?? 0,
        sortable: true,
        align: "right",
        cell: (row) => (
          <PercentBadge
            value={priceTypeSummary(row, chartPriceType)?.averageChangePercent ?? null}
          />
        ),
      },
    ],
    [chartPriceType],
  );

  if (importsQuery.isLoading) return <AppSkeleton />;

  if (importsQuery.isError) {
    return (
      <AppAlert
        title="Не удалось загрузить историю цен"
        tone="danger"
        onRetry={() => importsQuery.refetch()}
      >
        Проверьте доступность сервера и повторите попытку.
      </AppAlert>
    );
  }

  if (imports.length === 0) {
    return (
      <AppAlert title="История обновлений пока пуста">
        После первого подтверждённого импорта здесь появятся группы обновлений, динамика и анализ
        изменений цен.
      </AppAlert>
    );
  }

  const analytics = periodAnalyticsQuery.data;
  const rankingItems = selectedRanking === "growth" ? rankedGrowth : rankedVolatility;
  const rankingTitle =
    selectedRanking === "growth" ? "Больше всего подорожали" : "Самые нестабильные";

  function updateRankingSearchParams(nextValues: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    Object.entries(nextValues).forEach(([key, value]) => {
      if (value === null) next.delete(key);
      else next.set(key, value);
    });
    setSearchParams(next);
  }

  function openRanking(kind: RankingKind) {
    updateRankingSearchParams({
      ranking: kind,
      priceType: chartPriceType,
      period: analyticsPeriod,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeRanking() {
    updateRankingSearchParams({ ranking: null, priceType: null, period: null });
  }

  function handlePriceTypeChange(value: PriceType) {
    setChartPriceType(value);
    if (selectedRanking) updateRankingSearchParams({ priceType: value });
  }

  function handlePeriodChange(value: AnalyticsPeriod) {
    setAnalyticsPeriod(value);
    if (selectedRanking) updateRankingSearchParams({ period: value });
  }

  if (selectedRanking) {
    return (
      <div className="price-statistics price-statistics--ranking-details">
        <section className="price-statistics-filter-bar" aria-label="Параметры детализации цен">
          <div className="price-statistics-filter-bar__intro">
            <span className="price-statistics-filter-bar__eyebrow">Детализация рейтинга</span>
            <strong>{rankingTitle}</strong>
            <span>
              Сравнение начальной и текущей цены. Нажмите на товар, чтобы увидеть каждое изменение.
            </span>
          </div>
          <div className="price-statistics-filter-bar__controls">
            <AppSelect
              options={chartPriceTypeOptions.map((priceType) => ({
                value: priceType,
                label: priceTypeLabels[priceType],
              }))}
              value={chartPriceType}
              onValueChange={(value) => handlePriceTypeChange(value as PriceType)}
              clearable={false}
              ariaLabel="Тип цены"
            />
            <AppSelect
              options={[...periodOptions]}
              value={analyticsPeriod}
              onValueChange={(value) => handlePeriodChange(value as AnalyticsPeriod)}
              clearable={false}
              ariaLabel="Период анализа"
            />
          </div>
        </section>

        <DataPanel
          title={`${rankingTitle} · ${priceTypeLabels[chartPriceType]}`}
          className="price-statistics-ranking-details"
          actions={
            <AppButton variant="secondary" onClick={closeRanking}>
              <ArrowLeft size={17} />К обзору
            </AppButton>
          }
        >
          <p className="price-statistics-ranking-details__description">
            В столбцах «Было» и «Стало» показана цена на границах выбранного периода. В развёрнутой
            строке — все промежуточные изменения.
          </p>
          <AppDataTable
            data={rankingItems}
            columns={rankingColumns(chartPriceType)}
            rowId={(row) => String(row.productId ?? row.sku)}
            loading={periodAnalyticsQuery.isLoading}
            error={periodAnalyticsQuery.isError ? "Не удалось загрузить анализ." : undefined}
            selectable={false}
            searchable
            defaultPageSize={20}
            renderExpandedRow={(row) => (
              <ProductTrendHistory
                product={row}
                priceType={chartPriceType}
                period={analyticsPeriod}
              />
            )}
            emptyTitle="Подходящих товаров нет"
            emptyDescription="Измените период или выберите другой тип цены."
          />
        </DataPanel>
      </div>
    );
  }

  return (
    <div className="price-statistics">
      <section className="price-statistics-filter-bar" aria-label="Параметры анализа цен">
        <div className="price-statistics-filter-bar__intro">
          <span className="price-statistics-filter-bar__eyebrow">История обновлений</span>
          <strong>Как меняются цены</strong>
          <span>Импорты и проведённые документы установки цен учитываются вместе.</span>
        </div>
        <div className="price-statistics-filter-bar__controls">
          <AppSelect
            options={chartPriceTypeOptions.map((priceType) => ({
              value: priceType,
              label: priceTypeLabels[priceType],
            }))}
            value={chartPriceType}
            onValueChange={(value) => handlePriceTypeChange(value as PriceType)}
            clearable={false}
            ariaLabel="Тип цены"
          />
          <AppSelect
            options={[...periodOptions]}
            value={analyticsPeriod}
            onValueChange={(value) => handlePeriodChange(value as AnalyticsPeriod)}
            clearable={false}
            ariaLabel="Период анализа"
          />
        </div>
      </section>

      <section className="price-statistics-dashboard">
        <DataPanel title="Динамика цен" size="compact" className="price-statistics-chart-panel">
          <AppChart
            title={`Среднее изменение: ${priceTypeLabels[chartPriceType]}`}
            description="Каждая точка — одно обновление цен"
            height={276}
          >
            <LineChart data={historyChartData} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} />
              <ReferenceLine y={0} stroke={appChartColors.slate} />
              <AppChartTooltip
                labelFormatter={(_, payload) =>
                  (payload[0] as { payload?: { groupLabel?: string } } | undefined)?.payload
                    ?.groupLabel ?? "Группа обновления"
                }
                formatter={(value, name, item) =>
                  name === "Среднее изменение"
                    ? [formatPercent(Number(value)), name]
                    : [
                        String(
                          (item as { payload?: { products?: number } }).payload?.products ?? value,
                        ),
                        "Изменено товаров",
                      ]
                }
              />
              <Line
                type="monotone"
                dataKey="average"
                name="Среднее изменение"
                stroke={appChartColors.orange}
                strokeWidth={3}
                dot={{ r: 3, fill: appChartColors.orange }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            </LineChart>
          </AppChart>
        </DataPanel>

        <div className="price-statistics-insights" aria-busy={periodAnalyticsQuery.isLoading}>
          <MetricCard
            icon={<TrendingUp size={17} />}
            label="Подорожали"
            value={analytics?.increasedProducts ?? "—"}
            accent
            size="compact"
          />
          <MetricCard
            icon={<TrendingDown size={17} />}
            label="Подешевели"
            value={analytics?.decreasedProducts ?? "—"}
            size="compact"
          />
          <MetricCard
            icon={<RefreshCw size={17} />}
            label="Нестабильные"
            value={analytics?.unstableProducts ?? "—"}
            size="compact"
          />
          <MetricCard
            icon={<BarChart3 size={17} />}
            label="Среднее изменение"
            value={formatPercent(analytics?.averageNetChangePercent ?? null)}
            size="compact"
          />
        </div>
      </section>

      <section className="price-statistics-rankings">
        <TrendList
          title="Больше всего подорожали"
          description="Лидеры роста за выбранный период"
          items={rankedGrowth.slice(0, 5)}
          kind="growth"
          onOpen={openRanking}
        />
        <TrendList
          title="Самые нестабильные"
          description="Чаще всего и сильнее меняли цену"
          items={rankedVolatility.slice(0, 5)}
          kind="volatility"
          onOpen={openRanking}
        />
      </section>

      <DataPanel
        title="Подробный анализ"
        size="compact"
        className="price-statistics-detail"
        actions={
          <SegmentedControl
            value={detailView}
            onValueChange={(value) => setDetailView(value as DetailView)}
            ariaLabel="Вид подробного анализа"
            items={[
              {
                value: "products",
                label: `Товары${analytics ? ` · ${analytics.products.length}` : ""}`,
              },
              {
                value: "categories",
                label: `Категории${analytics ? ` · ${analytics.categories.length}` : ""}`,
              },
            ]}
          />
        }
      >
        <p className="price-statistics-detail__description">
          {detailView === "products"
            ? "Отсортируйте по итоговому изменению, количеству пересмотров или нестабильности."
            : "Сравните рост и нестабильность цен между товарными категориями."}
        </p>
        {detailView === "products" ? (
          <AppDataTable
            data={analytics?.products ?? []}
            columns={productTrendColumns}
            rowId={(row) => `${row.productId ?? row.sku}`}
            loading={periodAnalyticsQuery.isLoading}
            error={periodAnalyticsQuery.isError ? "Не удалось загрузить анализ." : undefined}
            selectable={false}
            searchable
            defaultPageSize={20}
            emptyTitle="Недостаточно истории"
            emptyDescription="После нескольких изменений цен здесь появится подробная динамика."
          />
        ) : (
          <AppDataTable
            data={analytics?.categories ?? []}
            columns={categoryTrendColumns}
            rowId={(row) => String(row.categoryId ?? "without-category")}
            loading={periodAnalyticsQuery.isLoading}
            error={periodAnalyticsQuery.isError ? "Не удалось загрузить анализ." : undefined}
            selectable={false}
            searchable
            defaultPageSize={20}
            emptyTitle="Недостаточно истории"
            emptyDescription="После нескольких изменений цен здесь появится подробная динамика."
          />
        )}
      </DataPanel>

      <DataPanel title="Источники обновлений" size="compact" className="price-statistics-groups">
        <AppDataTable
          data={imports}
          columns={groupColumns}
          rowId={(row) => row.importId}
          selectable={false}
          searchable
          defaultPageSize={8}
          pageSizes={[8, 20, 50]}
          emptyTitle="Группы не найдены"
          emptyDescription="Измените строку поиска, импортируйте прайс-лист или проведите документ установки цен."
        />
      </DataPanel>
    </div>
  );
}
