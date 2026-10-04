import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import "./AppContextMenu.css";

export type AppContextMenuAction = {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
  children?: AppContextMenuAction[];
};

export function AppContextMenu({
  open,
  x,
  y,
  actions,
  label = "Действия",
  onOpenChange,
}: {
  open: boolean;
  x: number;
  y: number;
  actions: AppContextMenuAction[];
  label?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [openSubmenuPath, setOpenSubmenuPath] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setOpenSubmenuPath(null);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const updateLayouts = () => {
      const padding = 8;
      const clamp = (value: number, size: number, limit: number) =>
        Math.max(padding, Math.min(value, limit - size - padding));
      const root = menuRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      root.style.left = `${clamp(x, rect.width, window.innerWidth)}px`;
      root.style.top = `${clamp(y, rect.height, window.innerHeight)}px`;

      // Apply parent positions before measuring descendants. Fixed panels escape
      // their ancestors' scrolling clips and never inflate a parent's scrollHeight.
      root.querySelectorAll<HTMLElement>("[data-app-context-menu-submenu]").forEach((node) => {
        const trigger = node.parentElement?.querySelector("button");
        const parentMenu = node.parentElement?.closest<HTMLElement>('[role="menu"]');
        if (!trigger || !parentMenu) return;
        const triggerRect = trigger.getBoundingClientRect();
        const parentRect = parentMenu.getBoundingClientRect();
        const panelRect = node.getBoundingClientRect();
        const rightSpace = window.innerWidth - padding - parentRect.right;
        const leftSpace = parentRect.left - padding;
        const preferLeft = parentMenu.dataset.side === "left";
        const side = preferLeft
          ? leftSpace >= panelRect.width || leftSpace >= rightSpace
            ? "left"
            : "right"
          : rightSpace >= panelRect.width || rightSpace >= leftSpace
            ? "right"
            : "left";
        node.dataset.side = side;
        node.style.left = `${clamp(
          side === "right" ? parentRect.right : parentRect.left - panelRect.width,
          panelRect.width,
          window.innerWidth,
        )}px`;
        node.style.top = `${clamp(triggerRect.top - 7, panelRect.height, window.innerHeight)}px`;
      });
    };
    updateLayouts();
    window.addEventListener("resize", updateLayouts);
    document.addEventListener("scroll", updateLayouts, true);
    return () => {
      window.removeEventListener("resize", updateLayouts);
      document.removeEventListener("scroll", updateLayouts, true);
    };
  }, [actions, open, openSubmenuPath, x, y]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.cancelAnimationFrame(frame);
    };
  }, [onOpenChange, open]);

  if (!open || actions.length === 0) return null;

  function renderActions(items: AppContextMenuAction[], ancestorPaths: string[] = []) {
    return items.map((action, index) => {
      const key = [...ancestorPaths, String(index)].join(".");
      const hasChildren = Boolean(action.children?.length);
      const submenuOpen =
        openSubmenuPath === key || Boolean(openSubmenuPath?.startsWith(`${key}.`));
      const openThisBranch = () => {
        if (action.disabled) return;
        setOpenSubmenuPath(
          hasChildren ? key : ancestorPaths.length ? ancestorPaths.join(".") : null,
        );
      };
      return (
        <div key={key} className="app-context-menu__group">
          {action.separatorBefore && (
            <span className="app-context-menu__separator" aria-hidden="true" />
          )}
          <button
            type="button"
            role="menuitem"
            className={action.destructive ? "is-destructive" : undefined}
            disabled={action.disabled}
            aria-haspopup={hasChildren ? "menu" : undefined}
            aria-expanded={hasChildren ? submenuOpen : undefined}
            onMouseEnter={openThisBranch}
            onFocus={openThisBranch}
            onClick={() => {
              if (hasChildren) {
                setOpenSubmenuPath(key);
                return;
              }
              onOpenChange(false);
              action.onSelect();
            }}
          >
            {action.icon}
            <span>{action.label}</span>
            {hasChildren && <ChevronRight className="app-context-menu__submenu-icon" size={16} />}
          </button>
          {hasChildren && submenuOpen && (
            <div
              className="app-context-menu__submenu"
              data-app-context-menu-submenu={key}
              role="menu"
              aria-label={action.label}
              style={
                {
                  "--app-context-menu-submenu-z-index": String(201 + ancestorPaths.length),
                } as CSSProperties
              }
            >
              {renderActions(action.children ?? [], [...ancestorPaths, String(index)])}
            </div>
          )}
        </div>
      );
    });
  }

  return createPortal(
    <div
      ref={menuRef}
      className="app-context-menu"
      role="menu"
      aria-label={label}
      style={
        {
          "--app-context-menu-x": `${x}px`,
          "--app-context-menu-y": `${y}px`,
        } as CSSProperties
      }
    >
      {renderActions(actions)}
    </div>,
    document.body,
  );
}
