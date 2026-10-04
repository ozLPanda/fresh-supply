import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, KeyRound, Save, ShieldCheck, WalletCards } from "lucide-react";
import { AdminPage } from "@/layouts/AdminPage";
import { api } from "@/shared/api/http";
import { formatDateTime } from "@/shared/lib/dateTime";
import { Role, User, Wallet, WalletTransaction } from "@/shared/types/models";
import { formatMoney } from "@/pages/public/store-utils";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import {
  AppInput,
  AppMoneyInput,
  AppNumberInput,
  AppPhoneInput,
  AppSelect,
  AppTextarea,
} from "@/shared/ui/AppField";
import { AppModal, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppSwitch } from "@/shared/ui/AppControls";
import { AppTable } from "@/shared/ui/AppTable";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import "./UserDetailPage.css";

function walletTransactionLabel(type: WalletTransaction["type"]) {
  if (type === "CREDIT") return "Начисление";
  if (type === "DEBIT") return "Оплата";
  if (type === "REFUND") return "Возврат";
  if (type === "PRICE_DEBIT") return "Доплата";
  return "Корректировка";
}

type UserProfileForm = {
  name: string;
  email: string;
  phone: string;
  active: boolean;
  personalDiscountPercent: string;
};

const emptyProfile: UserProfileForm = {
  name: "",
  email: "",
  phone: "",
  active: true,
  personalDiscountPercent: "0",
};

