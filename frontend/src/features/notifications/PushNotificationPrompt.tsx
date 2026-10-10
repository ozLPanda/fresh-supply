import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AppButton } from "@/shared/ui/AppButton";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { pushPromptSession } from "./pushPromptSession";
import { useAdminPush } from "./useAdminPush";
import "./PushNotificationPrompt.css";
const desktopMode = import.meta.env.VITE_DESKTOP_MODE === "true";

export function PushNotificationPrompt({ showPrompt = true }: { showPrompt?: boolean }) {
  const { user, authLoading } = useCommerce();
  const { pathname } = useLocation();
  const authPage = ["/login", "/register", "/admin/login"].includes(pathname);
  const enabled = Boolean(user) && !authPage;
  const push = useAdminPush(enabled, user?.id);
  const [promptUserId, setPromptUserId] = useState<number>();
  const { status, message } = push.state;

  useEffect(() => {
    if (!authLoading && !user) {
      pushPromptSession.reset();
      setPromptUserId(undefined);
    }
  }, [authLoading, user?.id]);

  useEffect(() => {
    if (status === "connected") setPromptUserId(undefined);
  }, [status]);

  useEffect(() => {
    if (!showPrompt || authLoading || !enabled || !user) return;
    if (["available", "blocked", "error"].includes(status) && pushPromptSession.claim(user.id)) {
      setPromptUserId(user.id);
    }
  }, [showPrompt, authLoading, enabled, user?.id, status, pathname]);

  useEffect(() => {
    if (
      pathname === "/admin/orders" ||
      pathname === "/checkout" ||
      pathname.startsWith("/orders/")
    ) {
      push.refresh();
    }
    // Route entry is a fallback opportunity; all triggers share the same session limit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, user?.id]);

  useEffect(() => {
    const refresh = () => push.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [push.refresh]);

  function dismiss() {
    setPromptUserId(undefined);
  }

  function connect() {
    // Keep the native permission request in this click's user activation.
    void push.connect().then((permission) => {
      if (permission === "default") dismiss();
    });
  }

  const loading = status === "checking" || status === "connecting";
  const blocked = status === "blocked";
  const open = Boolean(
    showPrompt && enabled && user && promptUserId === user.id && status !== "connected",
  );

  return (
    <AppModal
      open={open}
      onOpenChange={(next) => !next && dismiss()}
      title="Включить уведомления?"
      description={
        user?.permissions.includes("orders.read")
          ? desktopMode
            ? "Получайте уведомления о новых заказах, пока приложение открыто, в том числе в фоне."
            : "Получайте уведомления о новых заказах, даже когда приложение закрыто."
          : desktopMode
            ? "Получайте уведомления об изменении статуса и цен заказа, пока приложение открыто, в том числе в фоне."
            : "Получайте уведомления об изменении статуса и цен вашего заказа."
      }
      contentClassName="push-notification-prompt"
    >
      <div className="push-notification-prompt__content">
        {blocked ? (
          <AppAlert
            title={
              desktopMode ? "Разрешите уведомления приложения" : "Разрешите уведомления в браузере"
            }
            tone="warning"
          >
            {desktopMode
              ? "Откройте настройки уведомлений Windows или macOS и разрешите уведомления Ovoshi Help. Затем нажмите «Проверить снова»."
              : "Откройте настройки этого сайта в браузере и разрешите уведомления. Затем нажмите «Проверить снова»."}
          </AppAlert>
        ) : status === "error" ? (
          <AppAlert title="Не удалось подключить уведомления" tone="danger">
            {message || "Проверьте интернет и попробуйте ещё раз."}
          </AppAlert>
        ) : status === "not-configured" ? (
          <AppAlert title="Уведомления пока недоступны" tone="warning">
            Попробуйте подключить уведомления при следующем входе в приложение.
          </AppAlert>
        ) : null}
        <div className="push-notification-prompt__actions">
          <AppButton type="button" variant="secondary" onClick={dismiss}>
            Позже
          </AppButton>
          <AppButton
            type="button"
            onClick={connect}
            loading={loading}
            loadingText="Подключаем…"
            disabled={status === "not-configured" || status === "unsupported"}
          >
            {blocked || status === "error" ? "Проверить снова" : "Включить уведомления"}
          </AppButton>
        </div>
      </div>
    </AppModal>
  );
}
