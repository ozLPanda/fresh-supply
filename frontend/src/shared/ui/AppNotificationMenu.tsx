import { ReactNode, useState } from "react";
import { Bell, CheckCheck, PackageCheck, ShoppingBag } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationItem } from "@/shared/types/models";
import { formatDateTime } from "@/shared/lib/dateTime";
import { AppButton } from "@/shared/ui/AppButton";
import { AppSkeleton } from "@/shared/ui/AppFeedback";
import "./AppNotificationMenu.css";

export function AppNotificationMenu({
  items,
  unreadCount,
  loading = false,
  onSelect,
  onMarkAllRead,
  onOpenChange,
  footer,
}: {
  items: NotificationItem[];
  unreadCount: number;
  loading?: boolean;
  onSelect: (item: NotificationItem) => void;
  onMarkAllRead: () => void;
  onOpenChange?: (open: boolean) => void;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function unreadLabel(count: number) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 19) return `${count} непрочитанных`;
    if (mod10 === 1) return `${count} непрочитанное`;
    return `${count} непрочитанных`;
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <AppButton
          type="button"
          variant="ghost"
          className="app-notifications__trigger"
          aria-label={unreadCount ? `Уведомления: ${unreadLabel(unreadCount)}` : "Уведомления"}
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="app-notifications__count">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </AppButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="app-notifications" aria-label="Центр уведомлений">
        <header className="app-notifications__header">
          <div>
            <strong>Уведомления</strong>
            <span>{unreadCount > 0 ? unreadLabel(unreadCount) : "Всё прочитано"}</span>
          </div>
          {unreadCount > 0 && (
            <AppButton
              type="button"
              variant="ghost"
              className="app-notifications__read-all"
              onClick={onMarkAllRead}
            >
              <CheckCheck size={16} />
              Прочитать все
            </AppButton>
          )}
        </header>

        <div className="app-notifications__list">
          {loading ? (
            <div className="app-notifications__loading">
              <AppSkeleton />
              <AppSkeleton />
            </div>
          ) : items.length ? (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-notifications__item ${item.read ? "" : "is-unread"}`}
                onClick={() => {
                  changeOpen(false);
                  onSelect(item);
                }}
              >
                <span className="app-notifications__icon" aria-hidden="true">
                  {item.type === "NEW_ORDER" ? (
                    <ShoppingBag size={18} />
                  ) : (
                    <PackageCheck size={18} />
                  )}
                </span>
                <span className="app-notifications__body">
                  <strong>{item.title}</strong>
                  {item.displayCode && <span>Заказ № {item.displayCode}</span>}
                  <span>{item.message}</span>
                  <time dateTime={item.createdAt}>
                    {formatDateTime(item.createdAt, {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
                {!item.read && (
                  <span className="app-notifications__unread-dot" aria-label="Непрочитано" />
                )}
              </button>
            ))
          ) : (
            <div className="app-notifications__empty">
              <Bell size={24} />
              <strong>Уведомлений пока нет</strong>
              <span>Здесь появятся события по заказам.</span>
            </div>
          )}
        </div>
        {footer && <footer className="app-notifications__footer">{footer}</footer>}
      </PopoverContent>
    </Popover>
  );
}
