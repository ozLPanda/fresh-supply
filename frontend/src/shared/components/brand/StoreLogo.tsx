import "./StoreLogo.css";

export function StoreLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`store-logo-shell${compact ? " is-compact" : ""}`}>
      <img
        className="store-logo"
        src="/brand/gastroflow-logo.png"
        alt="GastroFlow — паназиатские продукты, овощи, фрукты, бакалея"
        width={1600}
        height={800}
      />
    </span>
  );
}
