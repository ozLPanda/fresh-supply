import { FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { StoreLayout } from "@/layouts/StoreLayout";
import { api } from "@/shared/api/http";
import { formatDateTime } from "@/shared/lib/dateTime";
import { Wallet, WalletTransaction } from "@/shared/types/models";
import { formatMoney } from "@/pages/public/store-utils";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppInput, AppPhoneInput } from "@/shared/ui/AppField";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppTable } from "@/shared/ui/AppTable";
import "./CommercePages.css";

function walletTransactionLabel(type: WalletTransaction["type"]) {
  if (type === "CREDIT") return "Начисление";
  if (type === "DEBIT") return "Оплата";
  if (type === "REFUND") return "Возврат";
  if (type === "PRICE_DEBIT") return "Доплата";
  return "Корректировка";
}

function walletTransactionTone(type: WalletTransaction["type"]) {
  if (type === "CREDIT") return "green";
  if (type === "REFUND" || type === "PRICE_REFUND") return "blue";
  return "orange";
}

function walletTransactionSign(type: WalletTransaction["type"]) {
  return type === "DEBIT" || type === "PRICE_DEBIT" ? "−" : "+";
}

export function ProfilePage() {
  const { user, authLoading, refreshUser } = useCommerce();
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [message, setMessage] = useState("");
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => api<Wallet>("/api/wallet"),
    enabled: Boolean(user),
  });

  useEffect(() => {
    setName(user?.name ?? "");
    setPhone(user?.phone ?? "");
  }, [user]);

  if (authLoading) return null;
  if (!user) return <Navigate to="/login" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    await api("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify({ name, phone }),
    });
    await refreshUser();
    setMessage("Профиль обновлён");
  }

  return (
    <StoreLayout>
      <section className="commerce-page">
        <header className="commerce-heading commerce-heading--actions">
          <div>
            <p className="commerce-eyebrow">Личный кабинет</p>
            <h1>{user.name}</h1>
          </div>
          <div>
            <AppButton asChild variant="secondary">
              <Link to="/orders">Мои заказы</Link>
            </AppButton>
            {user.adminAccess && (
              <AppButton asChild>
                <Link to="/admin">Админка</Link>
              </AppButton>
            )}
          </div>
        </header>
        <div className="commerce-profile-grid">
          <AppCard title="Настройки профиля">
            <form className="commerce-form" onSubmit={submit}>
              <AppInput
                label="Имя"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
              <AppInput label="Email" value={user.email ?? "Не указан"} disabled />
              <AppPhoneInput label="Телефон" value={phone} onValueChange={setPhone} required />
              {message && <AppAlert title={message} tone="success" />}
              <AppButton type="submit">Сохранить</AppButton>
            </form>
          </AppCard>
          <AppCard className="commerce-balance-card" title="Баланс">
            <strong>{formatMoney(wallet.data?.balance ?? user.balance)}</strong>
            <p>Средства используются для оплаты заказов в магазине.</p>
          </AppCard>
        </div>
        <AppCard title="История баланса">
          {wallet.isLoading ? (
            <AppSkeleton />
          ) : wallet.data?.transactions.length ? (
            <AppTable
              headers={["Дата", "Операция", "Комментарий", "Сумма", "Баланс"]}
              rows={wallet.data.transactions.map((transaction) => [
                formatDateTime(transaction.createdAt),
                <AppBadge tone={walletTransactionTone(transaction.type)}>
                  {walletTransactionLabel(transaction.type)}
                </AppBadge>,
                transaction.comment,
                `${walletTransactionSign(transaction.type)}${formatMoney(transaction.amount)}`,
                formatMoney(transaction.balanceAfter),
              ])}
            />
          ) : (
            <p className="muted">Операций пока нет.</p>
          )}
        </AppCard>
      </section>
    </StoreLayout>
  );
}
