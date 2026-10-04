import { CSSProperties, ReactNode } from "react";
import { AppBadge } from "@/shared/ui/AppBadge";
import "./MetricCard.css";

export function MetricCard({
  icon,
  label,
  value,
  trend,
  actions,
  accent,
  size = "default",
  className = "",
  style,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  trend?: string;
  actions?: ReactNode;
  accent?: boolean;
  size?: "default" | "compact";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={`metric-card metric-card--${size} ${actions ? "metric-card--has-actions" : ""} ${accent ? "accent" : ""} ${className}`}
      style={style}
    >
      <div className="metric-card__top">
        <span className="metric-card__icon">{icon}</span>
        {trend && <AppBadge tone="green">{trend}</AppBadge>}
      </div>
      <div className="metric-card__content">
        <span className="metric-card__label">{label}</span>
        <strong className="metric-card__value">{value}</strong>
      </div>
      {actions && <div className="metric-card__actions">{actions}</div>}
    </section>
  );
}
