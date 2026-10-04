import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { StoreLayout } from "@/layouts/StoreLayout";
import { api } from "@/shared/api/http";
import { Order } from "@/shared/types/models";
import { formatMoney } from "@/pages/public/store-utils";
import { notificationsQueryKey } from "@/features/notifications/NotificationCenter";
import {
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
  paymentStatusLabel,
} from "./OrdersPage";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import "./CommercePages.css";

export function OrderDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user, authLoading, refreshUser } = useCommerce();
  const order = useQuery({
    queryKey: ["order", id],
    queryFn: () => api<Order>(`/api/orders/${id}`),
    enabled: Boolean(user && id),
  });
  const confirmPrices = useMutation({
    mutationFn: () => api<Order>(`/api/orders/${id}/price-confirmation`, { method: "POST" }),
    onSuccess: async (updatedOrder) => {
      queryClient.setQueryData(["order", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "mine"] });
      queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
      await refreshUser();
      appToast.success("Актуальные цены подтверждены");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось подтвердить цены",
      ),
  });

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" replace />;
  const madeToOrderItemCount = order.data?.items.filter((item) => item.madeToOrder).length ?? 0;
  const requiresStoreConfirmation =
    madeToOrderItemCount > 0 && order.data?.status === "NEW";

  return (
    <StoreLayout>
      <section className="commerce-page">
        <header className="commerce-heading commerce-heading--actions">
          <div>
            <p className="commerce-eyebrow">Мои заказы</p>
            <h1>{order.data ? `Заказ № ${order.data.displayCode}` : "Заказ"}</h1>
          </div>
          <AppButton asChild variant="secondary">
            <Link to="/orders">Все заказы</Link>
          </AppButton>
        </header>
        {order.isLoading || !order.data ? (
          <AppCard>
            <AppSkeleton />
          </AppCard>
        ) : (
          <>
            {requiresStoreConfirmation && (
              <AppAlert title="Заказ ожидает подтверждения магазина" tone="warning">
                В заказе есть товары под заказ. Мы проверим их наличие и свяжемся с вами, если
                потребуется изменить состав заказа или уточнить детали.
              </AppAlert>
            )}
            <div className="commerce-order-meta">
              <AppCard title="Статус">
                <AppBadge tone={orderStatusTone(order.data.status)}>
                  {orderStatusLabel[order.data.status]}
                </AppBadge>
                <p>
                  Оплата: {paymentStatusLabel[order.data.paymentStatus].toLocaleLowerCase("ru")}
                </p>
                <p>
                  Способ: {paymentMethodLabel[order.data.paymentMethod].toLocaleLowerCase("ru")}
                </p>
              </AppCard>
              <AppCard title="Получение">
                <strong>
                  {order.data.fulfillmentType === "DELIVERY" ? "Доставка" : "Самовывоз"}
                </strong>
                {order.data.address && <p>{order.data.address}</p>}
                {order.data.contactPhone && <p>{order.data.contactPhone}</p>}
              </AppCard>
              <AppCard title="Итого">
                <strong className="commerce-order-total">{formatMoney(order.data.total)}</strong>
              </AppCard>
            </div>
            {order.data.status === "PRICE_REVIEW" && (
              <AppAlert title="Цены заказа изменены" tone="warning">
                {order.data.paymentMethod === "BALANCE"
                  ? "Проверьте актуальные цены. После подтверждения система спишет доплату с баланса или вернёт разницу."
                  : "Проверьте актуальные цены. После подтверждения заказ останется с оплатой при получении."}
              </AppAlert>
            )}
            <AppCard
              title="Состав заказа"
              className="commerce-order-items-card"
              actions={
                <span className="commerce-order-items-card__count">
                  {order.data.items.length} поз.
                </span>
              }
            >
              <div className="commerce-order-items" role="list">
                {order.data.items.map((item) => {
                  const itemContent = (
                    <>
                      <div className="commerce-order-item__main">
                        <strong>{item.nameRu}</strong>
                        {item.madeToOrder && <AppBadge tone="orange">Под заказ</AppBadge>}
                        <span>Артикул: {item.sku}</span>
                      </div>
                      <div className="commerce-order-item__price">
                        <span>Цена</span>
                        {order.data.status === "PRICE_REVIEW" && (
                          <s>{formatMoney(item.confirmedUnitPrice)}</s>
                        )}
                        <strong>{formatMoney(item.unitPrice)}</strong>
                      </div>
                      <div className="commerce-order-item__quantity">
                        <span>Количество</span>
                        <strong>{item.quantity}</strong>
                      </div>
                      <div className="commerce-order-item__total">
                        <span>Сумма</span>
                        <strong>{formatMoney(item.lineTotal)}</strong>
                      </div>
                    </>
                  );

                  return item.productId ? (
                    <Link
                      key={item.id}
                      className="commerce-order-item commerce-order-item--link"
                      to={`/product/${item.productId}`}
                      role="listitem"
                      aria-label={`Открыть товар: ${item.nameRu}`}
                    >
                      {itemContent}
                    </Link>
                  ) : (
                    <article key={item.id} className="commerce-order-item" role="listitem">
                      {itemContent}
                    </article>
                  );
                })}
              </div>
            </AppCard>
            {order.data.status === "PRICE_REVIEW" && (
              <AppCard title="Подтверждение цен">
                <div className="commerce-price-review">
                  <div>
                    <span>Оплачено</span>
                    <strong>{formatMoney(order.data.paidTotal)}</strong>
                  </div>
                  <div>
                    <span>Актуальная сумма</span>
                    <strong>{formatMoney(order.data.total)}</strong>
                  </div>
                  <div>
                    <span>
                      {order.data.total >= order.data.paidTotal ? "К доплате" : "К возврату"}
                    </span>
                    <strong>
                      {formatMoney(Math.abs(order.data.total - order.data.paidTotal))}
                    </strong>
                  </div>
                  <AppButton
                    type="button"
                    className="commerce-price-review__confirm"
                    loading={confirmPrices.isPending}
                    onClick={() => confirmPrices.mutate()}
                  >
                    Подтвердить цены
                  </AppButton>
                </div>
              </AppCard>
            )}
            {order.data.comment && <AppCard title="Комментарий">{order.data.comment}</AppCard>}
          </>
        )}
      </section>
    </StoreLayout>
  );
}
