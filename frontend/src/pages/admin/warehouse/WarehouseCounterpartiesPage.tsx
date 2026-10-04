import { FormEvent, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, UsersRound } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import {
  createWarehouseCounterparty,
  fetchWarehouseCounterparties,
  updateWarehouseCounterparty,
  type WarehouseCounterparty,
  type WarehouseCounterpartyInput,
} from "@/shared/api/warehouse";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppSwitch } from "@/shared/ui/AppControls";
import { type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import {
  emptyWarehouseCounterpartyInput,
  WarehouseCounterpartyFields,
} from "./WarehouseCounterpartyFields";
import "./WarehousePages.css";

function initialInput(counterparty?: WarehouseCounterparty | null): WarehouseCounterpartyInput {
  return { ...emptyWarehouseCounterpartyInput(), ...counterparty };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось сохранить контрагента";
}

export function WarehouseCounterpartiesPage() {
  const { user } = useCommerce();
  const canManage = user?.permissions?.includes("warehouse.manage") ?? false;
  const queryClient = useQueryClient();
  const counterparties = useQuery({
    queryKey: ["warehouse-counterparties", "all"],
    queryFn: () => fetchWarehouseCounterparties(true),
  });
  const [search, setSearch] = useState("");
  const [edited, setEdited] = useState<WarehouseCounterparty | null | undefined>(undefined);
  const [input, setInput] = useState<WarehouseCounterpartyInput>(initialInput());

  const save = useMutation({
    mutationFn: () =>
      edited ? updateWarehouseCounterparty(edited.id, input) : createWarehouseCounterparty(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["warehouse-counterparties"] }),
        queryClient.invalidateQueries({ queryKey: ["warehouse-documents"] }),
      ]);
      setEdited(undefined);
      appToast.success(edited ? "Контрагент обновлён" : "Контрагент добавлен");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const changeArchiveState = useMutation({
    mutationFn: ({
      counterparty,
      archived,
    }: {
      counterparty: WarehouseCounterparty;
      archived: boolean;
    }) => updateWarehouseCounterparty(counterparty.id, { ...initialInput(counterparty), archived }),
    onSuccess: async (_, { archived }) => {
      await queryClient.invalidateQueries({ queryKey: ["warehouse-counterparties"] });
      appToast.success(archived ? "Контрагент перенесён в архив" : "Контрагент восстановлен");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });

  const rows = useMemo(
    () =>
      (counterparties.data ?? []).filter((counterparty) =>
        adminMatchesSearch(
          `${counterparty.name} ${counterparty.contactName ?? ""} ${counterparty.phone ?? ""} ${counterparty.email ?? ""}`,
          search,
        ),
      ),
    [counterparties.data, search],
  );
  const columns = useMemo<AppDataTableColumn<WarehouseCounterparty>[]>(
    () => [
      {
        id: "name",
        header: "Контрагент",
        value: (counterparty) => `${counterparty.name} ${counterparty.contactName ?? ""}`,
        cell: (counterparty) => (
          <div className="warehouse-counterparty-cell">
            <b>{counterparty.name}</b>
            {counterparty.contactName && <span>{counterparty.contactName}</span>}
          </div>
        ),
      },
      {
        id: "contacts",
        header: "Контакты",
        value: (counterparty) => `${counterparty.phone ?? ""} ${counterparty.email ?? ""}`,
        cell: (counterparty) => (
          <div className="warehouse-counterparty-cell">
            <b>{counterparty.phone ?? "—"}</b>
            {counterparty.email && <span>{counterparty.email}</span>}
          </div>
        ),
      },
      {
        id: "comment",
        header: "Комментарий",
        value: (counterparty) => counterparty.comment ?? "",
        cell: (counterparty) => counterparty.comment ?? "—",
      },
      {
        id: "status",
        header: "Статус",
        value: (counterparty) => (counterparty.archived ? "ARCHIVED" : "ACTIVE"),
        cell: (counterparty) => (
          <AppBadge tone={counterparty.archived ? "slate" : "green"}>
            {counterparty.archived ? "Архив" : "Активен"}
          </AppBadge>
        ),
        filterable: true,
        filterOptions: [
          { value: "ACTIVE", label: "Активные" },
          { value: "ARCHIVED", label: "Архивные" },
        ],
        width: 120,
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: "",
              searchable: false,
              width: 150,
              cell: (counterparty: WarehouseCounterparty) => (
                <AppButton
                  type="button"
                  variant="ghost"
                  onClick={() => editCounterparty(counterparty)}
                >
                  <Pencil size={16} />
                  Изменить
                </AppButton>
              ),
            } satisfies AppDataTableColumn<WarehouseCounterparty>,
          ]
        : []),
    ],
    [canManage],
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.name.trim()) return;
    save.mutate();
  }

  function editCounterparty(counterparty: WarehouseCounterparty) {
    setInput(initialInput(counterparty));
    setEdited(counterparty);
  }

  function counterpartyActions(counterparty: WarehouseCounterparty): AppContextMenuAction[] {
    if (!canManage) return [];

    return [
      {
        label: "Изменить",
        icon: <Pencil size={17} />,
        onSelect: () => editCounterparty(counterparty),
      },
      {
        label: counterparty.archived ? "Восстановить из архива" : "Перенести в архив",
        icon: counterparty.archived ? <ArchiveRestore size={17} /> : <Archive size={17} />,
        destructive: !counterparty.archived,
        separatorBefore: true,
        disabled: changeArchiveState.isPending,
        onSelect: () =>
          changeArchiveState.mutate({ counterparty, archived: !counterparty.archived }),
      },
    ];
  }

  return (
    <AdminPage
      eyebrow="Внутренний учёт"
      title="Контрагенты склада"
      actions={
        canManage ? (
          <AppButton
            type="button"
            onClick={() => {
              setInput(initialInput());
              setEdited(null);
            }}
          >
            <Plus size={17} />
            Добавить контрагента
          </AppButton>
        ) : undefined
      }
    >
      <div className="warehouse-page warehouse-counterparties-page">
        <AppAlert tone="info" title="Поставщики и другие контрагенты склада">
          Выбирайте контрагента в заказах поставщику и приходах. Архивирование сохраняет историю, но
          исключает контрагента из выбора в новых документах.
        </AppAlert>
        {counterparties.isError ? (
          <AppAlert
            tone="danger"
            title="Не удалось загрузить контрагентов"
            onRetry={counterparties.refetch}
          >
            Проверьте соединение с сервером и повторите попытку.
          </AppAlert>
        ) : (
          <DataPanel title="Справочник контрагентов">
            <AppDataTable
              data={rows}
              columns={columns}
              rowId={(counterparty) => counterparty.id}
              searchable
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Название, контакт, телефон или e-mail"
              initialFilterValues={{ status: ["ACTIVE"] }}
              contextMenuActions={counterpartyActions}
              contextMenuLabel={(counterparty) => `Действия: ${counterparty.name}`}
              emptyTitle="Контрагентов пока нет"
              emptyDescription="Добавьте поставщика, чтобы выбирать его в складских документах."
            />
          </DataPanel>
        )}
      </div>

      <AppModal
        open={edited !== undefined}
        onOpenChange={(open) => !open && setEdited(undefined)}
        title={edited ? "Изменить контрагента" : "Новый контрагент"}
        description="Контактные данные доступны только в складском учёте."
        contentClassName="warehouse-counterparty-modal"
      >
        <form className="warehouse-counterparty-modal__form" onSubmit={submit}>
          <WarehouseCounterpartyFields value={input} onChange={setInput} />
          {edited && (
            <AppSwitch
              label="Перенести в архив"
              description="Архивный контрагент останется в старых документах, но не будет доступен для выбора."
              checked={Boolean(input.archived)}
              onCheckedChange={(archived) => setInput((current) => ({ ...current, archived }))}
            />
          )}
          <div className="warehouse-counterparty-modal__actions">
            <AppButton type="button" variant="ghost" onClick={() => setEdited(undefined)}>
              Отмена
            </AppButton>
            <AppButton type="submit" loading={save.isPending} loadingText="Сохраняем">
              {input.archived ? <ArchiveRestore size={17} /> : <UsersRound size={17} />}
              Сохранить
            </AppButton>
          </div>
        </form>
      </AppModal>
    </AdminPage>
  );
}
