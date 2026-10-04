import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  ArrowUpRight,
  BarChart3,
  Package,
  ShoppingCart,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import { AdminPage } from "@/layouts/AdminPage";
import { todayInAlmaty } from "@/shared/lib/dateTime";
import { fetchSalesAnalytics } from "@/shared/api/salesAnalytics";
import type {
  SalesAnalyticsBreakdownItem,
  SalesAnalyticsGroupBy,
  SalesAnalyticsPoint,
  SalesAnalyticsData,
} from "@/shared/types/models";
import { AppChart, AppChartTooltip, appChartColors } from "@/shared/ui/AppChart";
import { AppDateRangePicker, type AppDateRange } from "@/shared/ui/AppDatePicker";
import { AppSelect } from "@/shared/ui/AppField";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppButton } from "@/shared/ui/AppButton";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import "./SalesAnalyticsPage.css";

type Dimension = "employees" | "products" | "categories";
type Metric = "revenue" | "netProfit" | "orders" | "items";
const labels: Record<Metric, string> = {
  revenue: "Выручка",
  netProfit: "Расчётная прибыль",
  orders: "Заказы",
  items: "Количество",
};
const dimensions: Record<Dimension, string> = {
  employees: "Сотрудники",
  products: "Товары",
  categories: "Категории",
};
const nf = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("ru-KZ", { notation: "compact", maximumFractionDigits: 1 });
const money = (v: number) => `${nf.format(v)} ₸`;
const formatPeriodDate = (value: string) => {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
};
const valueLabel = (value: number, metric: Metric) =>
  metric === "revenue" || metric === "netProfit" ? money(value) : nf.format(value);
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const groups = [
  { value: "day", label: "Дни" },
  { value: "week", label: "Недели" },
  { value: "month", label: "Месяцы" },
  { value: "year", label: "Годы" },
];
function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function presetRange(preset = "30"): AppDateRange {
  const to = new Date(`${todayInAlmaty()}T12:00:00`),
    from = new Date(to);
  if (preset === "year") from.setMonth(0, 1);
  else if (preset === "3years") {
    from.setFullYear(to.getFullYear() - 2, 0, 1);
  } else from.setDate(to.getDate() - Number(preset) + 1);
  return { from, to };
}
function peak(points: SalesAnalyticsPoint[], metric: Metric) {
  return points
    .filter((p) => p.orders > 0)
    .reduce<
      SalesAnalyticsPoint | undefined
    >((best, p) => (!best || (p[metric] ?? 0) > (best[metric] ?? 0) ? p : best), undefined);
}
function ProfileChart({
  points,
  metric,
  title,
}: {
  points: SalesAnalyticsPoint[];
  metric: Metric;
  title: string;
}) {
  return (
    <AppChart title={title} height={220}>
      <BarChart data={points} margin={{ top: 15, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 5" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis
          tickFormatter={(v) => compact.format(v)}
          width={48}
          tickLine={false}
          axisLine={false}
          fontSize={11}
        />
        <AppChartTooltip formatter={(value) => valueLabel(Number(value), metric)} />
        <Bar
          dataKey={metric}
          name={labels[metric]}
          fill={metric === "netProfit" ? appChartColors.green : appChartColors.orange}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </AppChart>
  );
}
function Activity({ data, profitMode }: { data: SalesAnalyticsData; profitMode: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const cells = data.activity;
  const activityValue = (cell: (typeof cells)[number]) =>
    profitMode ? cell.netProfit : cell.orders;
  const max = Math.max(0, ...cells.map(activityValue));
  const min = Math.min(0, ...cells.map(activityValue));
  const selected = active === null ? undefined : cells[active];
  const busiest = cells
    .filter((cell) => cell.orders > 0)
    .reduce<
      typeof selected
    >((best, c) => (!best || activityValue(c) > activityValue(best) ? c : best), undefined);
  return (
    <DataPanel title={profitMode ? "Прибыль по часам" : "В какие часы покупают"}>
      <div className="sales-analytics__panel-body">
        <p className="sales-analytics__muted">
          {profitMode
            ? "Расчётная прибыль по дням недели и часам. Убыточные часы выделены красным. Нажмите на ячейку для подробностей."
            : "Число заказов по дням недели и часам. Нажмите на ячейку для подробностей."}
        </p>
        <div
          className="sales-analytics__heat-scroll"
          tabIndex={0}
          aria-label="Тепловая карта продаж, прокручивается горизонтально"
        >
          <div className="sales-analytics__heatmap">
            <span />
            {Array.from({ length: 24 }, (_, h) => (
              <span className="sales-analytics__hour" key={h}>
                {String(h).padStart(2, "0")}
              </span>
            ))}
            {weekdays.map((day, d) => (
              <div className="sales-analytics__heat-row" key={day}>
                <strong>{day}</strong>
                {cells
                  .filter((c) => c.weekday === d + 1)
                  .map((c) => {
                    const idx = d * 24 + c.hour;
                    const text = `${day}, ${c.hour}:00–${c.hour + 1}:00: ${c.orders} заказов, выручка ${money(c.revenue)}, расчётная прибыль ${money(c.netProfit)}, ${nf.format(c.items)} единиц`;
                    const value = activityValue(c);
                    const background = profitMode
                      ? value > 0
                        ? `rgba(16, 185, 129, ${0.18 + (0.82 * value) / Math.max(1, max)})`
                        : value < 0
                          ? `rgba(190, 55, 55, ${0.18 + (0.72 * Math.abs(value)) / Math.max(1, Math.abs(min))})`
                          : "var(--surface-soft, #f1f4f7)"
                      : c.orders
                        ? `rgba(239, 111, 35, ${0.18 + (0.82 * c.orders) / Math.max(1, max)})`
                        : "var(--surface-soft, #f1f4f7)";
                    return (
                      <button
                        type="button"
                        key={c.hour}
                        className="sales-analytics__heat-cell"
                        aria-label={text}
                        title={text}
                        aria-pressed={active === idx}
                        onClick={() => setActive(idx)}
                        style={{ background }}
                      />
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
        <div className="sales-analytics__heat-footer">
          <span>
            {selected
              ? `${weekdays[selected.weekday - 1]}, ${selected.hour}:00 — ${profitMode ? `прибыль ${money(selected.netProfit)}` : `${selected.orders} заказов · ${money(selected.revenue)}`}`
              : busiest
                ? `Пик ${profitMode ? "прибыли" : "заказов"}: ${weekdays[busiest.weekday - 1]}, ${busiest.hour}:00–${busiest.hour + 1}:00 · ${profitMode ? money(busiest.netProfit) : `${busiest.orders} заказов`}`
                : "Продаж за период нет"}
          </span>
          <span>
            {profitMode ? "Убыток" : "Меньше"}{" "}
            <i className={profitMode ? "sales-analytics__profit-scale" : ""} />{" "}
            {profitMode ? "Прибыль" : "Больше"}
          </span>
        </div>
        <p className="sales-analytics__footnote">
          Суммарно за выбранный период, по времени создания завершённых оплаченных заказов. Это
          активность продаж, а не часы работы магазина.
        </p>
      </div>
    </DataPanel>
  );
}

export function SalesAnalyticsPage() {
  const [range, setRange] = useState<AppDateRange>(() => presetRange());
  const [preset, setPreset] = useState("30");
  const [groupBy, setGroupBy] = useState<SalesAnalyticsGroupBy>("day");
  const [dimension, setDimension] = useState<Dimension>("products");
  const [selection, setSelection] = useState<{ id: number; name: string } | null>(null);
  const [metric, setMetric] = useState<Metric>("revenue");
  const [profitMode, setProfitMode] = useState(false);
  const [rankMetric, setRankMetric] = useState<Metric>("items");
  const from = range.from ? dateKey(range.from) : "";
  const to = range.to ? dateKey(range.to) : from;
  const invalid = !from || !to || from > to;
  const overview = useQuery({
    queryKey: ["sales-analytics", from, to, groupBy],
    queryFn: () => fetchSalesAnalytics({ from, to, groupBy }),
    enabled: !invalid,
    staleTime: 60_000,
  });
  const detail = useQuery({
    queryKey: ["sales-analytics-detail", from, to, groupBy, dimension, selection?.id],
    queryFn: () => fetchSalesAnalytics({ from, to, groupBy, dimension, entityId: selection!.id }),
    enabled: !invalid && !!selection,
    staleTime: 60_000,
  });
  const query = selection ? detail : overview;
  const data = invalid ? undefined : query.data;
  const rows = overview.data?.[dimension] ?? [];
  const ranked = useMemo(
    () => [...rows].sort((a, b) => (b[rankMetric] ?? 0) - (a[rankMetric] ?? 0)),
    [rows, rankMetric],
  );
  const selectedKey = selection ? String(selection.id) : "all";
  const title = selection?.name ?? "Все продажи магазина";
  const chartMetric = profitMode ? "netProfit" : metric;
  const monthMetric = profitMode ? "netProfit" : "items";
  const dayMetric = profitMode ? "netProfit" : "orders";
  const bestPeriod = peak(data?.series ?? [], chartMetric);
  const bestMonth = peak(data?.months ?? [], monthMetric);
  const bestDay = peak(data?.weekdays ?? [], dayMetric);
  const selectRow = (row: SalesAnalyticsBreakdownItem) =>
    setSelection({ id: row.id ?? -1, name: row.name });
  const columns: AppDataTableColumn<SalesAnalyticsBreakdownItem>[] = [
    {
      id: "name",
      header:
        dimension === "products" ? "Товар" : dimension === "employees" ? "Сотрудник" : "Категория",
      accessor: "name",
      sortable: true,
      cell: (row) => (
        <AppButton
          variant="ghost"
          className="sales-analytics__row-link"
          onClick={() => selectRow(row)}
        >
          {row.name}
          <ArrowUpRight size={14} />
        </AppButton>
      ),
    },
    {
      id: "revenue",
      header: "Выручка",
      accessor: "revenue",
      align: "right",
      sortable: true,
      cell: (row) => money(row.revenue),
    },
    {
      id: "netProfit",
      header: "Расчётная прибыль",
      accessor: "netProfit",
      align: "right",
      sortable: true,
      cell: (row) => money(row.netProfit ?? 0),
    },
    { id: "orders", header: "Заказы", accessor: "orders", align: "right", sortable: true },
    {
      id: "items",
      header: "Количество",
      accessor: "items",
      align: "right",
      sortable: true,
      cell: (row) => nf.format(row.items),
    },
    {
      id: "average",
      header: "Средний чек",
      value: (row) => (row.orders ? row.revenue / row.orders : 0),
      align: "right",
      sortable: true,
      cell: (row) => money(row.orders ? row.revenue / row.orders : 0),
    },
    {
      id: "peak",
      header: "Пик за период",
      value: (row) => peak(row.series, rankMetric)?.label ?? "—",
      cell: (row) => peak(row.series, rankMetric)?.label ?? "—",
    },
  ];
  const options = [
    { value: "all", label: "Все продажи магазина" },
    ...rows.map((r) => ({ value: String(r.id ?? -1), label: r.name })),
  ];
  if (selection && !options.some((o) => o.value === selectedKey))
    options.push({ value: selectedKey, label: selection.name });
  return (
    <AdminPage eyebrow="Результаты магазина" title="Аналитика продаж">
      <div className="sales-analytics">
        <div className="sales-analytics__toolbar">
          <div>
            <h2>От общей картины — к каждой продаже</h2>
            <p>Выберите период, найдите лидеров и узнайте, когда покупают чаще.</p>
          </div>
          <AppDateRangePicker
            label="Период анализа"
            value={range}
            onValueChange={(next) => {
              setRange(next ?? presetRange());
              setPreset("");
            }}
          />
          <SegmentedControl
            items={[
              { value: "7", label: "7 дней" },
              { value: "30", label: "30 дней" },
              { value: "90", label: "90 дней" },
              { value: "year", label: "Этот год" },
              { value: "3years", label: "3 года" },
            ]}
            value={preset}
            onValueChange={(v) => {
              setPreset(v);
              setRange(presetRange(v));
              setGroupBy(v === "3years" ? "year" : v === "year" ? "month" : "day");
            }}
          />
        </div>
        <div className="sales-analytics__scope">
          <SegmentedControl
            items={Object.entries(dimensions).map(([value, label]) => ({ value, label }))}
            value={dimension}
            onValueChange={(v) => {
              setDimension(v as Dimension);
              setSelection(null);
              setRankMetric(v === "products" ? "items" : "revenue");
            }}
          />
          <AppSelect
            label="Отдельная статистика"
            options={options}
            value={selectedKey}
            searchable
            clearable={false}
            onValueChange={(v) => {
              const row = rows.find((r) => String(r.id ?? -1) === String(v));
              if (row) selectRow(row);
              else setSelection(null);
            }}
          />
          {selection && (
            <AppButton variant="ghost" onClick={() => setSelection(null)}>
              <X size={15} /> Сбросить
            </AppButton>
          )}
        </div>
        <div className="sales-analytics__chart-mode">
          <span>Показатель графиков</span>
          <SegmentedControl
            ariaLabel="Показатель всех графиков"
            items={[
              { value: "sales", label: "Продажи и спрос" },
              { value: "profit", label: "Расчётная прибыль" },
            ]}
            value={profitMode ? "profit" : "sales"}
            onValueChange={(value) => setProfitMode(value === "profit")}
          />
        </div>
        {invalid ? (
          <AppAlert tone="warning" title="Проверьте период">
            Дата начала должна быть не позже даты окончания.
          </AppAlert>
        ) : query.isError ? (
          <AppAlert
            tone="danger"
            title="Не удалось загрузить аналитику"
            onRetry={() => query.refetch()}
          >
            Повторите запрос. {query.error instanceof Error ? query.error.message : ""}
          </AppAlert>
        ) : !data ? (
          <div className="sales-analytics__loading" role="status">
            <AppSkeleton />
            <span>Собираем показатели продаж…</span>
          </div>
        ) : (
          <>
            <div className="sales-analytics__section-title">
              <h2>{title}</h2>
              <span>
                {selection ? "Выбранный разрез" : "Общая статистика"} · с{" "}
                {formatPeriodDate(data.from)} по {formatPeriodDate(data.to)}
                {query.isFetching ? " · Обновляем…" : ""}
              </span>
              {dimension === "products" && selection && selection.id > 0 && (
                <Link
                  to={`/admin/products/${selection.id}`}
                  state={{ returnTo: "/admin/analytics" }}
                >
                  Карточка товара ↗
                </Link>
              )}
            </div>
            <div className="sales-analytics__metrics">
              <MetricCard
                icon={profitMode ? <TrendingUp size={18} /> : <WalletCards size={18} />}
                label={profitMode ? "Расчётная прибыль" : "Выручка"}
                value={money(profitMode ? (data.totals.netProfit ?? 0) : data.totals.revenue)}
                accent
                className={profitMode ? "sales-analytics__metric-profit" : ""}
                size="compact"
              />
              <MetricCard
                icon={<ShoppingCart size={18} />}
                label="Оплаченных заказов"
                value={nf.format(data.totals.orders)}
                size="compact"
              />
              <MetricCard
                icon={<BarChart3 size={18} />}
                label={
                  profitMode
                    ? selection && dimension !== "employees"
                      ? "Прибыль на заказ в разрезе"
                      : "Прибыль на заказ"
                    : selection && dimension !== "employees"
                      ? "На заказ в этом разрезе"
                      : "Средний чек"
                }
                value={money(
                  data.totals.orders
                    ? (profitMode ? (data.totals.netProfit ?? 0) : data.totals.revenue) /
                        data.totals.orders
                    : 0,
                )}
                size="compact"
              />
              <MetricCard
                icon={<Package size={18} />}
                label="Продано единиц"
                value={nf.format(data.totals.items)}
                size="compact"
              />
              <MetricCard
                icon={profitMode ? <WalletCards size={18} /> : <TrendingUp size={18} />}
                label={profitMode ? "Выручка" : "Расчётная прибыль"}
                value={money(profitMode ? data.totals.revenue : (data.totals.netProfit ?? 0))}
                className={profitMode ? "" : "sales-analytics__metric-profit"}
                size="compact"
              />
            </div>
            <p className="sales-analytics__footnote">
              Только завершённые и оплаченные заказы. Прибыль = продажи минус известная закупочная
              стоимость, без операционных расходов; позиции без закупочной цены в прибыль не входят.
              Сотрудник — автор заказа, самостоятельные покупки — «Интернет-магазин».
            </p>
            <DataPanel
              title={profitMode ? "Динамика прибыли" : "Динамика продаж"}
              actions={
                <SegmentedControl
                  items={groups}
                  value={groupBy}
                  onValueChange={(v) => setGroupBy(v as SalesAnalyticsGroupBy)}
                />
              }
            >
              <div className="sales-analytics__panel-body">
                <div className="sales-analytics__chart-heading">
                  {!profitMode && (
                    <SegmentedControl
                      ariaLabel="Показатель динамики продаж"
                      items={Object.entries(labels).map(([value, label]) => ({ value, label }))}
                      value={metric}
                      onValueChange={(v) => setMetric(v as Metric)}
                    />
                  )}
                  <span className="sales-analytics__muted">
                    {bestPeriod ? `Лучший период: ${bestPeriod.label}` : "Продаж пока нет"}
                  </span>
                </div>
                {data.totals.orders === 0 ? (
                  <div className="sales-analytics__empty">
                    За выбранный период нет завершённых оплаченных продаж. Попробуйте расширить
                    период.
                  </div>
                ) : (
                  <AppChart
                    title={`${labels[chartMetric]} · ${title}`}
                    height={310}
                    description={
                      profitMode
                        ? "Столбцы показывают расчётную прибыль."
                        : "Столбцы показывают выбранный показатель, линия — количество заказов."
                    }
                  >
                    <ComposedChart
                      data={data.series}
                      margin={{ top: 20, right: 5, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 5" />
                      <XAxis
                        dataKey="label"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={35}
                        fontSize={11}
                      />
                      <YAxis
                        yAxisId="value"
                        tickFormatter={(v) => compact.format(v)}
                        width={60}
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                      />
                      <YAxis
                        yAxisId="orders"
                        orientation="right"
                        width={35}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        fontSize={11}
                        hide={profitMode || metric === "orders"}
                      />
                      <AppChartTooltip
                        formatter={(v, name) => [
                          name === "Заказы (линия)"
                            ? nf.format(Number(v))
                            : valueLabel(Number(v), chartMetric),
                          name,
                        ]}
                      />
                      {data.series.length > 180 ? (
                        <Area
                          yAxisId="value"
                          dataKey={chartMetric}
                          name={labels[chartMetric]}
                          stroke={
                            chartMetric === "netProfit"
                              ? appChartColors.green
                              : appChartColors.orange
                          }
                          fill={
                            chartMetric === "netProfit"
                              ? appChartColors.green
                              : appChartColors.orange
                          }
                          fillOpacity={0.12}
                          isAnimationActive={false}
                        />
                      ) : (
                        <Bar
                          yAxisId="value"
                          dataKey={chartMetric}
                          name={labels[chartMetric]}
                          fill={
                            chartMetric === "netProfit"
                              ? appChartColors.green
                              : appChartColors.orange
                          }
                          radius={[4, 4, 0, 0]}
                          maxBarSize={38}
                          isAnimationActive={false}
                        />
                      )}
                      {!profitMode && metric !== "orders" && (
                        <Line
                          yAxisId="orders"
                          dataKey="orders"
                          name="Заказы (линия)"
                          stroke={appChartColors.blue}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      )}
                    </ComposedChart>
                  </AppChart>
                )}
              </div>
            </DataPanel>
            <div className="sales-analytics__profiles">
              <DataPanel
                title={profitMode ? "Сезонность прибыли" : "Сезонность спроса"}
                actions={
                  <span className="sales-analytics__tag">
                    {bestMonth ? `Лидер: ${bestMonth.label}` : "Нет продаж"}
                  </span>
                }
              >
                <div className="sales-analytics__panel-body">
                  <ProfileChart
                    points={data.months}
                    metric={monthMetric}
                    title={
                      profitMode
                        ? "Расчётная прибыль по месяцам"
                        : "Количество проданных единиц по месяцам"
                    }
                  />
                  <p className="sales-analytics__footnote">
                    {profitMode ? "Расчётная прибыль" : "Продано единиц"} по месяцам внутри
                    выбранного периода. Для сезонности выберите год или несколько лет; одинаковые
                    месяцы суммируются.
                  </p>
                </div>
              </DataPanel>
              <DataPanel
                title={profitMode ? "Прибыль по дням недели" : "Дни высокой активности"}
                actions={
                  <span className="sales-analytics__tag">
                    {bestDay ? `Лидер: ${bestDay.label}` : "Нет продаж"}
                  </span>
                }
              >
                <div className="sales-analytics__panel-body">
                  <ProfileChart
                    points={data.weekdays}
                    metric={dayMetric}
                    title={
                      profitMode ? "Расчётная прибыль по дням недели" : "Заказы по дням недели"
                    }
                  />
                  <p className="sales-analytics__footnote">
                    {profitMode ? "Сумма расчётной прибыли" : "Сумма заказов"} за каждый день недели
                    в выбранном периоде. В неполных неделях количество дней может различаться.
                  </p>
                </div>
              </DataPanel>
            </div>
            <Activity
              key={`${dimension}-${selectedKey}-${from}-${to}`}
              data={data}
              profitMode={profitMode}
            />
          </>
        )}
        {!invalid && (
          <DataPanel
            title={`${dimensions[dimension]} · сравнение за период`}
            className="sales-analytics__ranking"
            actions={
              <SegmentedControl
                items={[
                  { value: "items", label: "По количеству" },
                  { value: "orders", label: "По заказам" },
                  { value: "revenue", label: "По выручке" },
                  { value: "netProfit", label: "По прибыли" },
                ]}
                value={rankMetric}
                onValueChange={(v) => setRankMetric(v as Metric)}
              />
            }
          >
            <div className="sales-analytics__panel-body">
              <p className="sales-analytics__muted">
                {dimension === "employees"
                  ? "Результат каждого автора заказа. Выберите сотрудника, чтобы увидеть его динамику и часы продаж."
                  : "Выберите строку, чтобы увидеть динамику, сезонность и часы покупок. Рейтинг строится по выбранному показателю."}
              </p>
              {overview.isError ? (
                <AppAlert
                  tone="danger"
                  title="Не удалось загрузить сравнение"
                  onRetry={() => overview.refetch()}
                />
              ) : (
                <>
                  <div className="sales-analytics__leaders">
                    {ranked.slice(0, 3).map((r, i) => (
                      <button
                        type="button"
                        key={r.id ?? "none"}
                        className="sales-analytics__leader"
                        onClick={() => selectRow(r)}
                        aria-pressed={selection?.id === (r.id ?? -1)}
                      >
                        <span>
                          0{i + 1} <ArrowUpRight size={16} />
                        </span>
                        <strong>{r.name}</strong>
                        <b>{valueLabel(r[rankMetric] ?? 0, rankMetric)}</b>
                        <small>
                          {r.orders} заказов · пик: {peak(r.series, rankMetric)?.label ?? "—"}
                        </small>
                      </button>
                    ))}
                  </div>
                  <AppDataTable
                    selectable={false}
                    data={ranked}
                    columns={columns}
                    rowId={(r) => String(r.id ?? -1)}
                    loading={overview.isLoading}
                    searchable
                    defaultPageSize={10}
                  />
                </>
              )}
              <p className="sales-analytics__footnote">
                Показаны участники с продажами за период. Заказ с разными товарами или категориями
                учитывается в каждом соответствующем разрезе; складывать количество заказов между
                строками нельзя. Для товаров «средний чек» — выручка этого товара на содержащий его
                заказ. Расчётная прибыль исключает позиции без известной закупочной цены и не
                учитывает операционные расходы.
              </p>
            </div>
          </DataPanel>
        )}
      </div>
    </AdminPage>
  );
}
