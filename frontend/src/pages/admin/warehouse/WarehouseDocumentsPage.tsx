import { FormEvent, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileDown,
  Layers3,
  Pencil,
  Printer,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import {
  cancelWarehouseDocument,
  cancelWarehousePriceSettingGroupDocuments,
  deleteWarehouseDocument,
  deleteWarehousePriceSettingGroupDocuments,
  downloadWarehousePriceSettingGroupPdf,
  fetchWarehouseCounterparties,
  fetchWarehouseDocuments,
  fetchWarehousePriceSettingGroups,
  postWarehouseDocument,
  postWarehousePriceSettingGroupDocuments,
  updateWarehousePriceSettingGroup,
  type WarehouseDocumentStatus,
  type WarehouseDocumentSummary,
  type WarehouseDocumentType,
  type WarehousePriceSettingGroup,
  type WarehousePriceSettingGroupInput,
} from "@/shared/api/warehouse";
import { formatDateTime } from "@/shared/lib/dateTime";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppContextMenu, type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppInput, AppSelect, AppTextarea } from "@/shared/ui/AppField";
import { AppRichTextEditor } from "@/shared/ui/AppRichTextEditor";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { DOCUMENT_TYPE_LABELS } from "./WarehouseDocumentEditor";
import { saveWarehouseDocumentPdf } from "./saveWarehouseDocumentPdf";
import "./WarehousePages.css";
import "./WarehousePriceGroupModal.css";

type ManualDocumentType = Exclude<WarehouseDocumentType, "SALE">;
type DocumentTab = "all" | ManualDocumentType;
type PendingDocumentAction = "post" | "cancel" | "delete";

const STATUS_LABELS: Record<WarehouseDocumentStatus, string> = {
  DRAFT: "Черновик",
  POSTED: "Проведён",
  CANCELLED: "Отменён",
};

const STATUS_TONES: Record<WarehouseDocumentStatus, "slate" | "green" | "red"> = {
  DRAFT: "slate",
  POSTED: "green",
  CANCELLED: "red",
};

const PRICE_TYPE_LABELS: Record<string, string> = {
  RETAIL: "Розничная",
  WHOLESALE: "Оптовая",
  BULK_WHOLESALE: "Крупно-оптовая",
  SKO: "СКО",
  GSKO: "ГСКО",
  INCOMING: "Приходная",
};

const DOCUMENT_FILTER_OPTIONS: Array<{ value: DocumentTab; label: string }> = [
  { value: "all", label: "Все документы" },
  { value: "RECEIPT", label: "Приходы" },
  { value: "PURCHASE_ORDER", label: "Заказы поставщикам" },
  { value: "PRICE_SETTING", label: "Установка цен" },
  { value: "OPENING_BALANCE", label: "Начальные остатки" },
  { value: "CUSTOMER_RETURN", label: "Возвраты" },
  { value: "INVENTORY", label: "Инвентаризация" },
];

function newDocumentPath(type: ManualDocumentType) {
  return {
    OPENING_BALANCE: "/admin/warehouse/opening-balances/new",
    RECEIPT: "/admin/warehouse/receipts/new",
    PURCHASE_ORDER: "/admin/warehouse/purchase-orders/new",
    PRICE_SETTING: "/admin/warehouse/price-settings/new",
    CUSTOMER_RETURN: "/admin/warehouse/returns/new",
    INVENTORY: "/admin/warehouse/inventory/new",
  }[type];
}

function documentListPath(type: DocumentTab) {
  if (type === "all") return "/admin/warehouse/documents";
  return {
    OPENING_BALANCE: "/admin/warehouse/opening-balances",
    RECEIPT: "/admin/warehouse/receipts",
    PURCHASE_ORDER: "/admin/warehouse/purchase-orders",
    PRICE_SETTING: "/admin/warehouse/price-settings",
    CUSTOMER_RETURN: "/admin/warehouse/returns",
    INVENTORY: "/admin/warehouse/inventory",
  }[type];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие";
}

function priceTypeLabel(document: WarehouseDocumentSummary) {
  return PRICE_TYPE_LABELS[document.priceType ?? ""] ?? "Тип цены не указан";
}

function priceGroupInput(group: WarehousePriceSettingGroup): WarehousePriceSettingGroupInput {
  return {
    name: group.name,
    commonRules: group.commonRules ?? "",
    comment: group.comment ?? "",
  };
}

