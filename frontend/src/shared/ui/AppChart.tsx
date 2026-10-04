import { CSSProperties, ReactNode, useId, useMemo, useState } from "react";
import {
  Legend,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  type TooltipProps,
} from "recharts";
import "./AppChart.css";

export const appChartColors = {
  orange: "var(--chart-orange, #ff6b13)",
  blue: "var(--chart-blue, #2563eb)",
  green: "var(--chart-green, #10b981)",
  violet: "var(--chart-violet, #7c3aed)",
  cyan: "var(--chart-cyan, #0891b2)",
  rose: "var(--chart-rose, #e11d48)",
  slate: "var(--chart-slate, #64748b)",
} as const;

export type AppChartLegendItem = {
  key: string;
  label: string;
  color: string;
};

export function AppChart({
  title,
  description,
  height = 320,
  className = "",
  style,
  children,
}: {
  title: string;
  description?: string;
  height?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <figure
      className={`app-chart ${className}`}
      style={{ "--app-chart-height": `${height}px`, ...style } as CSSProperties}
      role="img"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <figcaption className="app-chart__a11y">
        <strong id={titleId}>{title}</strong>
        {description && <span id={descriptionId}>{description}</span>}
      </figcaption>
      <div className="app-chart__viewport">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function DefaultTooltipContent({
  active,
  label,
  payload,
  formatter,
  labelFormatter,
}: TooltipContentProps<any, any> & {
  formatter?: AppChartTooltipFormatter;
  labelFormatter?: AppChartTooltipLabelFormatter;
}) {
  if (!active || !payload?.length) return null;
  const visiblePayload = payload.filter((item) => item.value !== undefined && item.value !== null);

  return (
    <div className="app-chart-tooltip">
      {label !== undefined && (
        <strong>{labelFormatter ? labelFormatter(label, payload) : String(label)}</strong>
      )}
      <div>
        {visiblePayload.map((item, index) => {
          const formatted = formatter
            ? formatter(item.value, String(item.name), item, index, payload)
            : item.value;
          const [value, name] = Array.isArray(formatted)
            ? formatted
            : [formatted, item.name ?? item.dataKey];

          return (
            <span key={`${String(item.dataKey)}-${index}`}>
              <i style={{ background: item.color }} />
              <b>{String(name)}</b>
              <em>{value as ReactNode}</em>
            </span>
          );
        })}
      </div>
    </div>
  );
}

type AppChartTooltipFormatter = (
  value: unknown,
  name: string,
  item: unknown,
  index: number,
  payload: readonly unknown[],
) => ReactNode | [ReactNode, ReactNode];

type AppChartTooltipLabelFormatter = (label: unknown, payload: readonly unknown[]) => ReactNode;

type AppChartTooltipProps = Omit<
  TooltipProps<any, any>,
  "content" | "formatter" | "labelFormatter"
> & {
  formatter?: AppChartTooltipFormatter;
  labelFormatter?: AppChartTooltipLabelFormatter;
};

export function AppChartTooltip({ formatter, labelFormatter, ...props }: AppChartTooltipProps) {
  return (
    <Tooltip
      cursor={{ fill: "rgba(148, 163, 184, 0.12)", stroke: "rgba(100, 116, 139, 0.2)" }}
      isAnimationActive="auto"
      content={(contentProps) => (
        <DefaultTooltipContent
          {...contentProps}
          formatter={formatter}
          labelFormatter={labelFormatter}
        />
      )}
      {...props}
    />
  );
}

export function useAppChartLegend(initiallyHidden: string[] = []) {
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set(initiallyHidden));

  return useMemo(
    () => ({
      hiddenKeys,
      isHidden: (key: string) => hiddenKeys.has(key),
      toggle: (key: string) =>
        setHiddenKeys((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        }),
    }),
    [hiddenKeys],
  );
}

export function AppChartLegend({
  items,
  hiddenKeys,
  onToggle,
}: {
  items: AppChartLegendItem[];
  hiddenKeys?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
}) {
  return (
    <Legend
      verticalAlign="bottom"
      height={38}
      content={() => (
        <div className="app-chart-legend" role="group" aria-label="Легенда графика">
          {items.map((item) => {
            const hidden = hiddenKeys?.has(item.key) ?? false;
            return (
              <button
                type="button"
                key={item.key}
                className={hidden ? "is-hidden" : ""}
                aria-pressed={!hidden}
                onClick={() => onToggle?.(item.key)}
              >
                <i style={{ background: item.color }} />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    />
  );
}
