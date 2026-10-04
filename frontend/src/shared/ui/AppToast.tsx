import { useEffect, useState } from "react";
import { toast, Toaster, type ExternalToast } from "sonner";
import "./AppToast.css";

const mobileMediaQuery = "(max-width: 640px)";

function useMobileToastPosition() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(mobileMediaQuery).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(mobileMediaQuery);
    const syncPosition = () => setIsMobile(mediaQuery.matches);

    syncPosition();
    mediaQuery.addEventListener("change", syncPosition);
    return () => mediaQuery.removeEventListener("change", syncPosition);
  }, []);

  return isMobile;
}

export function AppToaster() {
  const isMobile = useMobileToastPosition();

  return (
    <Toaster
      position={isMobile ? "bottom-center" : "top-right"}
      mobileOffset={{
        bottom: "calc(12px + env(safe-area-inset-bottom))",
        left: 12,
        right: 12,
      }}
      toastOptions={{
        className: "app-toast",
      }}
    />
  );
}

export const appToast = {
  dismiss: (id?: string | number) => toast.dismiss(id),
  success: (message: string, options?: ExternalToast) => toast.success(message, options),
  error: (message: string, options?: ExternalToast) => toast.error(message, options),
  info: (message: string, options?: ExternalToast) => toast.info(message, options),
};
