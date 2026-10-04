import { PointerEvent, ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripHorizontal, X } from "lucide-react";
import "./AppFloatingWindow.css";

type FloatingWindowPosition = { left: number; top: number };

export function AppFloatingWindow({
  open,
  title,
  children,
  onOpenChange,
  initialWidth = 560,
  initialHeight = 480,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  initialWidth?: number;
  initialHeight?: number;
}) {
  const [position, setPosition] = useState<FloatingWindowPosition>({ left: 48, top: 96 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  function startDrag(event: PointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    event.preventDefault();
    dragCleanupRef.current?.();

    const windowElement = event.currentTarget.closest<HTMLElement>(".app-floating-window");
    if (!windowElement) return;
    const bounds = windowElement.getBoundingClientRect();
    const start = { left: bounds.left, top: bounds.top, x: event.clientX, y: event.clientY };
    const move = (moveEvent: globalThis.PointerEvent) => {
      const currentBounds = windowElement.getBoundingClientRect();
      setPosition({
        left: Math.max(
          0,
          Math.min(
            start.left + moveEvent.clientX - start.x,
            window.innerWidth - currentBounds.width,
          ),
        ),
        top: Math.max(
          0,
          Math.min(
            start.top + moveEvent.clientY - start.y,
            window.innerHeight - currentBounds.height,
          ),
        ),
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <section
      className="app-floating-window"
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={{ left: position.left, top: position.top, width: initialWidth, height: initialHeight }}
    >
      <header className="app-floating-window__titlebar" onPointerDown={startDrag}>
        <GripHorizontal size={18} aria-hidden="true" />
        <b>{title}</b>
        <button
          type="button"
          aria-label="Закрыть окно"
          title="Закрыть"
          onClick={() => onOpenChange(false)}
        >
          <X size={19} />
        </button>
      </header>
      <div className="app-floating-window__body">{children}</div>
    </section>,
    document.body,
  );
}
