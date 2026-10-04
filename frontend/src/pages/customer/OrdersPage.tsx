import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { StoreLayout } from "@/layouts/StoreLayout";
import { api } from "@/shared/api/http";
import { formatDateTime } from "@/shared/lib/dateTime";
import { Order } from "@/shared/types/models";
import { formatMoney } from "@/pages/public/store-utils";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppSkeleton } from "@/shared/ui/AppFeedback";
import { StoreEmptyState } from "@/pages/public/StoreEmptyState";
import "./CommercePages.css";

export const orderStatusLabel: Record<Order["status"], string> = {
  NEW: "Новый",
  PRICE_REVIEW: "Уточнение цен",
  PROCESSING: "В работе",
  READY_FOR_PICKUP: "Готов к выдаче",
  COMPLETED: "Завершён",
  CANCELLED: "Отменён",
};

export const paymentStatusLabel: Record<Order["paymentStatus"], string> = {
  PENDING: "Ожидает оплаты",
  PAID: "Оплачено",
  REFUNDED: "Возвращено",
};

export const paymentMethodLabel: Record<Order["paymentMethod"], string> = {
  BALANCE: "С баланса",
  ON_RECEIPT: "При получении",
  CASH: "Наличный расчёт",
  CASHLESS: "Безналичный расчёт",
  KASPI_STORE: "Kaspi Магазин",
  MIXED: "Комбинированный расчёт",
};

export const cashlessPaymentTypeLabel = { TRANSFER: "Перевод", CARD: "Картой", QR: "QR" } as const;

export function orderStatusTone(status: Order["status"]) {
  if (status === "CANCELLED") return "red";
  if (status === "PRICE_REVIEW") return "orange";
  if (status === "READY_FOR_PICKUP" || status === "COMPLETED") return "green";
  return "blue";
}

export function OrdersPage() {
  const { user, authLoading } = useCommerce();
  const orders = useQuery({
    queryKey: ["orders", "mine"],
    queryFn: () => api<Order[]>("/api/orders"),
    enabled: Boolean(user),
  });

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <StoreLayout>
      <section className="commerce-page">
        <header className="commerce-heading">
          <p className="commerce-eyebrow">Личный кабинет</p>
          <h1>Мои заказы</h1>
        </header>
        {orders.isLoading ? (
          <AppCard>
            <AppSkeleton />
          </AppCard>
        ) : orders.data?.length ? (
          <div className="commerce-orders">
            {orders.data.map((order) => (
              <AppCard
                key={order.id}
                className="commerce-order-card"
                title={`Заказ № ${order.displayCode}`}
                description={formatDateTime(order.createdAt)}
                actions={
                  <AppBadge tone={orderStatusTone(order.status)}>
                    {orderStatusLabel[order.status]}
                  </AppBadge>
                }
              >
                <div className="commerce-order-card__summary">
                  <div>
                    <span>Позиций</span>
                    <strong>{order.items.length}</strong>
                  </div>
                  <div>
                    <span>Итого</span>
                    <strong>{formatMoney(order.total)}</strong>
                  </div>
                </div>
                <AppButton asChild variant="secondary">
                  <Link to={`/orders/${order.id}`}>Подробнее</Link>
                </AppButton>
              </AppCard>
            ))}
          </div>
        ) : (
          <StoreEmptyState
            title="Заказов пока нет"
            description="После оплаты заказ появится здесь."
            actionLabel="Перейти в каталог"
            onAction={() => (window.location.href = "/catalog")}
          />
        )}
      </section>
    </StoreLayout>
  );
}
