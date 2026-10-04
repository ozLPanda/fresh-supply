import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, ShieldCheck, UserCheck, Users } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/shared/api/http";
import { Role, User } from "@/shared/types/models";
import { AdminPage } from "@/layouts/AdminPage";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppPhoneInput, AppInput, AppSelect } from "@/shared/ui/AppField";
import { AppModal } from "@/shared/ui/AppFeedback";
import { AppSwitch } from "@/shared/ui/AppControls";
import { appToast } from "@/shared/ui/AppToast";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./UsersPage.css";

type UserCreateForm = {
  name: string;
  email: string;
  phone: string;
  password: string;
  active: boolean;
  roleIds: string[];
};

const initialForm: UserCreateForm = {
  name: "",
  email: "",
  phone: "",
  password: "",
  active: true,
  roleIds: [],
};

export function UsersPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<UserCreateForm>(initialForm);
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/api/users") });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<Role[]>("/api/roles"),
    enabled: createOpen,
  });
  const data = users.data ?? [];
  const createUser = useMutation({
    mutationFn: () =>
      api<User>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase() || null,
          phone: form.phone.trim(),
          password: form.password,
          active: form.active,
          roleIds: form.roleIds.map(Number),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setForm(initialForm);
      setCreateOpen(false);
      appToast.success("Пользователь создан");
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось создать пользователя"),
  });

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.password.length < 8) {
      appToast.error("Пароль должен содержать не менее 8 символов");
      return;
    }
    createUser.mutate();
  }

  function closeCreate(open: boolean) {
    setCreateOpen(open);
    if (!open && !createUser.isPending) setForm(initialForm);
  }

  const columns: AppDataTableColumn<User>[] = [
    {
      id: "name",
      header: "Имя",
      accessor: "name",
      sortable: true,
      cell: (user) => <strong>{user.name}</strong>,
    },
    {
      id: "email",
      header: "Email",
      accessor: "email",
      sortable: true,
    },
    {
      id: "phone",
      header: "Телефон",
      accessor: "phone",
      cell: (user) => user.phone || "Не указан",
    },
    {
      id: "personalDiscountPercent",
      header: "Скидка",
      value: (user) => user.personalDiscountPercent ?? 0,
      sortable: true,
      align: "right",
      cell: (user) => `${user.personalDiscountPercent ?? 0}%`,
    },
    {
      id: "permissions",
      header: "Права",
      value: (user) => user.permissions?.length ?? 0,
      sortable: true,
      align: "right",
      cell: (user) => <code>{user.permissions?.length ?? 0}</code>,
    },
    {
      id: "status",
      header: "Статус",
      value: (user) => (user.active === false ? "disabled" : "active"),
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: "active", label: "Активные" },
        { value: "disabled", label: "Отключённые" },
      ],
      cell: (user) => (
        <AppBadge tone={user.active === false ? "red" : "green"}>
          {user.active === false ? "Отключён" : "Активен"}
        </AppBadge>
      ),
    },
    {
      id: "actions",
      header: "",
      hideable: false,
      width: 120,
      align: "right",
      cell: (user) => (
        <AppButton asChild variant="secondary" className="admin-table-action">
          <Link to={`/admin/users/${user.id}`}>Открыть</Link>
        </AppButton>
      ),
    },
  ];

  return (
    <AdminPage
      title="Пользователи"
      eyebrow="Пользователи и доступы"
      actions={
        <AppButton type="button" onClick={() => setCreateOpen(true)}>
          <Plus size={18} aria-hidden="true" />
          Создать пользователя
        </AppButton>
      }
    >
      <div className="metric-grid">
        <MetricCard
          icon={<Users size={18} />}
          label="Всего пользователей"
          value={data.length}
          size="compact"
        />
        <MetricCard
          icon={<ShieldCheck size={18} />}
          label="С правами"
          value={data.filter((user) => (user.permissions?.length ?? 0) > 0).length}
          accent
          size="compact"
        />
        <MetricCard
          icon={<UserCheck size={18} />}
          label="Активные"
          value={data.filter((user) => user.active !== false).length}
          size="compact"
        />
        <MetricCard
          icon={<Eye size={18} />}
          label="Без телефона"
          value={data.filter((user) => !user.phone).length}
          size="compact"
        />
      </div>

      <DataPanel title="Команда">
        <AppDataTable
          data={data}
          columns={columns}
          rowId={(user) => String(user.id ?? user.phone ?? user.email ?? user.name)}
          loading={users.isLoading}
          error={users.isError ? "Не удалось загрузить пользователей" : undefined}
          selectable={false}
          contextMenuActions={(user) => [
            {
              label: "Открыть",
              icon: <Eye size={17} />,
              disabled: !user.id,
              onSelect: () => {
                if (user.id) navigate(`/admin/users/${user.id}`);
              },
            },
          ]}
          contextMenuLabel={(user) => `Действия: ${user.name}`}
          emptyTitle="Пользователи не найдены"
          emptyDescription="Измените параметры поиска или проверьте доступность API."
        />
      </DataPanel>

      <AppModal
        open={createOpen}
        onOpenChange={closeCreate}
        title="Новый пользователь"
        description="Укажите данные для входа и при необходимости назначьте роли."
        contentClassName="users-page__create-modal"
      >
        <form className="users-page__create-form" onSubmit={submitCreate}>
          <AppInput
            label="Имя"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            maxLength={160}
            required
            autoFocus
            autoComplete="name"
          />
          <AppInput
            label="Email (необязательно)"
            type="email"
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            maxLength={180}
            autoComplete="email"
          />
          <AppPhoneInput
            label="Телефон"
            value={form.phone}
            onValueChange={(phone) => setForm((current) => ({ ...current, phone }))}
            maxLength={40}
            required
          />
          <AppInput
            label="Пароль"
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
            minLength={8}
            maxLength={100}
            hint="Не менее 8 символов"
            required
            autoComplete="new-password"
          />
          <AppSelect
            label="Роли"
            value={form.roleIds}
            onValueChange={(roleIds) =>
              setForm((current) => ({ ...current, roleIds: roleIds as string[] }))
            }
            options={(roles.data ?? []).map((role) => ({
              value: String(role.id),
              label: `${role.nameRu}${role.active ? "" : " — отключена"}`,
              disabled: !role.active,
            }))}
            multiple
            searchable
            multipleValueDisplay="count"
            showSelectedTags={false}
            placeholder={roles.isLoading ? "Загрузка ролей…" : "Без назначенных ролей"}
            disabled={roles.isLoading || roles.isError || createUser.isPending}
            error={roles.isError ? "Не удалось загрузить роли" : undefined}
          />
          <AppSwitch
            label="Активная учётная запись"
            description="Пользователь сможет войти сразу после создания."
            checked={form.active}
            onCheckedChange={(active) => setForm((current) => ({ ...current, active }))}
            disabled={createUser.isPending}
          />
          <div className="users-page__create-actions">
            <AppButton type="button" variant="secondary" onClick={() => closeCreate(false)}>
              Отмена
            </AppButton>
            <AppButton type="submit" loading={createUser.isPending}>
              Создать
            </AppButton>
          </div>
        </form>
      </AppModal>
    </AdminPage>
  );
}