export function UserDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [roleIds, setRoleIds] = useState<string[] | null>(null);
  const [profile, setProfile] = useState<UserProfileForm>(emptyProfile);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const user = useQuery({
    queryKey: ["users", id],
    queryFn: () => api<User>(`/api/users/${id}`),
    enabled: Boolean(id),
  });
  const wallet = useQuery({
    queryKey: ["users", id, "wallet"],
    queryFn: () => api<Wallet>(`/api/admin/users/${id}/wallet`),
    enabled: Boolean(id),
  });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/api/roles") });
  useEffect(() => {
    if (!user.data) return;
    setProfile({
      name: user.data.name ?? "",
      email: user.data.email ?? "",
      phone: user.data.phone ?? "",
      active: user.data.active !== false,
      personalDiscountPercent: String(user.data.personalDiscountPercent ?? 0),
    });
  }, [user.data]);
  const credit = useMutation({
    mutationFn: () =>
      api<Wallet>(`/api/admin/users/${id}/wallet/credits`, {
        method: "POST",
        body: JSON.stringify({ amount, comment }),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(["users", id, "wallet"], result);
      setAmount(null);
      setComment("");
      appToast.success("Баланс начислен");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось начислить баланс",
      ),
  });
  const updateRoles = useMutation({
    mutationFn: () =>
      api<User>(`/api/users/${id}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roleIds: selectedRoleIds.map(Number) }),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(["users", id], result);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setRoleIds(null);
      appToast.success("Роли пользователя обновлены");
    },
    onError: (exception) =>
      appToast.error(exception instanceof Error ? exception.message : "Не удалось сохранить роли"),
  });
  const updateProfile = useMutation({
    mutationFn: () =>
      api<User>(`/api/users/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: profile.name.trim(),
          email: profile.email.trim().toLowerCase() || null,
          phone: profile.phone,
          active: profile.active,
          personalDiscountPercent: Number(profile.personalDiscountPercent),
        }),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(["users", id], result);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      appToast.success("Данные пользователя сохранены");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось сохранить данные пользователя",
      ),
  });
  const updatePassword = useMutation({
    mutationFn: () =>
      api<User>(`/api/users/${id}/password`, {
        method: "PATCH",
        body: JSON.stringify({ newPassword }),
      }),
    onSuccess: () => {
      setNewPassword("");
      setPasswordConfirmation("");
      setPasswordOpen(false);
      appToast.success("Пароль пользователя изменён");
    },
    onError: (exception) =>
      appToast.error(exception instanceof Error ? exception.message : "Не удалось изменить пароль"),
  });

  const selectedRoleIds = roleIds ?? (user.data?.roleIds ?? []).map(String);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!amount || !comment.trim()) return;
    credit.mutate();
  }

  function submitRoles(event: FormEvent) {
    event.preventDefault();
    updateRoles.mutate();
  }

  function submitProfile(event: FormEvent) {
    event.preventDefault();
    if (!profile.name.trim()) {
      appToast.error("Укажите имя пользователя");
      return;
    }
    if (!profile.phone.trim()) {
      appToast.error("Укажите номер телефона");
      return;
    }
    const personalDiscountPercent = Number(profile.personalDiscountPercent);
    if (
      !Number.isFinite(personalDiscountPercent) ||
      personalDiscountPercent < 0 ||
      personalDiscountPercent > 100
    ) {
      appToast.error("Размер скидки должен быть от 0 до 100%");
      return;
    }
    updateProfile.mutate();
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) {
      appToast.error("Пароль должен содержать не менее 8 символов");
      return;
    }
    if (newPassword !== passwordConfirmation) {
      appToast.error("Пароли не совпадают");
      return;
    }
    updatePassword.mutate();
  }

  function closePassword(open: boolean) {
    if (open || updatePassword.isPending) {
      setPasswordOpen(open);
      return;
    }
    setPasswordOpen(false);
    setNewPassword("");
    setPasswordConfirmation("");
  }

  return (
    <AdminPage
      title={user.data?.name ?? "Клиент"}
      eyebrow="Пользователи"
      backAction={
        <AppButton asChild variant="ghost">
          <Link to="/admin/users" aria-label="Назад к пользователям">
            <ArrowLeft size={18} />
          </Link>
        </AppButton>
      }
    >
      {user.isLoading || wallet.isLoading ? (
        <AppCard>
          <AppSkeleton />
        </AppCard>
      ) : (
        <>
          <div className="user-detail-grid dashboard-grid two">
            <DataPanel
              title="Данные пользователя"
              size="compact"
              actions={
                <AppBadge tone={profile.active ? "green" : "red"}>
                  {profile.active ? "Активен" : "Отключён"}
                </AppBadge>
              }
            >
              <form className="user-profile-form" onSubmit={submitProfile}>
                <div className="user-profile-form__fields">
                  <AppInput
                    label="Имя"
                    value={profile.name}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, name: event.target.value }))
                    }
                    maxLength={160}
                    required
                    autoComplete="name"
                  />
                  <AppInput
                    label="Email"
                    type="email"
                    value={profile.email}
                    onChange={(event) =>
                      setProfile((current) => ({ ...current, email: event.target.value }))
                    }
                    maxLength={180}
                    autoComplete="email"
                  />
                  <AppPhoneInput
                    label="Телефон"
                    value={profile.phone}
                    onValueChange={(phone) => setProfile((current) => ({ ...current, phone }))}
                    maxLength={40}
                    required
                  />
                  <AppNumberInput
                    label="Персональная скидка"
                    hint="Показывается клиенту в витрине и применяется при оформлении заказа."
                    value={profile.personalDiscountPercent}
                    onChange={(event) =>
                      setProfile((current) => ({
                        ...current,
                        personalDiscountPercent: event.target.value,
                      }))
                    }
                    min={0}
                    max={100}
                    step={0.01}
                    suffix="%"
                    disabled={updateProfile.isPending}
                  />
                </div>
                <AppSwitch
                  label="Активная учётная запись"
                  description="Отключённый пользователь не сможет войти в систему."
                  checked={profile.active}
                  onCheckedChange={(active) => setProfile((current) => ({ ...current, active }))}
                  disabled={updateProfile.isPending}
                />
                <div className="user-profile-form__actions">
                  <AppButton type="submit" loading={updateProfile.isPending}>
                    <Save size={17} aria-hidden="true" />
                    Сохранить данные
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={() => setPasswordOpen(true)}
                  >
                    <KeyRound size={17} aria-hidden="true" />
                    Изменить пароль
                  </AppButton>
                </div>
              </form>
              <form className="user-roles-form" onSubmit={submitRoles}>
                <AppSelect
                  label="Роли"
                  hint="Права из выбранных ролей применяются вместе."
                  options={(roles.data ?? []).map((role) => ({
                    value: String(role.id),
                    label: `${role.nameRu}${role.active ? "" : " — отключена"}`,
                  }))}
                  value={selectedRoleIds}
                  onValueChange={(value) => setRoleIds(value as string[])}
                  multiple
                  searchable
                  multipleValueDisplay="count"
                  showSelectedTags={false}
                  placeholder={roles.isLoading ? "Загрузка ролей…" : "Без назначенных ролей"}
                  disabled={roles.isLoading || roles.isError || updateRoles.isPending}
                  error={roles.isError ? "Не удалось загрузить роли" : undefined}
                />
                <AppButton
                  type="submit"
                  variant="primary"
                  className="user-roles-form__save"
                  aria-label="Сохранить роли"
                  loading={updateRoles.isPending}
                  disabled={roles.isLoading || roles.isError}
                >
                  <Save size={18} aria-hidden="true" />
                  Сохранить роли
                </AppButton>
              </form>
            </DataPanel>

            <DataPanel title="Баланс" size="compact">
              <p className="admin-big-value">{formatMoney(wallet.data?.balance ?? 0)}</p>
              <form className="admin-compact-form" onSubmit={submit}>
                <AppMoneyInput
                  label="Сумма начисления"
                  value={amount}
                  onValueChange={setAmount}
                  min={0.01}
                  required
                />
                <AppTextarea
                  label="Комментарий"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  required
                />
                <AppButton type="submit" loading={credit.isPending}>
                  Начислить
                </AppButton>
              </form>
            </DataPanel>
          </div>

          <DataPanel title="История операций" className="user-wallet-history">
            {wallet.data?.transactions.length ? (
              <AppTable
                size="compact"
                headers={["Дата", "Тип", "Комментарий", "Сумма", "Баланс"]}
                rows={wallet.data.transactions.map((transaction) => [
                  formatDateTime(transaction.createdAt),
                  walletTransactionLabel(transaction.type),
                  transaction.comment,
                  formatMoney(transaction.amount),
                  formatMoney(transaction.balanceAfter),
                ])}
              />
            ) : (
              <div className="user-wallet-history__empty">
                <span className="user-wallet-history__empty-icon" aria-hidden="true">
                  <WalletCards size={28} />
                </span>
                <div>
                  <strong>Операций пока нет</strong>
                  <p>Здесь появятся начисления, оплаты, доплаты и возвраты по балансу клиента.</p>
                </div>
              </div>
            )}
          </DataPanel>
        </>
      )}

      <AppModal
        open={passwordOpen}
        onOpenChange={closePassword}
        title="Изменить пароль"
        description="Новый пароль не отображается и не сохраняется в браузере. Пользователь сможет войти с ним сразу после изменения."
        contentClassName="user-password-modal"
      >
        <form className="user-password-form" onSubmit={submitPassword}>
          <div className="user-password-form__notice">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>Пароль должен содержать не менее 8 символов.</span>
          </div>
          <AppInput
            label="Новый пароль"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            minLength={8}
            maxLength={100}
            required
            autoComplete="new-password"
            autoFocus
          />
          <AppInput
            label="Повторите новый пароль"
            type="password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            minLength={8}
            maxLength={100}
            error={
              passwordConfirmation && passwordConfirmation !== newPassword
                ? "Пароли не совпадают"
                : undefined
            }
            required
            autoComplete="new-password"
          />
          <div className="user-password-form__actions">
            <AppButton type="button" variant="secondary" onClick={() => closePassword(false)}>
              Отмена
            </AppButton>
            <AppButton type="submit" loading={updatePassword.isPending}>
              Изменить пароль
            </AppButton>
          </div>
        </form>
      </AppModal>
    </AdminPage>
  );
}
