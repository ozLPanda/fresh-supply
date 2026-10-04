import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Edit, KeyRound, Plus, ShieldCheck, TimerReset, Trash2 } from "lucide-react";
import {
  createOneCIntegrationCredential,
  fetchOneCIntegrationCredentials,
  ONE_C_ORDER_READ_PERMISSION,
  revokeOneCIntegrationCredential,
  type OneCIntegrationCredential,
  type OneCIntegrationPermission,
  type SaveOneCIntegrationCredentialRequest,
  updateOneCIntegrationCredential,
} from "@/shared/api/oneCIntegration";
import { AdminPage } from "@/layouts/AdminPage";
import { ALMATY_TIME_ZONE, todayInAlmaty } from "@/shared/lib/dateTime";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import { AppCheckbox, AppSwitch } from "@/shared/ui/AppControls";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppContextMenu, type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppInput } from "@/shared/ui/AppField";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./ExternalSoftwarePage.css";

type CredentialForm = {
  name: string;
  permissions: OneCIntegrationPermission[];
  perpetual: boolean;
  expiresOn: string;
};

const emptyCredentialForm: CredentialForm = {
  name: "",
  permissions: [ONE_C_ORDER_READ_PERMISSION],
  perpetual: true,
  expiresOn: "",
};

function isCredentialExpired(credential: OneCIntegrationCredential) {
  return Boolean(credential.expiresAt && new Date(credential.expiresAt).getTime() < Date.now());
}

function credentialStatus(credential: OneCIntegrationCredential) {
  if (credential.revokedAt) return "revoked" as const;
  return isCredentialExpired(credential) ? ("expired" as const) : ("active" as const);
}

function formatDate(value: string | null) {
  if (!value) return "Бессрочно";
  return new Intl.DateTimeFormat("ru-KZ", {
    dateStyle: "medium",
    timeZone: ALMATY_TIME_ZONE,
  }).format(new Date(value));
}

function toDateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function toRequest(form: CredentialForm): SaveOneCIntegrationCredentialRequest {
  return {
    name: form.name.trim(),
    permissions: form.permissions,
    expiresAt: form.perpetual || !form.expiresOn ? null : `${form.expiresOn}T23:59:59+05:00`,
  };
}

function credentialToForm(credential: OneCIntegrationCredential): CredentialForm {
  return {
    name: credential.name,
    permissions: credential.permissions,
    perpetual: !credential.expiresAt,
    expiresOn: toDateInputValue(credential.expiresAt),
  };
}

function permissionLabel(permission: OneCIntegrationPermission) {
  if (permission === ONE_C_ORDER_READ_PERMISSION) return "Просмотр заказов";
  return permission;
}

type CredentialContextMenuState = {
  credential: OneCIntegrationCredential;
  x: number;
  y: number;
};

