import { type ComponentPropsWithoutRef, ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, RotateCcw, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "./AppFeedback.css";

export function AppAlert({
  title,
  children,
  tone = "info",
  onRetry,
  retryLabel = "Повторить",
}: {
  title: string;
  children?: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const icons = {
    info: <Info size={20} />,
    success: <CheckCircle2 size={20} />,
    warning: <TriangleAlert size={20} />,
    danger: <AlertCircle size={20} />,
  };

  return (
    <div className={`app-alert ${tone}`} role="status">
      {icons[tone]}
      <div className="app-alert__content">
        <b>{title}</b>
        {children && <p>{children}</p>}
      </div>
      {onRetry && (
        <AppTooltip content={retryLabel}>
          <button
            type="button"
            className="app-alert__retry"
            aria-label={retryLabel}
            onClick={onRetry}
          >
            <RotateCcw size={15} />
          </button>
        </AppTooltip>
      )}
    </div>
  );
}

export function AppModal({
  trigger,
  title,
  description,
  children,
  open,
  defaultOpen,
  onOpenChange,
  onInteractOutside,
  contentClassName = "",
}: {
  trigger?: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onInteractOutside?: ComponentPropsWithoutRef<typeof DialogContent>["onInteractOutside"];
  contentClassName?: string;
}) {
  const content = (
    <DialogContent className={contentClassName} onInteractOutside={onInteractOutside}>
      <div className="app-modal__header">
        <DialogTitle className="app-modal-title">{title}</DialogTitle>
        {description && (
          <DialogDescription className="app-modal-description">{description}</DialogDescription>
        )}
      </div>
      {children}
    </DialogContent>
  );

  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      {content}
    </Dialog>
  );
}

export function AppTooltip({ children, content }: { children: ReactNode; content: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AppSkeleton() {
  return (
    <div className="app-skeleton-stack">
      <Skeleton className="app-skeleton-line app-skeleton-line--title" />
      <Skeleton className="app-skeleton-line" />
      <Skeleton className="app-skeleton-line app-skeleton-line--short" />
    </div>
  );
}
