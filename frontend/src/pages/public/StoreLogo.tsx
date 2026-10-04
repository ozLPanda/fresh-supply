import "./StoreLogo.css";

export function StoreLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`store-logo-shell ${compact ? "is-compact" : ""}`}>
      <img className="store-logo" src="/logo-sidebar.svg" alt="Фирма Актив" />
    </span>
  );
}
