import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import { ChevronDown, LoaderCircle, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import "./AppButton.css";

export type AppButtonVariant = "primary" | "secondary" | "neutral" | "ghost" | "danger";

export type AppButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: AppButtonVariant;
  loading?: boolean;
  loadingText?: string;
  loadingMode?: "inline" | "spinner-only";
  asChild?: boolean;
};

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(
  function AppButton(buttonProps, ref) {
    const {
      variant = "primary",
      className = "",
      loading = false,
      loadingText,
      loadingMode = "inline",
      asChild = false,
      disabled,
      children,
      ...props
    } = buttonProps;
    const supportsLoading =
      Object.prototype.hasOwnProperty.call(buttonProps, "loading") ||
      Boolean(loadingText) ||
      loadingMode === "spinner-only";

    return (
      <Button
        ref={ref}
        asChild={asChild}
        className={`app-button ${variant} ${className}`}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {supportsLoading ? (
          <span className="app-button__layout">
            <span
              className={`app-button__state app-button__state--idle ${loading ? "is-hidden" : ""}`}
              aria-hidden={loading}
            >
              {children}
            </span>
            <span
              className={`app-button__state app-button__state--loading ${loading ? "" : "is-hidden"}`}
              aria-hidden={!loading}
            >
              <LoaderCircle className="app-spinner" size={18} aria-hidden="true" />
              {loadingMode === "inline" && (loadingText || children)}
            </span>
          </span>
        ) : (
          children
        )}
      </Button>
    );
  },
);

export type AppSplitButtonAction = {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
};

export function AppActionMenu({
  actions,
  label = "Действия",
}: {
  actions: AppSplitButtonAction[];
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AppButton type="button" variant="ghost" className="app-action-menu" aria-label={label}>
          <MoreHorizontal size={19} />
        </AppButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={action.disabled}
            onSelect={action.onSelect}
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSplitButton({
  children,
  actions,
  onClick,
  variant = "primary",
  loading,
  loadingText,
  disabled = false,
  menuLabel = "Другие действия",
}: {
  children: ReactNode;
  actions: AppSplitButtonAction[];
  onClick: () => void;
  variant?: AppButtonVariant;
  loading?: boolean;
  loadingText?: string;
  disabled?: boolean;
  menuLabel?: string;
}) {
  return (
    <div className={`app-split-button ${variant}`}>
      <AppButton
        type="button"
        variant={variant}
        onClick={onClick}
        {...(loading === undefined && loadingText === undefined ? {} : { loading, loadingText })}
        disabled={disabled}
      >
        {children}
      </AppButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <AppButton
            type="button"
            variant={variant}
            className="app-split-button__trigger"
            aria-label={menuLabel}
            disabled={disabled || loading}
          >
            <ChevronDown size={18} />
          </AppButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.label}
              disabled={action.disabled}
              onSelect={action.onSelect}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
