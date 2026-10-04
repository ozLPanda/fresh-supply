import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/shared/api/http";
import { syncPushSubscription, waitForPushWorker } from "./pushSubscription";

export type AdminPushStatus =
  | "checking"
  | "available"
  | "connecting"
  | "connected"
  | "blocked"
  | "not-configured"
  | "unsupported"
  | "error";

export type AdminPushState = { status: AdminPushStatus; message?: string };

function supportsPush() {
  return (
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function useAdminPush(enabled: boolean, userId?: number) {
  const [connection, setConnection] = useState<{ userId?: number; state: AdminPushState }>({
    state: { status: "checking" },
  });
  const operation = useRef<AbortController>();
  const busy = useRef(false);

  const connect = useCallback(
    async (askPermission: boolean): Promise<NotificationPermission | undefined> => {
      if (!enabled || !userId || busy.current) return;
      if (!supportsPush()) {
        setConnection({ userId, state: { status: "unsupported" } });
        return;
      }
      operation.current?.abort();
      const controller = new AbortController();
      operation.current = controller;
      const { signal } = controller;
      const setState = (state: AdminPushState) => {
        if (operation.current === controller) setConnection({ userId, state });
      };
      busy.current = true;
      setState({ status: askPermission ? "connecting" : "checking" });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        // Call before the first await so Android receives the click's user activation.
        const permission =
          askPermission && Notification.permission === "default"
            ? await Notification.requestPermission()
            : Notification.permission;
        signal.throwIfAborted();
        if (permission === "denied") {
          setState({ status: "blocked" });
          return permission;
        }
        if (askPermission && permission === "default") {
          setState({ status: "available" });
          return permission;
        }
        timeout = setTimeout(() => controller.abort(), 20_000);
        const { publicKey } = await api<{ publicKey: string }>(
          "/api/notifications/push-public-key",
          {
            signal,
          },
        );
        signal.throwIfAborted();
        if (!publicKey) {
          setState({ status: "not-configured" });
          return;
        }
        if (permission !== "granted") {
          setState({ status: "available" });
          return permission;
        }
        setState({ status: "connecting" });
        const registration = await waitForPushWorker(navigator.serviceWorker.ready, signal);
        signal.throwIfAborted();
        const payload = await syncPushSubscription(registration.pushManager, publicKey, signal);
        signal.throwIfAborted();
        await api<void>("/api/notifications/push-subscriptions", {
          method: "POST",
          body: JSON.stringify(payload),
          signal,
        });
        signal.throwIfAborted();
        setState({ status: "connected" });
        return permission;
      } catch (error) {
        if (operation.current !== controller) return;
        setState({
          status: Notification.permission === "denied" ? "blocked" : "error",
          message: signal.aborted
            ? "Подключение заняло слишком много времени. Проверьте интернет и попробуйте снова."
            : error instanceof Error
              ? error.message
              : "Не удалось подключить уведомления. Попробуйте ещё раз.",
        });
      } finally {
        clearTimeout(timeout);
        if (operation.current === controller) busy.current = false;
      }
    },
    [enabled, userId],
  );

  useEffect(() => {
    busy.current = false;
    if (enabled && userId) void connect(false);
    return () => {
      const previous = operation.current;
      operation.current = undefined;
      previous?.abort();
      busy.current = false;
    };
  }, [enabled, userId, connect]);

  const refresh = useCallback(() => void connect(false), [connect]);
  const state: AdminPushState =
    connection.userId === userId ? connection.state : { status: "checking" };

  return {
    state,
    connect: () => connect(true),
    refresh,
  };
}
