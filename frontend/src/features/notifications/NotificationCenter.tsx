import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/shared/api/http";
import { NotificationItem, NotificationList } from "@/shared/types/models";
import { AppNotificationMenu } from "@/shared/ui/AppNotificationMenu";

export const notificationsQueryKey = ["notifications", "mine"] as const;
const emptyNotifications: NotificationList = { items: [], unreadCount: 0 };

async function playNewOrderSound() {
  try {
    const context = new AudioContext();
    const now = context.currentTime;
    for (const offset of [0, 0.22]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.17);
    }
    window.setTimeout(() => void context.close(), 500);
  } catch {
    // The browser can block playback until the user has interacted with the page.
  }
}

async function fetchNotifications(): Promise<NotificationList> {
  try {
    return await api<NotificationList>("/api/notifications");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return emptyNotifications;
    throw error;
  }
}

export function NotificationCenter({ userId }: { userId?: number }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queryKey = [...notificationsQueryKey, userId] as const;
  const knownNotificationIds = useRef<Set<number> | null>(null);
  const query = useQuery({
    queryKey,
    queryFn: fetchNotifications,
    enabled: Boolean(userId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    const notifications = query.data;
    if (!notifications) return;
    const currentIds = new Set(notifications.items.map((item) => item.id));
    const knownIds = knownNotificationIds.current;
    knownNotificationIds.current = currentIds;
    if (
      knownIds &&
      notifications.items.some((item) => item.type === "NEW_ORDER" && !knownIds.has(item.id))
    ) {
      void playNewOrderSound();
    }
  }, [query.data]);

  const markRead = useMutation({
    mutationFn: (id: number) =>
      api<NotificationItem>(`/api/notifications/${id}/read`, {
        method: "POST",
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<NotificationList>(queryKey, (current) =>
        current
          ? {
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
              unreadCount: Math.max(
                0,
                current.unreadCount -
                  (current.items.find((item) => item.id === updated.id)?.read ? 0 : 1),
              ),
            }
          : current,
      );
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api<void>("/api/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData<NotificationList>(queryKey, (current) =>
        current
          ? {
              items: current.items.map((item) => ({
                ...item,
                read: true,
              })),
              unreadCount: 0,
            }
          : current,
      );
    },
  });

  function select(item: NotificationItem) {
    if (!item.read) markRead.mutate(item.id);
    if (item.actionUrl) navigate(item.actionUrl);
  }

  return (
    <AppNotificationMenu
      items={query.data?.items ?? []}
      unreadCount={query.data?.unreadCount ?? 0}
      loading={query.isLoading}
      onSelect={select}
      onMarkAllRead={() => markAllRead.mutate()}
      onOpenChange={(open) => {
        if (open) {
          void query.refetch();
        }
      }}
    />
  );
}
