import { SearchX, AlertTriangle } from "lucide-react";
import { AppButton } from "@/shared/ui/AppButton";
import { AppAlert } from "@/shared/ui/AppFeedback";
import "./StoreEmptyState.css";

export function StoreEmptyState({
  title,
  description,
  actionLabel,
  onAction,
  tone = "info",
  onRetry,
  retryLabel = "Повторить",
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "info" | "warning" | "danger";
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="store-empty-state">
      <div className="store-empty-state__icon">
        {tone === "warning" ? <AlertTriangle size={26} /> : <SearchX size={26} />}
      </div>
      <AppAlert title={title} tone={tone} onRetry={onRetry} retryLabel={retryLabel}>
        {description}
      </AppAlert>
      {actionLabel && onAction && (
        <AppButton type="button" variant="secondary" onClick={onAction}>
          {actionLabel}
        </AppButton>
      )}
    </div>
  );
}
