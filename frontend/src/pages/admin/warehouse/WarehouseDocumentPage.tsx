import { useId, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileDown,
  FileText,
  History,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import {
  cancelWarehouseDocument,
  createReceiptFromPurchaseOrder,
  createPurchaseOrderFromRemaining,
  deleteWarehouseDocument,
  fetchWarehouseCounterparties,
  fetchPurchaseOrderProgress,
  createWarehouseDocument,
  fetchWarehouseDocument,
  fetchWarehouseDocumentHistory,
  fetchWarehousePriceSettingGroups,
  saveAndPostWarehouseDocument,
  updateWarehouseDocument,
  type WarehouseDocument,
  type WarehouseDocumentInput,
  type WarehouseDocumentSummary,
  type WarehouseDocumentType,
  type WarehouseDocumentVersion,
} from "@/shared/api/warehouse";
import { api } from "@/shared/api/http";
import { formatDateTime } from "@/shared/lib/dateTime";
import { Order } from "@/shared/types/models";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppSelect } from "@/shared/ui/AppField";
import { type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { DOCUMENT_TYPE_LABELS, WarehouseDocumentEditor } from "./WarehouseDocumentEditor";
import { WarehouseAiPriceAssistant } from "./WarehouseAiPriceAssistant";
import { saveWarehouseDocumentPdf } from "./saveWarehouseDocumentPdf";
import { clearWarehouseDocumentDraft, warehouseDocumentDraftKey } from "./warehouseDocumentDraft";
import "./WarehousePages.css";

type ManualDocumentType = Exclude<WarehouseDocumentType, "SALE">;

const VERSION_ACTION_LABELS: Record<string, string> = {
  CREATE: "Создан",
  UPDATE: "Изменён",
  POST: "Проведён",
  CANCEL: "Проведение отменено",
  DELETE: "Удалён",
};

const VERSION_ACTION_TONES: Record<string, "slate" | "blue" | "green" | "orange" | "red"> = {
  CREATE: "blue",
  UPDATE: "orange",
  POST: "green",
  CANCEL: "orange",
  DELETE: "red",
};

const RECEIPT_STATUS_LABELS: Record<WarehouseDocumentSummary["status"], string> = {
  DRAFT: "Черновик",
  POSTED: "Получено",
  CANCELLED: "Отменён",
};

const RECEIPT_STATUS_TONES: Record<
  WarehouseDocumentSummary["status"],
  "slate" | "green" | "orange"
> = {
  DRAFT: "orange",
  POSTED: "green",
  CANCELLED: "slate",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить действие";
}

function isManualType(value: WarehouseDocumentType): value is ManualDocumentType {
  return value !== "SALE";
}

function getReturnPath(state: unknown) {
  const returnTo = (state as { returnTo?: string } | null)?.returnTo;
  return typeof returnTo === "string" && returnTo.startsWith("/admin/")
    ? returnTo
    : "/admin/warehouse/documents";
}

function getReturnState(state: unknown, returnPath: string) {
  if (returnPath !== "/admin/warehouse") return undefined;

  const returnState = (
    state as { returnState?: { search?: unknown; stockFilter?: unknown } } | null
  )?.returnState;
  const search = returnState?.search;
  const stockFilter = returnState?.stockFilter;
  return typeof search === "string" || typeof stockFilter === "string"
    ? { search, stockFilter }
    : undefined;
}

function getSourceOrderId(state: unknown) {
  const sourceOrderId = (state as { sourceOrderId?: string } | null)?.sourceOrderId;
  return typeof sourceOrderId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceOrderId)
    ? sourceOrderId
    : null;
}

function getPriceSettingGroupId(search: string) {
  const groupId = new URLSearchParams(search).get("groupId");
  return groupId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(groupId) ? groupId : null;
}

