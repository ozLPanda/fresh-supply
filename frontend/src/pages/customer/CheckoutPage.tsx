import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { StoreLayout } from "@/layouts/StoreLayout";
import { api } from "@/shared/api/http";
import { Cart, Order } from "@/shared/types/models";
import { formatMoney } from "@/pages/public/store-utils";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppRadioGroup } from "@/shared/ui/AppControls";
import { AppInput, AppPhoneInput, AppTextarea } from "@/shared/ui/AppField";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { notificationsQueryKey } from "@/features/notifications/NotificationCenter";
import {
  clearCartItemSelection,
  readCartItemSelection,
  resolveCartItemSelection,
} from "@/features/commerce/cart-selection";
import {
  canUseCartDiscountPrices,
  readCartDiscountPricesEnabled,
  clearCartDiscountPricesEnabled,
} from "@/features/commerce/cart-price-mode";
import "./CommercePages.css";

export function CheckoutPage() {
  const { user, authLoading, cart, refreshCart, refreshUser } = useCommerce();
  const discountPricesEnabled =
    canUseCartDiscountPrices(user?.permissions) && readCartDiscountPricesEnabled(user?.id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fulfillmentType, setFulfillmentType] = useState("PICKUP");
  const [paymentMethod, setPaymentMethod] = useState<"BALANCE" | "ON_RECEIPT">("ON_RECEIPT");
  const [balanceSelectionAttempted, setBalanceSelectionAttempted] = useState(false);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selectedCartItemIds = useMemo(
    () => resolveCartItemSelection(cart.items, readCartItemSelection()),
    [cart.items],
  );
  const selectedCartItemIdSet = useMemo(() => new Set(selectedCartItemIds), [selectedCartItemIds]);
  const selectedItems = useMemo(
    () => cart.items.filter((item) => selectedCartItemIdSet.has(item.id)),
    [cart.items, selectedCartItemIdSet],
  );
  const selectedCartVersion = useMemo(
    () => selectedItems.map((item) => `${item.id}:${item.quantity}:${item.price}`).join("|"),
    [selectedItems],
  );
  const selectedCartPreview = useQuery({
    queryKey: ["cart-selection-preview", selectedCartVersion, discountPricesEnabled],
    queryFn: () =>
      api<Cart>("/api/cart/selection-preview", {
        method: "POST",
        body: JSON.stringify({
          cartItemIds: selectedCartItemIds,
          useDiscountPrices: discountPricesEnabled,
        }),
      }),
    enabled: Boolean(user && selectedCartItemIds.length),
  });
  const selectedTotal =
    selectedCartPreview.data?.total ?? selectedItems.reduce((sum, item) => sum + item.lineTotal, 0);

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" state={{ from: "/checkout" }} replace />;
  if (!cart.items.length) return <Navigate to="/cart" replace />;
  if (!selectedItems.length) return <Navigate to="/cart" replace />;
  const currentUserId = user.id;

  const insufficientBalance =
    paymentMethod === "BALANCE" && user.balance < selectedTotal && balanceSelectionAttempted;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const order = await api<Order>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          fulfillmentType,
          address,
          contactPhone: phone,
          comment,
          cartItemIds: selectedCartItemIds,
          paymentMethod,
          useDiscountPrices: discountPricesEnabled,
        }),
      });
      await Promise.all([refreshCart(), refreshUser()]);
      clearCartItemSelection();
      clearCartDiscountPricesEnabled(currentUserId);
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Не удалось оформить заказ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <StoreLayout>
      <section className="commerce-page">
        <header className="commerce-heading">
          <p className="commerce-eyebrow">Заказ</p>
          <h1>Оформление</h1>
        </header>
        <div className="commerce-checkout-layout">
          <AppCard title="Получение заказа">
            <form className="commerce-form" onSubmit={submit}>
              <AppRadioGroup
                label="Способ получения"
                value={fulfillmentType}
                onValueChange={setFulfillmentType}
                options={[
                  {
                    value: "PICKUP",
                    label: "Самовывоз",
                    description: "Забрать заказ самостоятельно",
                  },
                  {
                    value: "DELIVERY",
                    label: "Доставка",
                    description: "Доставим по указанному адресу",
                  },
                ]}
              />
              {fulfillmentType === "DELIVERY" && (
                <AppInput
                  label="Адрес доставки"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  required
                />
              )}
              <AppRadioGroup
                label="Способ оплаты"
                value={paymentMethod}
                onValueChange={(value) => {
                  const nextPaymentMethod = value as "BALANCE" | "ON_RECEIPT";
                  setPaymentMethod(nextPaymentMethod);
                  setBalanceSelectionAttempted(nextPaymentMethod === "BALANCE");
                  if (nextPaymentMethod !== "BALANCE") setError("");
                }}
                options={[
                  {
                    value: "ON_RECEIPT",
                    label: "При получении",
                    description: "Оплатите заказ при выдаче или доставке.",
                  },
                  {
                    value: "BALANCE",
                    label: "С баланса",
                    description: "Доступно: " + formatMoney(user.balance),
                  },
                ]}
              />
              {insufficientBalance && (
                <AppAlert title="Недостаточно средств на балансе" tone="warning">
                  Пополните баланс или выберите оплату при получении.
                </AppAlert>
              )}
              <AppPhoneInput
                label="Контактный телефон"
                value={phone}
                onValueChange={setPhone}
                required
              />
              <AppTextarea
                label="Комментарий"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                rows={4}
              />
              {error && (
                <AppAlert title="Не удалось оплатить заказ" tone="danger">
                  {error}
                </AppAlert>
              )}
              <AppButton
                type="submit"
                loading={loading || selectedCartPreview.isFetching}
                loadingText="Пересчитываем..."
                disabled={insufficientBalance || selectedCartPreview.isFetching}
              >
                {paymentMethod === "BALANCE"
                  ? "Оплатить " + formatMoney(selectedTotal)
                  : "Оформить заказ"}
              </AppButton>
            </form>
          </AppCard>
          <AppCard
            className="commerce-summary"
            title={paymentMethod === "BALANCE" ? "Оплата с баланса" : "Оплата при получении"}
          >
            {paymentMethod === "BALANCE" ? (
              <div>
                <span>Баланс</span>
                <b>{formatMoney(user.balance)}</b>
              </div>
            ) : (
              <div>
                <span>Способ оплаты</span>
                <b>При получении</b>
              </div>
            )}
            <div>
              <span>Сумма заказа</span>
              <b>{formatMoney(selectedTotal)}</b>
            </div>
            {paymentMethod === "BALANCE" && (
              <div className="commerce-summary__total">
                <span>Останется</span>
                <strong>{formatMoney(user.balance - selectedTotal)}</strong>
              </div>
            )}
            <AppButton asChild variant="secondary">
              <Link to="/cart">Вернуться в корзину</Link>
            </AppButton>
          </AppCard>
        </div>
      </section>
    </StoreLayout>
  );
}