export function WarehouseDocumentsPage({
  initialType = "RECEIPT",
  initialTab,
}: {
  initialType?: ManualDocumentType;
  initialTab?: DocumentTab;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: PendingDocumentAction;
    document: WarehouseDocumentSummary;
  } | null>(null);
  const [pendingGroupAction, setPendingGroupAction] = useState<{
    type: PendingDocumentAction;
    group: WarehousePriceSettingGroup;
  } | null>(null);
  const [priceGroupContextMenu, setPriceGroupContextMenu] = useState<{
    group: WarehousePriceSettingGroup;
    x: number;
    y: number;
  } | null>(null);
  const [collapsedPriceGroupIds, setCollapsedPriceGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [editedPriceGroup, setEditedPriceGroup] = useState<WarehousePriceSettingGroup | null>(null);
  const [exportingPriceGroupId, setExportingPriceGroupId] = useState<string | null>(null);
  const [exportingDocumentId, setExportingDocumentId] = useState<string | null>(null);
  const [editedPriceGroupInput, setEditedPriceGroupInput] =
    useState<WarehousePriceSettingGroupInput>({ name: "", commonRules: "", comment: "" });
  const activeTab = initialTab ?? "all";
  const showsSupplierFilter = activeTab === "RECEIPT" || activeTab === "PURCHASE_ORDER";
  const supplierFilterId = showsSupplierFilter
    ? (new URLSearchParams(location.search).get("counterpartyId") ?? "")
    : "";
  const returnTo = `${location.pathname}${location.search}`;
  const documents = useQuery({
    queryKey: ["warehouse-documents"],
    queryFn: fetchWarehouseDocuments,
  });
  const counterparties = useQuery({
    queryKey: ["warehouse-counterparties", "all"],
    queryFn: () => fetchWarehouseCounterparties(true),
    enabled: showsSupplierFilter,
  });
  const priceSettingGroups = useQuery({
    queryKey: ["warehouse-price-setting-groups"],
    queryFn: fetchWarehousePriceSettingGroups,
  });
  const priceSettingGroupsById = useMemo(
    () => new Map((priceSettingGroups.data ?? []).map((group) => [group.id, group])),
    [priceSettingGroups.data],
  );
  const refreshDocuments = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["warehouse-documents"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-price-setting-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-purchase-order-progress"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-purchase-order-remainders"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-balances"] }),
    ]);
  const postDocument = useMutation({
    mutationFn: postWarehouseDocument,
    onSuccess: async () => {
      await refreshDocuments();
      setPendingAction(null);
      appToast.success(
        pendingAction?.document.type === "PURCHASE_ORDER"
          ? "Заказ поставщику оформлен"
          : pendingAction?.document.type === "CUSTOMER_RETURN"
            ? "Возврат проведён"
            : "Документ проведён, остатки обновлены",
      );
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const cancelDocument = useMutation({
    mutationFn: cancelWarehouseDocument,
    onSuccess: async () => {
      await refreshDocuments();
      setPendingAction(null);
      appToast.success("Проведение документа отменено");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const deleteDocument = useMutation({
    mutationFn: deleteWarehouseDocument,
    onSuccess: async () => {
      await refreshDocuments();
      setPendingAction(null);
      appToast.success("Документ удалён из складского учёта");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const groupAction = useMutation({
    mutationFn: ({
      type,
      group,
    }: {
      type: PendingDocumentAction;
      group: WarehousePriceSettingGroup;
    }) => {
      if (type === "post") return postWarehousePriceSettingGroupDocuments(group.id);
      if (type === "cancel") return cancelWarehousePriceSettingGroupDocuments(group.id);
      return deleteWarehousePriceSettingGroupDocuments(group.id);
    },
    onSuccess: async (count, action) => {
      await refreshDocuments();
      setPendingGroupAction(null);
      appToast.success(
        action.type === "post"
          ? `Проведено документов: ${count}`
          : action.type === "cancel"
            ? `Отменено проведение документов: ${count}`
            : `Удалено документов: ${count}`,
      );
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const updatePriceGroup = useMutation({
    mutationFn: () => {
      if (!editedPriceGroup) throw new Error("Группа установки цен не выбрана");
      return updateWarehousePriceSettingGroup(editedPriceGroup.id, editedPriceGroupInput);
    },
    onSuccess: async () => {
      await refreshDocuments();
      setEditedPriceGroup(null);
      appToast.success("Правила группы обновлены");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const rows = useMemo(() => {
    const visibleDocuments = (documents.data ?? []).filter((document) => {
      if (document.type === "SALE") return false;
      if (activeTab !== "all" && document.type !== activeTab) return false;
      if (supplierFilterId && document.counterpartyId !== supplierFilterId) return false;
      return (
        !search.trim() ||
        adminMatchesSearch(
          `${document.documentNumber ?? ""} ${document.counterpartyName ?? ""} ${document.reference ?? ""} ${document.priceSettingGroupName ?? ""} ${document.priceSettingGroupId ? (priceSettingGroupsById.get(document.priceSettingGroupId)?.name ?? "") : ""}`,
          search,
        )
      );
    });
    if (activeTab !== "PRICE_SETTING") return visibleDocuments;

    const groupOrder = new Map(
      (priceSettingGroups.data ?? []).map((group, index) => [group.id, index]),
    );
    return [...visibleDocuments].sort((first, second) => {
      const firstOrder = first.priceSettingGroupId
        ? (groupOrder.get(first.priceSettingGroupId) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      const secondOrder = second.priceSettingGroupId
        ? (groupOrder.get(second.priceSettingGroupId) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER;
      if (firstOrder !== secondOrder) return firstOrder - secondOrder;
      return second.createdAt.localeCompare(first.createdAt);
    });
  }, [
    activeTab,
    documents.data,
    priceSettingGroups.data,
    priceSettingGroupsById,
    search,
    supplierFilterId,
  ]);

  function changeSupplierFilter(counterpartyId: string) {
    const params = new URLSearchParams(location.search);
    if (counterpartyId) params.set("counterpartyId", counterpartyId);
    else params.delete("counterpartyId");
    navigate(`${location.pathname}${params.size ? `?${params}` : ""}`, {
      replace: true,
      state: location.state,
    });
  }

  function changeDocumentTab(tab: DocumentTab) {
    const path = documentListPath(tab);
    const keepSupplier = tab === "RECEIPT" || tab === "PURCHASE_ORDER";
    navigate(
      keepSupplier && supplierFilterId
        ? `${path}?counterpartyId=${encodeURIComponent(supplierFilterId)}`
        : path,
    );
  }

  const columns = useMemo<AppDataTableColumn<WarehouseDocumentSummary>[]>(
    () => [
      {
        id: "number",
        header: "Документ",
        value: (document) =>
          `${document.documentNumber ?? "Черновик"} ${DOCUMENT_TYPE_LABELS[document.type]}`,
        cell: (document) => (
          <div className="warehouse-document-cell">
            <b>{document.documentNumber ?? "Черновик"}</b>
            <span>
              {activeTab === "INVENTORY"
                ? (document.reference ?? DOCUMENT_TYPE_LABELS[document.type])
                : DOCUMENT_TYPE_LABELS[document.type]}
            </span>
          </div>
        ),
      },
      ...(activeTab === "INVENTORY"
        ? []
        : [
            {
              id: "priceType",
              header: "Тип цены",
              value: (document) =>
                document.type === "PRICE_SETTING" ? priceTypeLabel(document) : "",
              cell: (document) =>
                document.type === "PRICE_SETTING" ? (
                  <AppBadge tone="blue">{priceTypeLabel(document)}</AppBadge>
                ) : (
                  "—"
                ),
            } satisfies AppDataTableColumn<WarehouseDocumentSummary>,
          ]),
      {
        id: "date",
        header: "Дата и время",
        value: (document) =>
          document.effectiveDate
            ? `${document.effectiveDate}T${document.effectiveTime?.slice(0, 5) ?? "00:00"}`
            : document.createdAt,
        sortable: activeTab !== "PRICE_SETTING",
        cell: (document) =>
          document.effectiveDate
            ? `${new Date(`${document.effectiveDate}T12:00:00`).toLocaleDateString("ru-KZ")}, ${document.effectiveTime?.slice(0, 5) ?? "00:00"}`
            : formatDateTime(document.createdAt, { dateStyle: "medium" }),
      },
      ...(activeTab === "INVENTORY"
        ? []
        : [
            {
              id: "counterparty",
              header: "Контрагент / основание",
              value: (document) => `${document.counterpartyName ?? ""} ${document.reference ?? ""}`,
              cell: (document) => (
                <div className="warehouse-document-cell">
                  <b>{document.counterpartyName ?? "—"}</b>
                  {document.reference && <span>{document.reference}</span>}
                </div>
              ),
            } satisfies AppDataTableColumn<WarehouseDocumentSummary>,
          ]),
      {
        id: "status",
        header: "Статус",
        value: (document) => STATUS_LABELS[document.status],
        cell: (document) => (
          <AppBadge tone={STATUS_TONES[document.status]}>{STATUS_LABELS[document.status]}</AppBadge>
        ),
      },
    ],
    [activeTab],
  );

  function togglePriceGroup(groupId: string) {
    setCollapsedPriceGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function openPriceGroupRules(group: WarehousePriceSettingGroup) {
    setEditedPriceGroupInput(priceGroupInput(group));
    setEditedPriceGroup(group);
  }

  function priceGroupActions(group: WarehousePriceSettingGroup): AppContextMenuAction[] {
    const canPost = group.documents.some((document) => document.status !== "POSTED");
    const canCancel = group.documents.some((document) => document.status === "POSTED");
    return [
      {
        label: "Провести документы",
        icon: <CheckCircle2 size={17} />,
        disabled: !canPost,
        onSelect: () => setPendingGroupAction({ type: "post", group }),
      },
      {
        label: "Отменить проведение",
        icon: <RotateCcw size={17} />,
        disabled: !canCancel,
        onSelect: () => setPendingGroupAction({ type: "cancel", group }),
      },
      {
        label: "Удалить все документы",
        icon: <Trash2 size={17} />,
        destructive: true,
        separatorBefore: true,
        onSelect: () => setPendingGroupAction({ type: "delete", group }),
      },
    ];
  }

  async function openPriceGroupPdf(group: WarehousePriceSettingGroup) {
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      appToast.error("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
      return;
    }

    previewWindow.document.title = "Формируем PDF…";
    previewWindow.document.body.textContent = "Формируем таблицу цен…";
    setExportingPriceGroupId(group.id);
    try {
      const pdfUrl = URL.createObjectURL(await downloadWarehousePriceSettingGroupPdf(group.id));
      previewWindow.location.replace(pdfUrl);
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 30 * 60 * 1000);
    } catch (error) {
      previewWindow.close();
      appToast.error(errorMessage(error));
    } finally {
      setExportingPriceGroupId(null);
    }
  }

  async function exportDocumentPdf(document: WarehouseDocumentSummary) {
    if (exportingDocumentId) return;
    setExportingDocumentId(document.id);
    try {
      await saveWarehouseDocumentPdf(document);
    } catch (error) {
      appToast.error(errorMessage(error));
    } finally {
      setExportingDocumentId(null);
    }
  }

  function savePriceGroupRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editedPriceGroupInput.name.trim()) return;
    updatePriceGroup.mutate();
  }

  const panel = (
    <DataPanel
      title={activeTab === "INVENTORY" ? "Инвентаризации" : "Документы склада"}
      actions={
        activeTab === "CUSTOMER_RETURN" ? undefined : (
          <>
            <AppButton
              type="button"
              onClick={() =>
                navigate(newDocumentPath(activeTab === "all" ? initialType : activeTab), {
                  state: { returnTo },
                })
              }
            >
              <FilePlus2 size={17} />
              {activeTab === "INVENTORY" ? "Создать инвентаризацию" : "Создать документ"}
            </AppButton>
          </>
        )
      }
      className="warehouse-table-panel"
    >
      {documents.isError ? (
        <div className="warehouse-panel-state">
          <AppAlert
            title="Не удалось загрузить документы"
            tone="danger"
            onRetry={documents.refetch}
          >
            Проверьте соединение с сервером и повторите попытку.
          </AppAlert>
        </div>
      ) : (
        <AppDataTable
          data={rows}
          columns={columns}
          rowId={(document) => document.id}
          loading={documents.isLoading}
          searchable={false}
          selectable={false}
          pagination={false}
          onRowClick={(document) =>
            navigate(`/admin/warehouse/documents/${document.id}`, { state: { returnTo } })
          }
          groupBy={
            activeTab === "PRICE_SETTING"
              ? (document) => document.priceSettingGroupId ?? null
              : undefined
          }
          collapsedGroupIds={collapsedPriceGroupIds}
          groupRowClassName={() => "warehouse-document-price-group-row"}
          renderGroupHeader={(group) => {
            const priceGroup = priceSettingGroupsById.get(group.id);
            const expanded = !group.collapsed;
            return (
              <div
                className="warehouse-document-price-group-header"
                role="group"
                tabIndex={priceGroup ? 0 : undefined}
                aria-label={
                  priceGroup ? `Группа ${priceGroup.name}. Контекстное меню действий` : undefined
                }
                onContextMenu={(event) => {
                  if (!priceGroup) return;
                  event.preventDefault();
                  setPriceGroupContextMenu({
                    group: priceGroup,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onKeyDown={(event) => {
                  if (
                    !priceGroup ||
                    (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                  )
                    return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setPriceGroupContextMenu({
                    group: priceGroup,
                    x: rect.left + 18,
                    y: rect.top + 18,
                  });
                }}
              >
                <div className="warehouse-document-price-group-header__title">
                  <button
                    type="button"
                    className="warehouse-document-price-group-header__toggle"
                    aria-label={expanded ? "Свернуть группу" : "Развернуть группу"}
                    aria-expanded={expanded}
                    title={expanded ? "Свернуть группу" : "Развернуть группу"}
                    onClick={() => togglePriceGroup(group.id)}
                  >
                    {expanded ? <ChevronDown size={19} /> : <ChevronRight size={19} />}
                  </button>
                  <Layers3 size={19} />
                  <span>
                    <b>{priceGroup?.name ?? "Группа установки цен"}</b>
                    <small>Документов: {priceGroup?.documents.length ?? group.rows.length}</small>
                  </span>
                </div>
                <div className="warehouse-document-price-group-header__actions">
                  <AppButton
                    type="button"
                    variant="secondary"
                    className="warehouse-document-price-group-header__export"
                    loading={exportingPriceGroupId === group.id}
                    loadingText="Формируем"
                    onClick={() =>
                      priceGroup
                        ? openPriceGroupPdf(priceGroup)
                        : appToast.error("Не удалось сформировать таблицу группы")
                    }
                  >
                    <Printer size={16} />
                    PDF-таблица
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    className="warehouse-document-price-group-header__edit"
                    onClick={() =>
                      priceGroup
                        ? openPriceGroupRules(priceGroup)
                        : appToast.error("Не удалось открыть правила группы")
                    }
                  >
                    <Pencil size={16} />
                    Изменить правила
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    className="warehouse-document-price-group-header__create"
                    onClick={() =>
                      navigate(`/admin/warehouse/price-settings/new?groupId=${group.id}`, {
                        state: { returnTo },
                      })
                    }
                  >
                    <FilePlus2 size={16} />
                    Создать документ
                  </AppButton>
                </div>
              </div>
            );
          }}
          rowClassName={(document) =>
            activeTab === "PRICE_SETTING" && document.priceSettingGroupId
              ? "warehouse-document-price-group-child"
              : undefined
          }
          contextMenuActions={(document) => [
            {
              label: document.status === "POSTED" ? "Открыть документ" : "Редактировать",
              icon: <Pencil size={17} />,
              onSelect: () =>
                navigate(`/admin/warehouse/documents/${document.id}`, { state: { returnTo } }),
            },
            ...(document.type === "PURCHASE_ORDER" || document.type === "RECEIPT"
              ? [
                  {
                    label: "Скачать PDF",
                    icon: <FileDown size={17} />,
                    disabled: exportingDocumentId !== null,
                    onSelect: () => void exportDocumentPdf(document),
                  },
                ]
              : []),
            ...(document.status !== "POSTED"
              ? [
                  {
                    label: "Провести",
                    icon: <CheckCircle2 size={17} />,
                    onSelect: () => setPendingAction({ type: "post", document }),
                  },
                ]
              : []),
            ...(document.status === "POSTED"
              ? [
                  {
                    label: "Отменить проведение",
                    icon: <RotateCcw size={17} />,
                    onSelect: () => setPendingAction({ type: "cancel", document }),
                  },
                ]
              : []),
            {
              label: "Удалить",
              icon: <Trash2 size={17} />,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setPendingAction({ type: "delete", document }),
            },
          ]}
          contextMenuLabel={(document) => `Действия: ${document.documentNumber ?? "Черновик"}`}
          toolbarFilters={
            <>
              <AppInput
                fieldClassName="warehouse-documents-filter-search"
                aria-label={
                  activeTab === "INVENTORY"
                    ? "Поиск по инвентаризациям"
                    : "Поиск по документам склада"
                }
                placeholder={
                  activeTab === "INVENTORY"
                    ? "Номер или основание"
                    : "Номер, поставщик или комментарий"
                }
                prefix={<Search size={18} />}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {activeTab !== "INVENTORY" && (
                <AppSelect
                  fieldClassName="warehouse-documents-filter-type"
                  ariaLabel="Тип документа"
                  options={DOCUMENT_FILTER_OPTIONS}
                  value={activeTab}
                  clearable={false}
                  onValueChange={(value) => changeDocumentTab(value as DocumentTab)}
                />
              )}
              {showsSupplierFilter && (
                <AppSelect
                  fieldClassName="warehouse-documents-filter-supplier"
                  ariaLabel="Поставщик"
                  searchable
                  clearable={false}
                  options={[
                    { value: "", label: "Все поставщики" },
                    ...(counterparties.data ?? []).map((counterparty) => ({
                      value: counterparty.id,
                      label: counterparty.name,
                    })),
                  ]}
                  value={supplierFilterId}
                  disabled={counterparties.isLoading || counterparties.isError}
                  onValueChange={(value) => changeSupplierFilter(String(value))}
                />
              )}
            </>
          }
          emptyTitle={activeTab === "INVENTORY" ? "Инвентаризаций пока нет" : "Документов пока нет"}
          emptyDescription={
            activeTab === "INVENTORY"
              ? "Создайте инвентаризацию и добавьте товары для пересчёта."
              : "Создайте первый документ: ввод начальных остатков или приход."
          }
        />
      )}
    </DataPanel>
  );

  return (
    <AdminPage
      eyebrow="Внутренний учёт"
      title={activeTab === "INVENTORY" ? "Инвентаризация" : "Документы склада"}
    >
      <div className="warehouse-page">
        {activeTab === "INVENTORY" ? (
          <AppAlert title="Пересчёт остатков" tone="info">
            Фактическое количество изменит остатки после проведения инвентаризации.
          </AppAlert>
        ) : (
          <AppAlert title="Документы меняют остатки только после проведения" tone="info">
            Черновики можно редактировать. Проведённый документ сохраняется в истории и меняет
            внутренний складской учёт.
          </AppAlert>
        )}
        {panel}
      </div>
      <AppModal
        title={
          pendingAction?.type === "delete"
            ? "Удалить документ?"
            : pendingAction?.type === "cancel"
              ? "Отменить проведение?"
              : "Провести документ?"
        }
        description={
          pendingAction?.document.type === "PURCHASE_ORDER" && pendingAction.type !== "delete"
            ? "Заказ фиксирует ожидаемую поставку. Остатки меняются только при проведении приходов."
            : pendingAction?.type === "delete"
              ? "Документ будет скрыт из истории и исключён из всех складских расчётов. Его данные сохранятся только для внутреннего аудита."
              : pendingAction?.type === "cancel"
                ? "Остатки будут пересчитаны с учётом отмены этого документа."
                : "После проведения документ изменит остатки на складе."
        }
        open={pendingAction !== null}
        onOpenChange={(open) => !open && setPendingAction(null)}
        contentClassName="warehouse-confirm-modal"
      >
        {pendingAction?.type === "post" && (
          <p>
            Дата документа:{" "}
            {pendingAction.document.effectiveDate
              ? `${pendingAction.document.effectiveDate.split("-").reverse().join(".")} ${pendingAction.document.effectiveTime?.slice(0, 5) ?? "00:00"}`
              : formatDateTime(pendingAction.document.createdAt)}{" "}
            (Алматы). Документ будет учтён на эту дату и время.
          </p>
        )}
        <div className="warehouse-document-page__actions">
          <AppButton type="button" variant="ghost" onClick={() => setPendingAction(null)}>
            Отмена
          </AppButton>
          <AppButton
            type="button"
            variant={pendingAction?.type === "delete" ? "danger" : "primary"}
            loading={postDocument.isPending || cancelDocument.isPending || deleteDocument.isPending}
            loadingText="Выполняем"
            onClick={() => {
              if (!pendingAction) return;
              if (pendingAction.type === "post") postDocument.mutate(pendingAction.document.id);
              if (pendingAction.type === "cancel") cancelDocument.mutate(pendingAction.document.id);
              if (pendingAction.type === "delete") deleteDocument.mutate(pendingAction.document.id);
            }}
          >
            {pendingAction?.type === "delete"
              ? "Удалить"
              : pendingAction?.type === "cancel"
                ? "Отменить проведение"
                : "Провести"}
          </AppButton>
        </div>
      </AppModal>
      <AppContextMenu
        open={priceGroupContextMenu !== null}
        x={priceGroupContextMenu?.x ?? 0}
        y={priceGroupContextMenu?.y ?? 0}
        label={`Действия с группой ${priceGroupContextMenu?.group.name ?? ""}`}
        actions={priceGroupContextMenu ? priceGroupActions(priceGroupContextMenu.group) : []}
        onOpenChange={(open) => !open && setPriceGroupContextMenu(null)}
      />
      <AppModal
        title={
          pendingGroupAction?.type === "delete"
            ? "Удалить все документы группы?"
            : pendingGroupAction?.type === "cancel"
              ? "Отменить проведение документов группы?"
              : "Провести документы группы?"
        }
        description={
          pendingGroupAction
            ? `Группа «${pendingGroupAction.group.name}». Действие охватит все документы группы, включая скрытые текущим поиском.`
            : undefined
        }
        open={pendingGroupAction !== null}
        onOpenChange={(open) => !open && !groupAction.isPending && setPendingGroupAction(null)}
        contentClassName="warehouse-confirm-modal"
      >
        {pendingGroupAction && (
          <p>
            {pendingGroupAction.type === "delete"
              ? `Количество документов для удаления: ${pendingGroupAction.group.documents.length}. Пустая группа удалится, если не выбрана в помощнике ИИ. Группа и документы сохранятся для внутреннего аудита.`
              : pendingGroupAction.type === "cancel"
                ? `Количество документов для отмены проведения: ${pendingGroupAction.group.documents.filter((document) => document.status === "POSTED").length}. Цены товаров будут пересчитаны.`
                : `Количество документов для проведения: ${pendingGroupAction.group.documents.filter((document) => document.status !== "POSTED").length}. Они будут учтены на указанные в них даты и время.`}
          </p>
        )}
        <div className="warehouse-document-page__actions">
          <AppButton
            type="button"
            variant="ghost"
            disabled={groupAction.isPending}
            onClick={() => setPendingGroupAction(null)}
          >
            Отмена
          </AppButton>
          <AppButton
            type="button"
            variant={pendingGroupAction?.type === "delete" ? "danger" : "primary"}
            loading={groupAction.isPending}
            loadingText="Выполняем"
            onClick={() => pendingGroupAction && groupAction.mutate(pendingGroupAction)}
          >
            {pendingGroupAction?.type === "delete"
              ? "Удалить все"
              : pendingGroupAction?.type === "cancel"
                ? "Отменить проведение"
                : "Провести"}
          </AppButton>
        </div>
      </AppModal>
      <AppModal
        title="Изменить правила группы"
        description="Правила и комментарий будут видны во всех документах этой группы."
        open={editedPriceGroup !== null}
        onOpenChange={(open) => !open && setEditedPriceGroup(null)}
        contentClassName="warehouse-price-group-modal"
      >
        <form className="warehouse-price-group-modal__form" onSubmit={savePriceGroupRules}>
          <AppInput
            label="Название группы"
            required
            value={editedPriceGroupInput.name}
            placeholder="Сентябрь — цены от приходной"
            onChange={(event) =>
              setEditedPriceGroupInput((current) => ({ ...current, name: event.target.value }))
            }
          />
          <AppRichTextEditor
            label="Общие правила"
            value={editedPriceGroupInput.commonRules ?? ""}
            placeholder="Опишите правила, исключения и формулы для всех типов цен этой группы."
            onValueChange={(commonRules) =>
              setEditedPriceGroupInput((current) => ({ ...current, commonRules }))
            }
          />
          <AppTextarea
            label="Комментарий"
            rows={2}
            value={editedPriceGroupInput.comment ?? ""}
            placeholder="Служебная заметка для команды"
            onChange={(event) =>
              setEditedPriceGroupInput((current) => ({ ...current, comment: event.target.value }))
            }
          />
          <div className="warehouse-price-group-modal__actions">
            <AppButton type="button" variant="ghost" onClick={() => setEditedPriceGroup(null)}>
              Отмена
            </AppButton>
            <AppButton type="submit" loading={updatePriceGroup.isPending} loadingText="Сохраняем">
              Сохранить
            </AppButton>
          </div>
        </form>
      </AppModal>
    </AdminPage>
  );
}
