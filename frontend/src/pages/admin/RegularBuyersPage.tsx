import { type FormEvent, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import {
  createRegularBuyer,
  fetchRegularBuyers,
  updateRegularBuyer,
  type RegularBuyer,
  type RegularBuyerInput,
} from "@/shared/api/regularBuyers";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton, type AppSplitButtonAction } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppSwitch } from "@/shared/ui/AppControls";
import { AppInput, AppTextarea } from "@/shared/ui/AppField";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import "./RegularBuyersPage.css";

function initialInput(buyer?: RegularBuyer): RegularBuyerInput {
  return {
    name: buyer?.name ?? "",
    contactName: buyer?.contactName ?? "",
    phone: buyer?.phone ?? "",
    email: buyer?.email ?? "",
    taxId: buyer?.taxId ?? "",
    legalAddress: buyer?.legalAddress ?? "",
    comment: buyer?.comment ?? "",
    archived: buyer?.archived ?? false,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось сохранить покупателя";
}

export function RegularBuyersPage() {
  const { user } = useCommerce();
  const canManage = user?.permissions.includes("regular-buyers.manage") ?? false;
  const canRead = canManage || Boolean(user?.permissions.includes("regular-buyers.read"));
  const queryClient = useQueryClient();
  const buyers = useQuery({
    queryKey: ["regular-buyers", "all"],
    queryFn: () => fetchRegularBuyers(true),
    enabled: canRead,
  });
  const [search, setSearch] = useState("");
  const [edited, setEdited] = useState<RegularBuyer | null | undefined>(undefined);
  const [input, setInput] = useState<RegularBuyerInput>(initialInput());
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...input,
        name: input.name.trim(),
        taxId: input.taxId?.trim() || null,
        legalAddress: input.legalAddress?.trim() || null,
      };
      return edited ? updateRegularBuyer(edited.id, payload) : createRegularBuyer(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["regular-buyers"] });
      setEdited(undefined);
      appToast.success(edited ? "Покупатель обновлён" : "Покупатель добавлен");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const changeArchive = useMutation({
    mutationFn: (buyer: RegularBuyer) =>
      updateRegularBuyer(buyer.id, { ...initialInput(buyer), archived: !buyer.archived }),
    onSuccess: async (_, buyer) => {
      await queryClient.invalidateQueries({ queryKey: ["regular-buyers"] });
      appToast.success(buyer.archived ? "Покупатель восстановлен" : "Покупатель перенесён в архив");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });

  function editBuyer(buyer: RegularBuyer) {
    save.reset();
    setInput(initialInput(buyer));
    setEdited(buyer);
  }

  function buyerActions(buyer: RegularBuyer): AppSplitButtonAction[] {
    if (!canManage) return [];
    return [
      { label: "Изменить", icon: <Pencil size={16} />, onSelect: () => editBuyer(buyer) },
      {
        label: buyer.archived ? "Восстановить из архива" : "Перенести в архив",
        icon: buyer.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />,
        disabled: changeArchive.isPending,
        onSelect: () => changeArchive.mutate(buyer),
      },
    ];
  }

  const rows = useMemo(
    () =>
      (buyers.data ?? []).filter((buyer) =>
        adminMatchesSearch(
          `${buyer.name} ${buyer.contactName ?? ""} ${buyer.phone ?? ""} ${buyer.email ?? ""} ${buyer.taxId ?? ""} ${buyer.legalAddress ?? ""} ${buyer.comment ?? ""}`,
          search,
        ),
      ),
    [buyers.data, search],
  );
  const columns: AppDataTableColumn<RegularBuyer>[] = [
    {
      id: "name",
      header: "Наименование покупателя",
      value: (buyer) => `${buyer.name} ${buyer.contactName ?? ""}`,
      cell: (buyer) => (
        <div className="regular-buyers-page__cell">
          <b>{buyer.name}</b>
          {buyer.contactName && <span>{buyer.contactName}</span>}
        </div>
      ),
    },
    {
      id: "contacts",
      header: "Контакты",
      value: (buyer) => `${buyer.phone ?? ""} ${buyer.email ?? ""}`,
      cell: (buyer) => (
        <div className="regular-buyers-page__cell">
          <span>{buyer.phone || "—"}</span>
          {buyer.email && <span>{buyer.email}</span>}
        </div>
      ),
    },
    {
      id: "paymentDetails",
      header: "Реквизиты для счёта",
      value: (buyer) => `${buyer.taxId ?? ""} ${buyer.legalAddress ?? ""}`,
      cell: (buyer) => (
        <div className="regular-buyers-page__cell">
          <span>{buyer.taxId ? `ИИН/БИН: ${buyer.taxId}` : "—"}</span>
          {buyer.legalAddress && <span>{buyer.legalAddress}</span>}
        </div>
      ),
    },
    {
      id: "comment",
      header: "Комментарий",
      value: (buyer) => buyer.comment ?? "",
      cell: (buyer) => buyer.comment || "—",
    },
    {
      id: "status",
      header: "Статус",
      value: (buyer) => (buyer.archived ? "ARCHIVED" : "ACTIVE"),
      cell: (buyer) => (
        <AppBadge tone={buyer.archived ? "slate" : "green"}>
          {buyer.archived ? "Архив" : "Активен"}
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
            sortable: false,
            hideable: false,
            width: 64,
            cell: (buyer: RegularBuyer) => (
              <AppActionMenu actions={buyerActions(buyer)} label={`Действия: ${buyer.name}`} />
            ),
          },
        ]
      : []),
  ];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || save.isPending || !input.name.trim()) return;
    save.mutate();
  }

  return (
    <AdminPage
      title="Постоянные покупатели"
      eyebrow="Заказы и документы"
      actions={
        canManage ? (
          <AppButton
            type="button"
            onClick={() => {
              save.reset();
              setInput(initialInput());
              setEdited(null);
            }}
          >
            <Plus size={17} />
            Добавить покупателя
          </AppButton>
        ) : undefined
      }
    >
      <div className="regular-buyers-page">
        <AppAlert title="Покупатель в печатных документах">
          Привяжите постоянного покупателя к заказу — его наименование заполнит поле
          организации-получателя в накладной. ИИН/БИН и юридический адрес подставятся в счёт на
          оплату, в том числе для ранее созданных заказов. Архивные покупатели остаются в
          существующих заказах.
        </AppAlert>
        {!canRead ? (
          <AppAlert title="Нет доступа к справочнику" tone="warning">
            Для просмотра покупателей требуется право «Просмотр постоянных покупателей».
          </AppAlert>
        ) : buyers.isError ? (
          <AppAlert
            title="Не удалось загрузить покупателей"
            tone="danger"
            onRetry={() => buyers.refetch()}
          >
            {errorMessage(buyers.error)}
          </AppAlert>
        ) : (
          <DataPanel title="Справочник покупателей">
            <AppDataTable
              data={rows}
              columns={columns}
              rowId={(buyer) => buyer.id}
              loading={buyers.isPending}
              searchable
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Наименование, ИИН/БИН, адрес или контакты"
              initialFilterValues={{ status: ["ACTIVE"] }}
              mobileFilterDialog
              contextMenuActions={buyerActions}
              contextMenuLabel={(buyer) => `Действия: ${buyer.name}`}
              emptyTitle="Покупатели не найдены"
              emptyDescription="Добавьте покупателя или измените поиск и фильтр статуса."
              renderMobileRow={(buyer) => (
                <div className="regular-buyers-page__mobile-card">
                  <div className="regular-buyers-page__mobile-header">
                    <b>{buyer.name}</b>
                    {canManage && (
                      <AppActionMenu
                        actions={buyerActions(buyer)}
                        label={`Действия: ${buyer.name}`}
                      />
                    )}
                  </div>
                  <AppBadge tone={buyer.archived ? "slate" : "green"}>
                    {buyer.archived ? "Архив" : "Активен"}
                  </AppBadge>
                  {buyer.contactName && <span>Контакт: {buyer.contactName}</span>}
                  {buyer.phone && <span>Телефон: {buyer.phone}</span>}
                  {buyer.email && <span>E-mail: {buyer.email}</span>}
                  {buyer.taxId && <span>ИИН/БИН: {buyer.taxId}</span>}
                  {buyer.legalAddress && <span>Юридический адрес: {buyer.legalAddress}</span>}
                  {buyer.comment && <span>{buyer.comment}</span>}
                </div>
              )}
            />
          </DataPanel>
        )}
      </div>
      <AppModal
        open={edited !== undefined}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setEdited(undefined);
        }}
        title={edited ? "Изменить покупателя" : "Новый постоянный покупатель"}
        description="Наименование используется в накладной и счёте на оплату. Реквизиты для счёта можно заполнить позже."
        contentClassName="regular-buyers-modal"
      >
        <form className="regular-buyers-modal__form" onSubmit={submit}>
          <AppInput
            label="Наименование организации или ИП"
            required
            autoFocus
            maxLength={240}
            value={input.name}
            disabled={save.isPending}
            placeholder="Например: ТОО «Покупатель»"
            onChange={(event) => setInput({ ...input, name: event.target.value })}
          />
          <AppInput
            label="ИИН/БИН"
            inputMode="numeric"
            maxLength={12}
            pattern="[0-9]{12}"
            title="Введите 12 цифр ИИН/БИН"
            hint="12 цифр. Необязательно; используется в счёте на оплату."
            value={input.taxId ?? ""}
            suffix={
              <span aria-label={`Введено ${input.taxId?.length ?? 0} символов из 12`}>
                {input.taxId?.length ?? 0}/12
              </span>
            }
            disabled={save.isPending}
            onChange={(event) => setInput({ ...input, taxId: event.target.value })}
          />
          <AppTextarea
            label="Юридический адрес"
            rows={2}
            maxLength={1000}
            value={input.legalAddress ?? ""}
            disabled={save.isPending}
            onChange={(event) => setInput({ ...input, legalAddress: event.target.value })}
          />
          <AppInput
            label="Контактное лицо"
            maxLength={160}
            value={input.contactName ?? ""}
            disabled={save.isPending}
            onChange={(event) => setInput({ ...input, contactName: event.target.value })}
          />
          <div className="regular-buyers-modal__contacts">
            <AppInput
              label="Телефон"
              type="tel"
              maxLength={64}
              value={input.phone ?? ""}
              disabled={save.isPending}
              onChange={(event) => setInput({ ...input, phone: event.target.value })}
            />
            <AppInput
              label="E-mail"
              type="email"
              maxLength={254}
              value={input.email ?? ""}
              disabled={save.isPending}
              onChange={(event) => setInput({ ...input, email: event.target.value })}
            />
          </div>
          <AppTextarea
            label="Комментарий"
            rows={3}
            maxLength={2000}
            value={input.comment ?? ""}
            disabled={save.isPending}
            onChange={(event) => setInput({ ...input, comment: event.target.value })}
          />
          {edited && (
            <AppSwitch
              label="Перенести в архив"
              description="Покупатель останется в существующих заказах, но будет недоступен для нового выбора."
              checked={Boolean(input.archived)}
              disabled={save.isPending}
              onCheckedChange={(archived) => setInput({ ...input, archived })}
            />
          )}
          {save.isError && (
            <AppAlert title="Не удалось сохранить покупателя" tone="danger">
              {errorMessage(save.error)}
            </AppAlert>
          )}
          <div className="regular-buyers-modal__actions">
            <AppButton
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => setEdited(undefined)}
            >
              Отмена
            </AppButton>
            <AppButton
              type="submit"
              disabled={!input.name.trim()}
              loading={save.isPending}
              loadingText="Сохраняем"
            >
              Сохранить
            </AppButton>
          </div>
        </form>
      </AppModal>
    </AdminPage>
  );
}
