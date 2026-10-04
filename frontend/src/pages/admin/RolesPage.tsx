import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Layers3,
  LockKeyhole,
  Pencil,
  Plus,
  Save,
  ShieldCheck,
  ToggleRight,
} from "lucide-react";
import { api } from "@/shared/api/http";
import { Permission, Role } from "@/shared/types/models";
import { permissionActionLabel, permissionEntityLabel } from "@/shared/lib/permissionLabels";
import { AdminPage } from "@/layouts/AdminPage";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCheckbox, AppSwitch } from "@/shared/ui/AppControls";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppInput, AppSearchInput } from "@/shared/ui/AppField";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import { useNavigate, useParams } from "react-router-dom";
import { appToast } from "@/shared/ui/AppToast";
import { AppCard } from "@/shared/ui/AppCard";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./RolesPage.css";

function roleCode(name: string) {
  const transliteration: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ё: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "c",
    ч: "ch",
    ш: "sh",
    щ: "sch",
    ы: "y",
    э: "e",
    ю: "yu",
    я: "ya",
  };
  return name
    .toLowerCase()
    .split("")
    .map((letter) => transliteration[letter] ?? letter)
    .join("")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function RolesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { roleId } = useParams();
  const [editedRole, setEditedRole] = useState<Role | null>(null);
  const [nameRu, setNameRu] = useState("");
  const [code, setCode] = useState("");
  const [active, setActive] = useState(true);
  const [permissionIds, setPermissionIds] = useState<number[]>([]);
  const [permissionSearch, setPermissionSearch] = useState("");
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api<Role[]>("/api/roles") });
  const permissions = useQuery({
    queryKey: ["permissions"],
    queryFn: () => api<Permission[]>("/api/permissions"),
  });
  const data = roles.data ?? [];
  const allPermissions = permissions.data ?? [];
  const isCreating = roleId === "new";
  const routeRole =
    roleId && !isCreating ? data.find((item) => String(item.id) === roleId) : undefined;
  const roleMissing = Boolean(
    roleId && !isCreating && !roles.isLoading && !roles.isError && !routeRole,
  );
  const editorLoading = Boolean(
    roleId && !isCreating && (roles.isLoading || (routeRole && editedRole?.id !== routeRole.id)),
  );
  const editorReady = Boolean(
    roleId && (isCreating || (routeRole && editedRole?.id === routeRole.id)),
  );

  const save = useMutation({
    mutationFn: (role: Role) =>
      api<Role>(editedRole?.id ? `/api/roles/${editedRole.id}` : "/api/roles", {
        method: editedRole?.id ? "PUT" : "POST",
        body: JSON.stringify(role),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      navigate("/admin/roles");
      appToast.success(editedRole ? "Роль обновлена" : "Роль создана");
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось сохранить роль"),
  });

  const groupedPermissions = useMemo(() => {
    const groups = allPermissions.reduce<Record<string, Permission[]>>((result, permission) => {
      (result[permission.entityName] ??= []).push(permission);
      return result;
    }, {});
    const query = permissionSearch.trim();

    if (!query) return groups;

    return Object.entries(groups).reduce<Record<string, Permission[]>>((result, [group, items]) => {
      if (adminMatchesSearch(`${permissionEntityLabel(group)} ${group}`, query)) {
        result[group] = items;
        return result;
      }

      const matchingItems = items.filter((permission) =>
        adminMatchesSearch(`${permission.nameRu} ${permission.code}`, query),
      );
      if (matchingItems.length) result[group] = matchingItems;
      return result;
    }, {});
  }, [allPermissions, permissionSearch]);

  useEffect(() => {
    if (!roleId) return;
    const role = isCreating ? undefined : routeRole;
    if (!isCreating && !role) {
      if (!roles.isLoading) setEditedRole(null);
      return;
    }
    setEditedRole(role ?? null);
    setNameRu(role?.nameRu ?? "");
    setCode(role?.code ?? "");
    setActive(role?.active ?? true);
    setPermissionIds(role?.permissionIds ?? []);
    setPermissionSearch("");
  }, [isCreating, roleId, roles.isLoading, routeRole]);

  function openEditor(role?: Role) {
    setEditedRole(role ?? null);
    setNameRu(role?.nameRu ?? "");
    setCode(role?.code ?? "");
    setActive(role?.active ?? true);
    setPermissionIds(role?.permissionIds ?? []);
    setPermissionSearch("");
    navigate(`/admin/roles/${role?.id ?? "new"}`);
  }

  function togglePermission(id: number, checked: boolean) {
    setPermissionIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalizedCode = code.trim() || roleCode(nameRu);
    if (!normalizedCode) {
      appToast.error("Укажите название роли");
      return;
    }
    save.mutate({
      id: editedRole?.id,
      code: normalizedCode,
      nameRu: nameRu.trim(),
      active,
      permissionIds,
    });
  }

  const columns: AppDataTableColumn<Role>[] = [
    {
      id: "nameRu",
      header: "Роль",
      accessor: "nameRu",
      sortable: true,
      cell: (role) => (
        <div className="roles-page__name">
          <strong>{role.nameRu}</strong>
          <code>{role.code}</code>
        </div>
      ),
    },
    {
      id: "permissions",
      header: "Права",
      value: (role) => role.permissions?.length ?? 0,
      sortable: true,
      align: "right",
      cell: (role) => <AppBadge tone="blue">{role.permissions?.length ?? 0}</AppBadge>,
    },
    {
      id: "active",
      header: "Статус",
      value: (role) => (role.active ? "active" : "hidden"),
      sortable: true,
      cell: (role) => (
        <AppBadge tone={role.active ? "green" : "slate"}>
          {role.active ? "Активна" : "Отключена"}
        </AppBadge>
      ),
    },
    {
      id: "actions",
      header: "",
      searchable: false,
      sortable: false,
      align: "right",
      cell: (role) => (
        <AppButton
          type="button"
          variant="ghost"
          className="roles-page__edit"
          onClick={() => openEditor(role)}
          aria-label={`Редактировать роль ${role.nameRu}`}
        >
          <Pencil size={16} /> Изменить
        </AppButton>
      ),
    },
  ];

  return (
    <AdminPage
      title={roleId ? (isCreating ? "Создание роли" : "Редактирование роли") : "Роли"}
      eyebrow={roleId ? "Роли" : "Пользователи и доступы"}
      backAction={
        roleId ? (
          <AppButton
            type="button"
            variant="ghost"
            aria-label="Вернуться к списку ролей"
            title="Вернуться к списку ролей"
            onClick={() => navigate("/admin/roles")}
          >
            <ArrowLeft size={22} />
          </AppButton>
        ) : undefined
      }
      actions={
        roleId ? (
          <AppButton
            type="submit"
            form="role-editor-form"
            loading={save.isPending}
            loadingText="Сохранение..."
            disabled={!editorReady}
          >
            <Save size={18} />
            Сохранить
          </AppButton>
        ) : (
          <AppButton type="button" onClick={() => openEditor()}>
            <Plus size={17} /> Создать роль
          </AppButton>
        )
      }
    >
      {!roleId && (
        <>
          <div className="metric-grid">
            <MetricCard
              icon={<ShieldCheck size={18} />}
              label="Всего ролей"
              value={data.length}
              size="compact"
            />
            <MetricCard
              icon={<ToggleRight size={18} />}
              label="Активные"
              value={data.filter((role) => role.active).length}
              accent
              size="compact"
            />
            <MetricCard
              icon={<LockKeyhole size={18} />}
              label="С правами"
              value={data.filter((role) => (role.permissions?.length ?? 0) > 0).length}
              size="compact"
            />
            <MetricCard
              icon={<Layers3 size={18} />}
              label="Шаблоны"
              value={
                data.filter((role) =>
                  ["seller", "senior_seller", "accountant", "moderator"].includes(role.code),
                ).length
              }
              size="compact"
            />
          </div>
          <DataPanel
            title="Роли доступа"
            actions={
              <span className="roles-page__hint">Выберите роль, чтобы изменить её права</span>
            }
          >
            <AppDataTable
              data={data}
              columns={columns}
              rowId={(role) => String(role.id ?? role.code)}
              loading={roles.isLoading}
              error={roles.isError ? "Не удалось загрузить роли" : undefined}
              selectable={false}
              contextMenuActions={(role) => [
                {
                  label: "Изменить",
                  icon: <Pencil size={16} />,
                  onSelect: () => openEditor(role),
                },
              ]}
              contextMenuLabel={(role) => `Действия: ${role.nameRu}`}
              emptyTitle="Роли не найдены"
              emptyDescription="Создайте первую роль и назначьте ей нужные права."
            />
          </DataPanel>
        </>
      )}
      {roleId && (
        <>
          {roles.isError ? (
            <AppAlert title="Не удалось загрузить роль">
              Обновите страницу или вернитесь к списку ролей и попробуйте снова.
            </AppAlert>
          ) : roleMissing ? (
            <AppAlert title="Роль не найдена">
              Возможно, роль была удалена или ссылка больше не актуальна.
            </AppAlert>
          ) : editorLoading ? (
            <AppCard>
              <AppSkeleton />
            </AppCard>
          ) : (
            <form id="role-editor-form" className="roles-page__editor" onSubmit={submit}>
              <AppCard
                className="roles-page__details-card"
                title="Основная информация"
                description="Название, служебный код и состояние роли."
              >
                <div className="roles-page__fields">
                  <AppInput
                    label="Название роли"
                    value={nameRu}
                    onChange={(event) => {
                      setNameRu(event.target.value);
                      if (!editedRole) setCode(roleCode(event.target.value));
                    }}
                    required
                    autoFocus
                  />
                  <AppInput
                    label="Код роли"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
                    }
                    hint="Служебный идентификатор: латинские буквы, цифры и _"
                    required
                  />
                </div>
                <div className="roles-page__status">
                  <AppSwitch
                    label="Роль активна"
                    description="Права активной роли учитываются у назначенных пользователей."
                    checked={active}
                    onCheckedChange={setActive}
                  />
                </div>
              </AppCard>

              <AppCard
                className="roles-page__permissions-card"
                title="Права доступа"
                description={`Выбрано: ${permissionIds.length} из ${allPermissions.length}`}
                actions={
                  <AppSearchInput
                    value={permissionSearch}
                    onChange={(event) => setPermissionSearch(event.target.value)}
                    placeholder="Поиск права"
                    aria-label="Поиск права"
                  />
                }
              >
                <div className="roles-page__permissions" aria-busy={permissions.isLoading}>
                  {permissions.isLoading ? (
                    <AppSkeleton />
                  ) : permissions.isError ? (
                    <AppAlert title="Не удалось загрузить права">
                      Обновите страницу и попробуйте снова.
                    </AppAlert>
                  ) : Object.keys(groupedPermissions).length === 0 ? (
                    <p className="roles-page__empty">
                      {permissionSearch
                        ? "Права по вашему запросу не найдены."
                        : "Права не найдены."}
                    </p>
                  ) : (
                    Object.entries(groupedPermissions).map(([group, items]) => (
                      <section key={group} className="roles-page__permission-group">
                        <div className="roles-page__permission-group-title">
                          <h3>{permissionEntityLabel(group)}</h3>
                          <AppButton
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              const allSelected = items.every((item) =>
                                permissionIds.includes(item.id),
                              );
                              setPermissionIds((current) =>
                                allSelected
                                  ? current.filter((id) => !items.some((item) => item.id === id))
                                  : [...new Set([...current, ...items.map((item) => item.id)])],
                              );
                            }}
                          >
                            {items.every((item) => permissionIds.includes(item.id))
                              ? "Снять все"
                              : "Выбрать все"}
                          </AppButton>
                        </div>
                        {items.map((permission) => (
                          <AppCheckbox
                            key={permission.id}
                            label={permission.nameRu}
                            description={permissionActionLabel(permission.actionName)}
                            checked={permissionIds.includes(permission.id)}
                            onCheckedChange={(checked) => togglePermission(permission.id, checked)}
                          />
                        ))}
                      </section>
                    ))
                  )}
                </div>
              </AppCard>
            </form>
          )}
        </>
      )}
    </AdminPage>
  );
}
