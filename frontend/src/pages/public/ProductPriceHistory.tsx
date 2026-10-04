import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { fetchProductPriceHistory, type ProductPriceHistoryPeriod } from "@/shared/api/catalog";
import { ALMATY_TIME_ZONE } from "@/shared/lib/dateTime";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppChart, AppChartTooltip, appChartColors } from "@/shared/ui/AppChart";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { formatMoney } from "@/pages/public/store-utils";
import "./ProductPriceHistory.css";

const PERIODS: { value: ProductPriceHistoryPeriod; label: string }[] = [
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
  { value: "5years", label: "5 лет" },
  { value: "all", label: "Всё время" },
];

const chartDateFormatter = new Intl.DateTimeFormat("ru-KZ", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: ALMATY_TIME_ZONE,
});

export function ProductPriceHistory({ productId }: { productId: number }) {
  const [period, setPeriod] = useState<ProductPriceHistoryPeriod>("year");
  const historyQuery = useQuery({
    queryKey: ["product", productId, "price-history", period],
    queryFn: () => fetchProductPriceHistory(productId, period),
  });
  const chartData = useMemo(
    () =>
      (historyQuery.data?.points ?? []).map((point) => ({
        label: chartDateFormatter.format(new Date(point.changedAt)),
        price: point.newPrice,
      })),
    [historyQuery.data?.points],
  );

  return (
    <section className="product-price-history">
      <div className="product-price-history__toolbar">
        <SegmentedControl
          items={PERIODS}
          value={period}
          onValueChange={(value) => setPeriod(value as ProductPriceHistoryPeriod)}
          ariaLabel="Период истории цены"
        />
      </div>

      {historyQuery.isLoading ? (
        <div className="product-price-history__skeleton">
          <AppSkeleton />
        </div>
      ) : historyQuery.isError ? (
        <AppAlert
          title="Не удалось загрузить историю цены"
          tone="danger"
          onRetry={() => historyQuery.refetch()}
        >
          Попробуйте обновить данные ещё раз.
        </AppAlert>
      ) : chartData.length === 0 ? (
        <p className="product-price-history__empty">За выбранный период изменений цены не было.</p>
      ) : (
        <AppChart
          title="Динамика розничной цены"
          description="Изменения цены по завершённым импортам"
          height={280}
        >
          <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
            <defs>
              <linearGradient id="product-price-history-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={appChartColors.orange} stopOpacity={0.3} />
                <stop offset="100%" stopColor={appChartColors.orange} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis
              dataKey="price"
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={(value) =>
                new Intl.NumberFormat("ru-KZ", { notation: "compact" }).format(value)
              }
            />
            <AppChartTooltip
              formatter={(value) => [formatMoney(Number(value)), "Цена"]}
              labelFormatter={(label) => String(label)}
            />
            <Area
              type="stepAfter"
              dataKey="price"
              name="Цена"
              stroke={appChartColors.orange}
              strokeWidth={3}
              fill="url(#product-price-history-fill)"
              activeDot={{ r: 5 }}
              dot={{ r: 3, fill: appChartColors.orange, strokeWidth: 0 }}
            />
          </AreaChart>
        </AppChart>
      )}
    </section>
  );
}
