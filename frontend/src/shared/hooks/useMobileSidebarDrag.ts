import {
  CSSProperties,
  Dispatch,
  RefObject,
  SetStateAction,
  TouchEvent as ReactTouchEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type SidebarDragOptions = {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  panelRef: RefObject<HTMLElement>;
  breakpoint?: number;
  edgeWidth?: number;
  fallbackWidth?: number;
};

type DragSession = {
  mode: "edge" | "panel";
  startX: number;
  startY: number;
  width: number;
  tracking: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function isMobileViewport(breakpoint: number) {
  return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
}

function isInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, button, a, [role='button']"));
}

export function useMobileSidebarDrag({
  open,
  setOpen,
  panelRef,
  breakpoint = 1024,
  edgeWidth = 28,
  fallbackWidth = 320,
}: SidebarDragOptions) {
  const [dragTranslate, setDragTranslate] = useState<number | null>(null);
  const dragTranslateRef = useRef<number | null>(null);
  const sessionRef = useRef<DragSession | null>(null);

  function getPanelWidth() {
    if (panelRef.current) return panelRef.current.getBoundingClientRect().width;
    return Math.max(240, Math.min(fallbackWidth, window.innerWidth - 40));
  }

  function updateDragTranslate(value: number | null) {
    dragTranslateRef.current = value;
    setDragTranslate(value);
  }

  function finishDrag(translate: number, width: number) {
    const progress = clamp((translate + width) / width, 0, 1);
    setOpen(progress >= 0.5);
    updateDragTranslate(null);
    sessionRef.current = null;
  }

  useEffect(() => {
    if (open) return;

    function handleTouchStart(event: TouchEvent) {
      if (!isMobileViewport(breakpoint) || event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX > edgeWidth || isInteractiveTarget(event.target)) return;

      const width = getPanelWidth();
      sessionRef.current = {
        mode: "edge",
        startX: touch.clientX,
        startY: touch.clientY,
        width,
        tracking: false,
      };
      updateDragTranslate(-width);
    }

    function handleTouchMove(event: TouchEvent) {
      const session = sessionRef.current;
      if (!session || session.mode !== "edge" || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - session.startX;
      const deltaY = touch.clientY - session.startY;

      if (!session.tracking) {
        if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) {
          sessionRef.current = null;
          updateDragTranslate(null);
          return;
        }
        if (deltaX < 8) return;
        session.tracking = true;
      }

      event.preventDefault();
      updateDragTranslate(clamp(-session.width + deltaX, -session.width, 0));
    }

    function handleTouchEnd() {
      const session = sessionRef.current;
      if (!session || session.mode !== "edge") return;
      finishDrag(dragTranslateRef.current ?? -session.width, session.width);
    }

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [breakpoint, edgeWidth, open, setOpen]);

  useEffect(() => {
    if (!open) return;
    updateDragTranslate(null);
    sessionRef.current = null;
  }, [open]);

  function handlePanelTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (!open || !isMobileViewport(breakpoint) || event.touches.length !== 1) return;
    const touch = event.touches[0];
    sessionRef.current = {
      mode: "panel",
      startX: touch.clientX,
      startY: touch.clientY,
      width: getPanelWidth(),
      tracking: false,
    };
  }

  useEffect(() => {
    if (!open) return;

    function handleTouchMove(event: TouchEvent) {
      const session = sessionRef.current;
      if (!session || session.mode !== "panel" || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaX = touch.clientX - session.startX;
      const deltaY = touch.clientY - session.startY;

      if (!session.tracking) {
        if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 8) {
          sessionRef.current = null;
          updateDragTranslate(null);
          return;
        }
        if (Math.abs(deltaX) < 8) return;
        session.tracking = true;
      }

      event.preventDefault();
      updateDragTranslate(clamp(deltaX, -session.width, 0));
    }

    function handleTouchEnd() {
      const session = sessionRef.current;
      if (!session || session.mode !== "panel") return;
      finishDrag(dragTranslateRef.current ?? 0, session.width);
    }

    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [breakpoint, open, setOpen]);

  const width = getPanelWidth();
  const translate = dragTranslate ?? (open ? 0 : -width);
  const progress = clamp((translate + width) / width, 0, 1);
  const isDragging = dragTranslate !== null;
  const shouldRender = open || isDragging;

  const sidebarStyle = useMemo<CSSProperties | undefined>(() => {
    if (!shouldRender) return undefined;
    return {
      transform: `translateX(${translate}px)`,
      transition: isDragging ? "none" : undefined,
    };
  }, [isDragging, shouldRender, translate]);

  const backdropStyle = useMemo<CSSProperties | undefined>(() => {
    if (!shouldRender) return undefined;
    return {
      opacity: progress,
      transition: isDragging ? "none" : undefined,
    };
  }, [isDragging, progress, shouldRender]);

  return {
    backdropStyle,
    handlePanelTouchStart,
    isDragging,
    shouldRender,
    sidebarStyle,
  };
}
