import { ReactNode } from "react";
import "./AdminPage.css";

export function AdminPage({
  eyebrow = "Панель управления",
  title,
  backAction,
  actions,
  children,
  embedded = false,
  className,
}: {
  eyebrow?: string;
  title: string;
  backAction?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  embedded?: boolean;
  className?: string;
}) {
  if (embedded) {
    return (
      <div className="admin-page--embedded">
        {children}
        {actions && <footer className="admin-page--embedded__actions">{actions}</footer>}
      </div>
    );
  }

  return (
    <div className={["admin-page", className].filter(Boolean).join(" ")}>
      <header className="page-heading">
        <div className="page-heading__main">
          {backAction}
          <div>
            <p>{eyebrow}</p>
            <h1>{title}</h1>
          </div>
        </div>
        {actions && <div className="page-heading__actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
