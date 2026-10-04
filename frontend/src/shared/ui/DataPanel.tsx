import { CSSProperties, ReactNode } from "react";
import "./DataPanel.css";

export function DataPanel({
  title,
  actions,
  children,
  size = "default",
  className = "",
  style,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  size?: "default" | "compact";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={`data-panel data-panel--${size} ${className}`} style={style}>
      <header className="data-panel__header">
        <h2>{title}</h2>
        {actions && <div className="data-panel__actions">{actions}</div>}
      </header>
      <div className="data-panel__content">{children}</div>
    </section>
  );
}