export function ExternalSoftwarePage() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<OneCIntegrationCredential | null>(
    null,
  );
  const [revokeTarget, setRevokeTarget] = useState<OneCIntegrationCredential | null>(null);
  const [form, setForm] = useState<CredentialForm>(emptyCredentialForm);
  const [formError, setFormError] = useState<string>();
  const [credentialContextMenu, setCredentialContextMenu] =
    useState<CredentialContextMenuState | null>(null);

  const credentialsQuery = useQuery({
    queryKey: ["one-c-integration-credentials"],
    queryFn: fetchOneCIntegrationCredentials,
  });
  const credentials = credentialsQuery.data ?? [];

  const refreshCredentials = () =>
    queryClient.invalidateQueries({ queryKey: ["one-c-integration-credentials"] });

  const saveCredential = useMutation({
    mutationFn: ({
      credential,
      payload,
    }: {
      credential: OneCIntegrationCredential | null;
      payload: SaveOneCIntegrationCredentialRequest;
    }) =>
      credential
        ? updateOneCIntegrationCredential(credential.id, payload)
        : createOneCIntegrationCredential(payload),
    onSuccess: (_, variables) => {
      void refreshCredentials();
      setFormOpen(false);
      setEditingCredential(null);
      setForm(emptyCredentialForm);
      appToast.success(variables.credential ? "Код доступа обновлён" : "Код доступа создан");
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : "Не удалось сохранить код доступа");
    },
  });

  const revokeCredential = useMutation({
    mutationFn: revokeOneCIntegrationCredential,
    onSuccess: () => {
      void refreshCredentials();
      setRevokeTarget(null);
      appToast.success("Код доступа отозван");
    },
    onError: (error) => {
      appToast.error(error instanceof Error ? error.message : "Не удалось отозвать код доступа");
    },
  });

  function openCreateForm() {
    setEditingCredential(null);
    setForm(emptyCredentialForm);
    setFormError(undefined);
    setFormOpen(true);
  }

  const openEditForm = useCallback((credential: OneCIntegrationCredential) => {
    setEditingCredential(credential);
    setForm(credentialToForm(credential));
    setFormError(undefined);
    setFormOpen(true);
  }, []);

  function closeForm() {
    if (saveCredential.isPending) return;
    setFormOpen(false);
    setEditingCredential(null);
    setFormError(undefined);
  }

  function submitForm() {
    const payload = toRequest(form);
    if (!payload.name) {
      setFormError("Укажите название, чтобы было понятно, кому выдан код.");
      return;
    }
    if (!payload.permissions.length) {
      setFormError("Выберите хотя бы одно разрешение.");
      return;
    }
    if (!form.perpetual && !form.expiresOn) {
      setFormError("Укажите дату окончания действия кода.");
      return;
    }
    setFormError(undefined);
    saveCredential.mutate({ credential: editingCredential, payload });
  }

  const copyToken = useCallback(async (credential: OneCIntegrationCredential) => {
    try {
      await navigator.clipboard.writeText(credential.token);
      appToast.success("Код доступа скопирован");
    } catch {
      appToast.error("Не удалось скопировать код доступа");
    }
  }, []);

  const credentialActions = useCallback(
    (credential: OneCIntegrationCredential): AppContextMenuAction[] => {
      const inactive = credentialStatus(credential) !== "active";
      return [
        {
          label: "Изменить",
          icon: <Edit size={17} />,
          disabled: Boolean(credential.revokedAt),
          onSelect: () => openEditForm(credential),
        },
        {
          label: "Скопировать код",
          icon: <Copy size={17} />,
          onSelect: () => void copyToken(credential),
        },
        {
          label: "Отозвать",
          icon: <Trash2 size={17} />,
          disabled: inactive,
          destructive: true,
          separatorBefore: true,
          onSelect: () => setRevokeTarget(credential),
        },
      ];
    },
    [copyToken, openEditForm],
  );

  function openCredentialContextMenu(
    credential: OneCIntegrationCredential,
    event: MouseEvent<HTMLTableRowElement>,
  ) {
    if (event.button !== 2) return;
    event.preventDefault();
    setCredentialContextMenu({ credential, x: event.clientX, y: event.clientY });
  }

  const columns = useMemo<AppDataTableColumn<OneCIntegrationCredential>[]>(
    () => [
      {
        id: "name",
        header: "Стороннее ПО",
        accessor: "name",
        sortable: true,
        cell: (credential) => (
          <div className="one-c-credential-name">
            <strong>{credential.name}</strong>
            <span>Создан {formatDate(credential.createdAt)}</span>
          </div>
        ),
      },
      {
        id: "token",
        header: "Код доступа",
        searchable: false,
        width: 260,
        cell: (credential) => (
          <div className="one-c-token">
            <code>{credential.token}</code>
            <AppButton
              type="button"
              variant="ghost"
              className="one-c-token__copy"
              aria-label={`Скопировать код для ${credential.name}`}
              onClick={() => void copyToken(credential)}
            >
              <Copy size={16} />
            </AppButton>
          </div>
        ),
      },
      {
        id: "permissions",
        header: "Разрешения",
        value: (credential) => credential.permissions.join(" "),
        cell: (credential) => (
          <div className="one-c-permissions">
            {credential.permissions.map((permission) => (
              <AppBadge key={permission} tone="blue">
                {permissionLabel(permission)}
              </AppBadge>
            ))}
          </div>
        ),
      },
      {
        id: "expiresAt",
        header: "Срок действия",
        value: (credential) => credential.expiresAt ?? "бессрочно",
        sortable: true,
        cell: (credential) => formatDate(credential.expiresAt),
      },
      {
        id: "status",
        header: "Статус",
        value: (credential) => credentialStatus(credential),
        sortable: true,
        filterable: true,
        filterOptions: [
          { value: "active", label: "Активен" },
          { value: "expired", label: "Истёк" },
          { value: "revoked", label: "Отозван" },
        ],
        cell: (credential) => {
          const status = credentialStatus(credential);
          const labels = { active: "Активен", expired: "Истёк", revoked: "Отозван" };
          const tones = { active: "green", expired: "orange", revoked: "red" } as const;
          return <AppBadge tone={tones[status]}>{labels[status]}</AppBadge>;
        },
      },
      {
        id: "actions",
        header: "",
        searchable: false,
        hideable: false,
        width: 56,
        align: "right",
        cell: (credential) => {
          return (
            <AppActionMenu
              label={`Действия: ${credential.name}`}
              actions={credentialActions(credential)}
            />
          );
        },
      },
    ],
    [credentialActions],
  );

  const activeCredentials = credentials.filter(
    (credential) => credentialStatus(credential) === "active",
  );
  const expiringCredentials = activeCredentials.filter((credential) => {
    if (!credential.expiresAt) return false;
    return new Date(credential.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000;
  });
  const queryError =
    credentialsQuery.error instanceof Error ? credentialsQuery.error.message : undefined;

  return (
    <AdminPage
      title="Стороннее ПО"
      eyebrow="Администрирование"
      actions={
        <AppButton type="button" onClick={openCreateForm}>
          <Plus size={18} />
          Выдать код доступа
        </AppButton>
      }
    >
      <div className="metric-grid">
        <MetricCard
          icon={<KeyRound size={18} />}
          label="Всего кодов"
          value={credentials.length}
          size="compact"
        />
        <MetricCard
          icon={<ShieldCheck size={18} />}
          label="Активные"
          value={activeCredentials.length}
          accent
          size="compact"
        />
        <MetricCard
          icon={<TimerReset size={18} />}
          label="Истекают за 7 дней"
          value={expiringCredentials.length}
          size="compact"
        />
      </div>

      <DataPanel
        title="Доступ для 1С"
        actions={<AppBadge tone="blue">API</AppBadge>}
        className="one-c-credentials-panel"
      >
        <p className="one-c-credentials-description">
          Выдавайте отдельный код каждому внешнему приложению и отзывайте его без изменения
          остальных интеграций.
        </p>
        <AppDataTable
          data={credentials}
          columns={columns}
          rowId={(credential) => credential.id}
          loading={credentialsQuery.isLoading}
          error={queryError}
          searchable
          selectable={false}
          defaultPageSize={10}
          emptyTitle="Коды доступа ещё не выданы"
          emptyDescription="Создайте отдельный код для 1С или другого внешнего приложения."
          onRowContextMenu={openCredentialContextMenu}
        />
      </DataPanel>

      {credentialContextMenu && (
        <AppContextMenu
          open
          x={credentialContextMenu.x}
          y={credentialContextMenu.y}
          label={`Действия: ${credentialContextMenu.credential.name}`}
          actions={credentialActions(credentialContextMenu.credential)}
          onOpenChange={(open) => !open && setCredentialContextMenu(null)}
        />
      )}

      <AppModal
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        title={editingCredential ? "Изменить код доступа" : "Выдать код доступа"}
        description="Код даёт доступ только к отмеченным операциям. Его можно просмотреть и скопировать в таблице в любой момент."
        contentClassName="one-c-credential-modal"
      >
        <div className="one-c-credential-form">
          {formError && (
            <AppAlert title="Проверьте данные" tone="danger">
              {formError}
            </AppAlert>
          )}
          <AppInput
            label="Название"
            required
            placeholder="Например, 1С склада"
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
          <div className="one-c-credential-form__section">
            <span className="one-c-credential-form__label">Разрешения</span>
            <AppCheckbox
              label="Просмотр заказов"
              description="По коду заказа вернёт состав и данные оформления заказа."
              checked={form.permissions.includes(ONE_C_ORDER_READ_PERMISSION)}
              onCheckedChange={(checked) =>
                setForm((current) => ({
                  ...current,
                  permissions: checked ? [ONE_C_ORDER_READ_PERMISSION] : [],
                }))
              }
            />
          </div>
          <div className="one-c-credential-form__section">
            <AppSwitch
              label="Бессрочный код"
              description="Отключите, чтобы задать дату окончания действия."
              checked={form.perpetual}
              onCheckedChange={(perpetual) => setForm((current) => ({ ...current, perpetual }))}
            />
            {!form.perpetual && (
              <AppInput
                label="Действует по"
                type="date"
                min={todayInAlmaty()}
                value={form.expiresOn}
                onChange={(event) =>
                  setForm((current) => ({ ...current, expiresOn: event.target.value }))
                }
              />
            )}
          </div>
          <div className="one-c-credential-form__actions">
            <AppButton
              type="button"
              variant="secondary"
              onClick={closeForm}
              disabled={saveCredential.isPending}
            >
              Отмена
            </AppButton>
            <AppButton
              type="button"
              onClick={submitForm}
              loading={saveCredential.isPending}
              loadingText="Сохранение..."
            >
              {editingCredential ? "Сохранить" : "Выдать код"}
            </AppButton>
          </div>
        </div>
      </AppModal>

      <AppModal
        open={Boolean(revokeTarget)}
        onOpenChange={(open) => {
          if (!open && !revokeCredential.isPending) setRevokeTarget(null);
        }}
        title="Отозвать код доступа?"
        description="Внешнее приложение больше не сможет выполнять запросы с этим кодом. Вернуть доступ можно только новым кодом."
      >
        <div className="one-c-revoke-modal">
          <strong>{revokeTarget?.name}</strong>
          <code>{revokeTarget?.token}</code>
          <div className="one-c-credential-form__actions">
            <AppButton
              type="button"
              variant="secondary"
              onClick={() => setRevokeTarget(null)}
              disabled={revokeCredential.isPending}
            >
              Отмена
            </AppButton>
            <AppButton
              type="button"
              variant="danger"
              onClick={() => revokeTarget && revokeCredential.mutate(revokeTarget.id)}
              loading={revokeCredential.isPending}
              loadingText="Отзыв..."
            >
              Отозвать код
            </AppButton>
          </div>
        </div>
      </AppModal>
    </AdminPage>
  );
}
