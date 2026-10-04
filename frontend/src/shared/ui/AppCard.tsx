import { CSSProperties, ReactNode } from "react";
import "./AppCard.css";

export function AppCard({
  children,
  className = "",
  style,
  title,
  description,
  actions,
  footer,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  description?: string;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const structured = Boolean(title || description || actions || footer);

  return (
    <section
      className={`app-card ${structured ? "app-card--structured" : ""} ${className}`}
      style={style}
    >
      {(title || description || actions) && (
        <header className="app-card__header">
          <div>
            {title && <h3>{title}</h3>}
            {description && <p>{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={structured ? "app-card__content" : undefined}>{children}</div>
      {footer && <footer className="app-card__footer">{footer}</footer>}
    </section>
  );
}