export function WarehouseDocumentPage({
  initialType = "RECEIPT",
}: {
  initialType?: ManualDocumentType;
}) {
  const { documentId } = useParams();
  const { user } = useCommerce();
  const location = useLocation();
  const navigate = useNavigate();
  const returnPath = getReturnPath(location.state);
  const returnState = getReturnState(location.state, returnPath);
  const sourceOrderId = getSourceOrderId(location.state);
  const initialPriceSettingGroupId = getPriceSettingGroupId(location.search);
  const queryClient = useQueryClient();
  const [newDocumentType, setNewDocumentType] = useState<ManualDocumentType>(initialType);
  const editorFormId = useId();
  const [postConfirmation, setPostConfirmation] = useState<{
    id: string;
    documentNumber: string | null;
    input: WarehouseDocumentInput;
  } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<WarehouseDocument | null>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [exportingReceiptId, setExportingReceiptId] = useState<string | null>(null);
  const [remainingOrderCounterpartyOpen, setRemainingOrderCounterpartyOpen] = useState(false);
  const [remainingOrderCounterpartyId, setRemainingOrderCounterpartyId] = useState("");
  const [aiPriceAssistantOpen, setAiPriceAssistantOpen] = useState(false);
  const isNew = documentId === undefined;
  const documentQuery = useQuery({
    queryKey: ["warehouse-document", documentId],
    queryFn: () => fetchWarehouseDocument(documentId!),
    enabled: !isNew,
  });
  const document = documentQuery.data ?? null;
  const historyQuery = useQuery({
    queryKey: ["warehouse-document-history", documentId],
    queryFn: () => fetchWarehouseDocumentHistory(documentId!),
    enabled: !isNew,
  });
  const type = document && isManualType(document.type) ? document.type : newDocumentType;
  const localDraftKey = isNew
    ? warehouseDocumentDraftKey(user?.id, type, sourceOrderId, initialPriceSettingGroupId)
    : null;
  const purchaseProgress = useQuery({
    queryKey: ["warehouse-purchase-order-progress", documentId],
    queryFn: () => fetchPurchaseOrderProgress(documentId!),
    enabled: !isNew && type === "PURCHASE_ORDER",
  });
  const createReceipt = useMutation({
    mutationFn: () => createReceiptFromPurchaseOrder(documentId!),
    onSuccess: (receipt) => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-documents"] });
      queryClient.invalidateQueries({
        queryKey: ["warehouse-purchase-order-progress", documentId],
      });
      navigate(`/admin/warehouse/documents/${receipt.id}`, {
        state: { returnTo: `${location.pathname}${location.search}` },
      });
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const isOrderReturn = type === "CUSTOMER_RETURN";
  const counterparties = useQuery({
    queryKey: ["warehouse-counterparties"],
    queryFn: () => fetchWarehouseCounterparties(),
    enabled: remainingOrderCounterpartyOpen,
  });
  const createRemainingOrder = useMutation({
    mutationFn: (counterpartyId: string) =>
      createPurchaseOrderFromRemaining(documentId!, counterpartyId),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["warehouse-documents"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-purchase-order-progress"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-purchase-order-remainders"] });
      setProgressOpen(false);
      setRemainingOrderCounterpartyOpen(false);
      setRemainingOrderCounterpartyId("");
      appToast.success("Создан черновик заказа на неполученные товары");
      navigate(`/admin/warehouse/documents/${created.id}`, {
        state: { returnTo: `${location.pathname}${location.search}` },
      });
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const priceSettingGroups = useQuery({
    queryKey: ["warehouse-price-setting-groups"],
    queryFn: fetchWarehousePriceSettingGroups,
    enabled: type === "PRICE_SETTING" || (type === "RECEIPT" && aiPriceAssistantOpen),
  });
  const sourceOrderQuery = useQuery({
    queryKey: ["warehouse-return-source-order", sourceOrderId],
    queryFn: () => api<Order>(`/api/admin/orders/${sourceOrderId}`),
    enabled: isNew && isOrderReturn && sourceOrderId !== null,
  });
  const sourceOrder = sourceOrderQuery.data ?? null;
  const versionColumns = useMemo<AppDataTableColumn<WarehouseDocumentVersion>[]>(
    () => [
      {
        id: "version",
        header: "Версия",
        value: (version) => version.versionNumber,
        sortable: true,
        width: 106,
        cell: (version) => <b>№ {version.versionNumber}</b>,
      },
      {
        id: "action",
        header: "Событие",
        value: (version) => VERSION_ACTION_LABELS[version.action] ?? version.action,
        width: 176,
        cell: (version) => (
          <AppBadge tone={VERSION_ACTION_TONES[version.action] ?? "slate"}>
            {VERSION_ACTION_LABELS[version.action] ?? version.action}
          </AppBadge>
        ),
      },
      {
        id: "summary",
        header: "Что изменилось",
        accessor: "changeSummary",
        cell: (version) => version.changeSummary,
      },
      {
        id: "employee",
        header: "Кто изменил",
        value: (version) => version.changedByUserName ?? "Система",
        width: 178,
        cell: (version) => version.changedByUserName ?? "Система",
      },
      {
        id: "date",
        header: "Когда",
        accessor: "createdAt",
        sortable: true,
        width: 170,
        cell: (version) => formatDateTime(version.createdAt),
      },
    ],
    [],
  );

  function openReceipt(receipt: WarehouseDocumentSummary) {
    navigate(`/admin/warehouse/documents/${receipt.id}`, {
      state: { returnTo: `${location.pathname}${location.search}` },
    });
  }

  function receiptActions(receipt: WarehouseDocumentSummary): AppContextMenuAction[] {
    return [
      {
        label: "Открыть приход",
        icon: <Eye size={17} />,
        onSelect: () => openReceipt(receipt),
      },
      {
        label: "Скачать PDF",
        icon: <FileDown size={17} />,
        disabled: exportingReceiptId !== null,
        onSelect: () => void exportReceiptPdf(receipt),
      },
    ];
  }

  async function exportReceiptPdf(receipt: WarehouseDocumentSummary) {
    if (exportingReceiptId) return;
    setExportingReceiptId(receipt.id);
    try {
      await saveWarehouseDocumentPdf(receipt);
    } catch (error) {
      appToast.error(errorMessage(error));
    } finally {
      setExportingReceiptId(null);
    }
  }

  const receiptColumns = useMemo<AppDataTableColumn<WarehouseDocumentSummary>[]>(
    () => [
      {
        id: "document",
        header: "Приход",
        value: (receipt) => receipt.documentNumber ?? "Черновик прихода",
        cell: (receipt) => <b>{receipt.documentNumber ?? "Черновик прихода"}</b>,
      },
      {
        id: "status",
        header: "Статус",
        value: (receipt) => RECEIPT_STATUS_LABELS[receipt.status],
        cell: (receipt) => (
          <AppBadge tone={RECEIPT_STATUS_TONES[receipt.status]}>
            {RECEIPT_STATUS_LABELS[receipt.status]}
          </AppBadge>
        ),
        width: 150,
      },
      {
        id: "created",
        header: "Создан",
        value: (receipt) => receipt.createdAt,
        cell: (receipt) => formatDateTime(receipt.createdAt),
        width: 180,
      },
    ],
    [],
  );

  const invalidateWarehouse = async () => {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: ["warehouse-documents"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-purchase-order-progress"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-purchase-order-remainders"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-balances"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-product-movements"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse", "clean-incoming-price-history"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-analytics"] }),
      queryClient.invalidateQueries({ queryKey: ["sales-analytics-detail"] }),
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-document-history", documentId] }),
      queryClient.invalidateQueries({ queryKey: ["warehouse-price-setting-groups"] }),
    ];
    await Promise.all(invalidations);
  };
  const saveDocument = useMutation({
    mutationFn: (input: WarehouseDocumentInput) => {
      const completeInput: WarehouseDocumentInput = {
        ...input,
        sourceOrderId: isOrderReturn
          ? ((isNew ? sourceOrderId : document?.sourceOrderId) ?? null)
          : null,
      };
      return isNew
        ? createWarehouseDocument(completeInput)
        : updateWarehouseDocument(documentId!, completeInput);
    },
    onSuccess: async (saved, input) => {
      if (isNew) {
        const savedDraftKey = warehouseDocumentDraftKey(
          user?.id,
          input.type,
          sourceOrderId,
          initialPriceSettingGroupId,
        );
        if (savedDraftKey) clearWarehouseDocumentDraft(savedDraftKey);
      }
      queryClient.setQueryData(["warehouse-document", saved.id], saved);
      await invalidateWarehouse();
      appToast.success(isNew ? "Черновик создан" : "Черновик сохранён");
      if (isNew)
        navigate(`/admin/warehouse/documents/${saved.id}`, {
          replace: true,
          state: { returnTo: returnPath, returnState },
        });
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const postDocument = useMutation({
    mutationFn: (confirmation: NonNullable<typeof postConfirmation>) =>
      saveAndPostWarehouseDocument(confirmation.id, confirmation.input),
    onSuccess: async (posted) => {
      queryClient.setQueryData(["warehouse-document", posted.id], posted);
      await invalidateWarehouse();
      await documentQuery.refetch();
      setPostConfirmation(null);
      appToast.success(
        type === "PURCHASE_ORDER"
          ? "Заказ поставщику оформлен"
          : isOrderReturn
            ? "Возврат проведён"
            : "Документ проведён",
      );
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const cancelDocument = useMutation({
    mutationFn: (id: string) => cancelWarehouseDocument(id),
    onSuccess: async () => {
      await invalidateWarehouse();
      await documentQuery.refetch();
      appToast.success("Проведение документа отменено");
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });
  const deleteDocument = useMutation({
    mutationFn: (id: string) => deleteWarehouseDocument(id),
    onSuccess: async () => {
      await invalidateWarehouse();
      setDeleteConfirmation(null);
      appToast.success("Документ удалён из складского учёта");
      navigate(returnPath, { replace: true, state: returnState });
    },
    onError: (error) => appToast.error(errorMessage(error)),
  });

  const backAction = (
    <AppButton
      type="button"
      variant="ghost"
      aria-label="К документам"
      title="К документам"
      onClick={() => navigate(returnPath, { state: returnState })}
    >
      <ArrowLeft size={18} aria-hidden="true" />
    </AppButton>
  );

  if (documentQuery.isLoading) {
    return (
      <AdminPage eyebrow="Внутренний учёт" title="Документ склада" backAction={backAction}>
        <div className="warehouse-panel-state">Загружаем документ…</div>
      </AdminPage>
    );
  }
  if (documentQuery.isError || (document !== null && !isManualType(document.type))) {
    return (
      <AdminPage eyebrow="Внутренний учёт" title="Документ склада" backAction={backAction}>
        <AppAlert title="Не удалось открыть редактирование документа" tone="danger">
          Реализации ведутся в заказах, а остальные документы можно открыть из списка склада.
        </AppAlert>
      </AdminPage>
    );
  }

  const readOnly =
    document !== null && (document.status === "POSTED" || Boolean(document.deletedAt));
  const isPriceSettingDocument = type === "PRICE_SETTING";
  const title = isNew
    ? sourceOrder
      ? `Возврат по заказу № ${sourceOrder.displayCode}`
      : type === "INVENTORY"
        ? "Новая инвентаризация"
        : `Новый документ: ${DOCUMENT_TYPE_LABELS[type]}`
    : `${DOCUMENT_TYPE_LABELS[type]}${document?.documentNumber ? ` ${document.documentNumber}` : ""}`;

  return (
    <AdminPage
      eyebrow="Внутренний учёт"
      title={title}
      backAction={backAction}
      actions={
        document && !document.deletedAt ? (
          <>
            {((document.type === "RECEIPT" &&
              (document.status === "DRAFT" || document.status === "POSTED")) ||
              (document.type === "PRICE_SETTING" &&
                document.status === "DRAFT" &&
                document.priceType === "INCOMING" &&
                !document.priceSourceType &&
                Boolean(document.priceSettingGroupId))) &&
              user?.permissions?.includes("warehouse.manage") &&
              user.permissions.includes("warehouse.costs.read") && (
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => setAiPriceAssistantOpen(true)}
                >
                  <Sparkles size={17} aria-hidden="true" />
                  Помощь ИИ
                </AppButton>
              )}
            {document.status !== "POSTED" && (
              <AppButton
                type="submit"
                form={editorFormId}
                name="documentAction"
                value="post"
                disabled={
                  saveDocument.isPending || postDocument.isPending || postConfirmation !== null
                }
              >
                <CheckCircle2 size={17} />
                Провести документ
              </AppButton>
            )}
            {document.status === "POSTED" && (
              <AppButton
                type="button"
                variant="secondary"
                loading={cancelDocument.isPending}
                onClick={() => cancelDocument.mutate(document.id)}
              >
                <RotateCcw size={17} />
                Отменить проведение
              </AppButton>
            )}
          </>
        ) : undefined
      }
    >
      <div className="warehouse-page warehouse-document-page">
        {type === "PURCHASE_ORDER" && (
          <DataPanel title="Ожидаемая поставка">
            <div className="warehouse-expected-supply">
              <div className="warehouse-expected-supply__overview">
                <p>
                  Заказ фиксирует ожидаемые товары. Остатки пополняются только после проведения
                  прихода.
                </p>
                <div className="warehouse-expected-supply__actions">
                  <AppButton
                    type="button"
                    loading={createReceipt.isPending}
                    disabled={
                      !document || document.status !== "POSTED" || Boolean(document.deletedAt)
                    }
                    onClick={() => createReceipt.mutate()}
                  >
                    Оформить приход
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={!purchaseProgress.data?.hasReceipts}
                    title={
                      !purchaseProgress.data?.hasReceipts
                        ? "Сначала оформите приход по заказу"
                        : undefined
                    }
                    onClick={() => setProgressOpen(true)}
                  >
                    Осталось получить
                  </AppButton>
                </div>
              </div>
              {purchaseProgress.isError && (
                <AppAlert tone="danger" title="Не удалось загрузить приходы" />
              )}
              <AppDataTable
                className="warehouse-expected-supply__receipts"
                data={purchaseProgress.data?.receipts ?? []}
                columns={receiptColumns}
                rowId={(receipt) => receipt.id}
                density="compact"
                pagination={false}
                searchable={false}
                selectable={false}
                contextMenuActions={receiptActions}
                contextMenuLabel={(receipt) => `Действия: ${receipt.documentNumber ?? "Приход"}`}
                emptyTitle="Приходов пока нет"
                emptyDescription="Оформите приход, когда товар начнёт поступать."
              />
            </div>
          </DataPanel>
        )}
        {document?.purchaseOrderId && (
          <AppAlert tone="info" title="Приход по заказу поставщику">
            Укажите фактически полученное количество и уберите неполученные позиции перед
            проведением.
            <AppButton
              type="button"
              variant="ghost"
              onClick={() =>
                navigate(`/admin/warehouse/documents/${document.purchaseOrderId}`, {
                  state: { returnTo: location.pathname },
                })
              }
            >
              Открыть заказ поставщику
            </AppButton>
          </AppAlert>
        )}
        {isNew ? (
          isOrderReturn ? (
            <AppAlert title="Возврат привязан к исходному заказу" tone="info">
              Количество можно уменьшить или убрать позицию. Цена продажи и себестоимость будут
              взяты из завершённого заказа и проверены сервером при сохранении и проведении.
            </AppAlert>
          ) : type === "INVENTORY" ? null : (
            <AppAlert title="Сначала сохраните черновик" tone="info">
              Изменения автоматически сохраняются в этом браузере. После сохранения документа вы
              сможете отдельно подтвердить его проведение.
            </AppAlert>
          )
        ) : document?.deletedAt ? (
          <AppAlert title="Документ удалён" tone="warning">
            Он сохранён только для просмотра и истории цен связанных заказов. Восстановление пока
            недоступно.
          </AppAlert>
        ) : document?.status === "POSTED" ? (
          <AppAlert title="Документ уже проведён" tone="success">
            Чтобы исправить данные, отмените проведение, измените документ и проведите его снова.
          </AppAlert>
        ) : document?.status === "CANCELLED" ? (
          <AppAlert title="Проведение отменено" tone="info">
            Измените позиции и проведите документ снова. Текущие данные сохранятся при проведении.
            До повторного проведения документ не влияет на остатки.
          </AppAlert>
        ) : null}

        {isNew && isOrderReturn && sourceOrderId === null ? (
          <AppAlert title="Возврат создаётся из заказа" tone="warning">
            Откройте завершённый заказ и выберите действие «Создать возврат». Так система сможет
            подставить только его товары и цены.
          </AppAlert>
        ) : sourceOrderQuery.isLoading ? (
          <div className="warehouse-panel-state">Загружаем состав исходного заказа…</div>
        ) : sourceOrderQuery.isError ? (
          <AppAlert title="Не удалось открыть исходный заказ" tone="danger">
            Вернитесь к заказу и создайте возврат повторно.
          </AppAlert>
        ) : (
          <WarehouseDocumentEditor
            formId={editorFormId}
            document={document}
            type={type}
            sourceOrder={sourceOrder}
            priceSettingGroups={priceSettingGroups.data ?? []}
            initialPriceSettingGroupId={initialPriceSettingGroupId}
            saving={saveDocument.isPending}
            readOnly={
              readOnly ||
              saveDocument.isPending ||
              postDocument.isPending ||
              postConfirmation !== null
            }
            typeSelectable={isNew && initialType !== "INVENTORY"}
            localDraftKey={localDraftKey}
            onTypeChange={setNewDocumentType}
            onSave={(input) => saveDocument.mutate(input)}
            onPost={(input) => {
              if (!document || readOnly || saveDocument.isPending || postDocument.isPending) return;
              setPostConfirmation({
                id: document.id,
                documentNumber: document.documentNumber ?? null,
                input: {
                  ...input,
                  sourceOrderId: isOrderReturn ? (document.sourceOrderId ?? null) : null,
                },
              });
            }}
            onDelete={
              document?.status === "DRAFT" && !document.deletedAt
                ? () => setDeleteConfirmation(document)
                : undefined
            }
            deleting={deleteDocument.isPending}
          />
        )}

        {!isNew && (
          <DataPanel
            title="История изменений"
            size="compact"
            className="warehouse-document-history"
            actions={<History size={18} aria-hidden="true" />}
          >
            <AppDataTable
              data={historyQuery.data ?? []}
              columns={versionColumns}
              rowId={(version) => String(version.id)}
              loading={historyQuery.isLoading}
              error={historyQuery.isError ? "Не удалось загрузить историю изменений." : undefined}
              selectable={false}
              searchable={false}
              pagination={false}
              density="compact"
              expandedRowId={expandedVersionId}
              onExpandedRowIdChange={(versionId) => setExpandedVersionId(versionId)}
              renderExpandedRow={(version) => <WarehouseDocumentVersionDetails version={version} />}
              emptyTitle="История пока пуста"
              emptyDescription="Следующая правка, проведение или отмена документа появятся здесь."
            />
          </DataPanel>
        )}
      </div>

      {(document?.type === "RECEIPT" ||
        (document?.type === "PRICE_SETTING" && document.priceType === "INCOMING")) && (
        <WarehouseAiPriceAssistant
          receipt={document}
          groups={priceSettingGroups.data ?? []}
          open={aiPriceAssistantOpen}
          onClose={() => setAiPriceAssistantOpen(false)}
          onConfirmed={() => {
            void invalidateWarehouse().then(() => documentQuery.refetch());
          }}
        />
      )}

      <AppModal
        title="Провести документ?"
        description={
          type === "PURCHASE_ORDER"
            ? "Заказ зафиксирует ожидаемую поставку. После этого можно оформить приход фактически полученных товаров."
            : isPriceSettingDocument
              ? "Цены будут учтены на дату документа с сохранением более поздних установок цен. Документ нельзя будет отредактировать напрямую."
              : type === "INVENTORY"
                ? "Фактическое количество будет зафиксировано на дату документа. Последующие движения и инвентаризации будут пересчитаны."
                : "После проведения остатки и себестоимость последующих операций будут пересчитаны. Документ нельзя будет отредактировать напрямую."
        }
        open={postConfirmation !== null}
        onOpenChange={(open) => !open && !postDocument.isPending && setPostConfirmation(null)}
        contentClassName="warehouse-confirm-modal"
      >
        <div className="warehouse-confirm-modal__summary">
          <FileText size={20} />
          <span>{postConfirmation?.documentNumber ?? "Черновик"}</span>
        </div>
        <p>
          Дата документа: {postConfirmation?.input.effectiveDate?.split("-").reverse().join(".")}{" "}
          {postConfirmation?.input.effectiveTime?.slice(0, 5)} (Алматы). Текущие изменения будут
          сохранены и проведены вместе.
        </p>
        <div className="warehouse-document-page__actions">
          <AppButton
            type="button"
            variant="ghost"
            disabled={postDocument.isPending}
            onClick={() => setPostConfirmation(null)}
          >
            Отмена
          </AppButton>
          <AppButton
            type="button"
            loading={postDocument.isPending}
            loadingText="Проводим"
            onClick={() => postConfirmation && postDocument.mutate(postConfirmation)}
          >
            <CheckCircle2 size={17} />
            Подтвердить проведение
          </AppButton>
        </div>
      </AppModal>
      <AppModal
        title="Удалить документ?"
        description={
          deleteConfirmation?.status === "POSTED"
            ? "Проведение будет отменено, а документ исключён из складского учёта. Данные останутся только во внутреннем аудите."
            : "Черновик будет исключён из складского учёта. Данные останутся только во внутреннем аудите."
        }
        open={deleteConfirmation !== null}
        onOpenChange={(open) => !open && setDeleteConfirmation(null)}
        contentClassName="warehouse-confirm-modal"
      >
        <div className="warehouse-confirm-modal__summary">
          <FileText size={20} />
          <span>{deleteConfirmation?.documentNumber ?? "Черновик"}</span>
        </div>
        <div className="warehouse-document-page__actions">
          <AppButton type="button" variant="ghost" onClick={() => setDeleteConfirmation(null)}>
            Отмена
          </AppButton>
          <AppButton
            type="button"
            variant="danger"
            loading={deleteDocument.isPending}
            loadingText="Удаляем"
            onClick={() => deleteConfirmation && deleteDocument.mutate(deleteConfirmation.id)}
          >
            <Trash2 size={17} />
            Удалить документ
          </AppButton>
        </div>
      </AppModal>
      <AppModal
        open={progressOpen}
        onOpenChange={setProgressOpen}
        title="Осталось получить"
        description="Полученное количество считается только по проведённым приходам. Черновики и отменённые приходы не учитываются."
        contentClassName="warehouse-purchase-progress-modal"
      >
        <div className="warehouse-expected-supply__overview">
          <p>Новый заказ будет заполнен оставшимися количествами и ценами исходного заказа.</p>
          <AppButton
            type="button"
            loading={createRemainingOrder.isPending}
            loadingText="Создаём заказ"
            disabled={
              document?.status !== "POSTED" ||
              Boolean(document?.deletedAt) ||
              !purchaseProgress.data?.hasReceipts ||
              !purchaseProgress.data.lines.some((line) => line.available > 0)
            }
            onClick={() => setRemainingOrderCounterpartyOpen(true)}
          >
            Создать заказ на остаток
          </AppButton>
        </div>
        <AppDataTable
          data={purchaseProgress.data?.lines ?? []}
          rowId={(line) => String(line.productId)}
          columns={[
            { id: "product", header: "Товар", accessor: "productName" },
            { id: "sku", header: "Артикул", accessor: "sku" },
            { id: "ordered", header: "Заказано", accessor: "ordered" },
            { id: "received", header: "Получено", accessor: "received" },
            { id: "remaining", header: "Не получено", accessor: "remaining" },
            { id: "transferred", header: "Перенесено в заказы", accessor: "transferred" },
            { id: "available", header: "Доступно для заказа", accessor: "available" },
          ]}
          emptyTitle="Нет позиций"
        />
      </AppModal>
      <AppModal
        open={remainingOrderCounterpartyOpen}
        onOpenChange={(open) => {
          setRemainingOrderCounterpartyOpen(open);
          if (!open) setRemainingOrderCounterpartyId("");
        }}
        title="Контрагент нового заказа"
        description="Выберите контрагента для нового заказа. Он не наследуется из исходного заказа или выбранных остатков."
        contentClassName="warehouse-confirm-modal"
      >
        <AppSelect
          label="Контрагент"
          required
          searchable
          error={
            !remainingOrderCounterpartyId ? "Выберите контрагента для нового заказа" : undefined
          }
          value={remainingOrderCounterpartyId}
          onValueChange={(value) => setRemainingOrderCounterpartyId(String(value))}
          options={[
            { value: "", label: "Выберите контрагента" },
            ...(counterparties.data ?? []).map((counterparty) => ({
              value: counterparty.id,
              label: counterparty.name,
            })),
          ]}
          disabled={counterparties.isLoading}
        />
        <div className="warehouse-document-page__actions">
          <AppButton
            type="button"
            variant="ghost"
            onClick={() => setRemainingOrderCounterpartyOpen(false)}
          >
            Отмена
          </AppButton>
          <AppButton
            type="button"
            loading={createRemainingOrder.isPending}
            loadingText="Создаём заказ"
            disabled={!remainingOrderCounterpartyId || counterparties.isLoading}
            onClick={() => createRemainingOrder.mutate(remainingOrderCounterpartyId)}
          >
            Создать заказ
          </AppButton>
        </div>
      </AppModal>
    </AdminPage>
  );
}

function WarehouseDocumentVersionDetails({ version }: { version: WarehouseDocumentVersion }) {
  const { snapshot } = version;
  return (
    <section
      className="warehouse-document-history__details"
      aria-label={`Версия ${version.versionNumber}`}
    >
      <div className="warehouse-document-history__details-heading">
        <div>
          <b>Состояние документа после версии № {version.versionNumber}</b>
          <span>
            {DOCUMENT_TYPE_LABELS[snapshot.type]} · {snapshot.lines.length} поз.
          </span>
        </div>
        <AppBadge tone={VERSION_ACTION_TONES[version.action] ?? "slate"}>
          {VERSION_ACTION_LABELS[version.action] ?? version.action}
        </AppBadge>
      </div>
      {(snapshot.counterpartyName ||
        snapshot.reference ||
        snapshot.comment ||
        snapshot.effectiveDate) && (
        <dl className="warehouse-document-history__metadata">
          {snapshot.effectiveDate && (
            <div>
              <dt>Дата и время документа</dt>
              <dd>
                {new Date(`${snapshot.effectiveDate}T12:00:00`).toLocaleDateString("ru-KZ")},{" "}
                {snapshot.effectiveTime?.slice(0, 5) ?? "00:00"}
              </dd>
            </div>
          )}
          {snapshot.reference && (
            <div>
              <dt>Основание</dt>
              <dd>{snapshot.reference}</dd>
            </div>
          )}
          {snapshot.counterpartyName && (
            <div>
              <dt>Контрагент</dt>
              <dd>{snapshot.counterpartyName}</dd>
            </div>
          )}
          {snapshot.comment && (
            <div>
              <dt>Комментарий</dt>
              <dd>{snapshot.comment}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="warehouse-document-history__lines">
        {snapshot.lines.map((line) => (
          <div key={`${line.productId}-${line.sku}`} className="warehouse-document-history__line">
            <div>
              <b>{line.productName}</b>
              <span>Арт. {line.sku}</span>
            </div>
            <strong>{line.quantity} ед.</strong>
            {line.unitCost !== null && line.unitCost !== undefined && (
              <span>Себест. {Number(line.unitCost).toLocaleString("ru-KZ")} ₸</span>
            )}
            {line.comment && <span>{line.comment}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
