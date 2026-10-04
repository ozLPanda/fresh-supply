import { useMemo, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import {
  fetchWarehouseProductMovements,
  fetchWarehouseRecalculationPreview,
  type WarehouseRecalculationPreview,
  type WarehouseDocumentStatus,
  type WarehouseDocumentType,
  type WarehouseProductMovement,
} from "@/shared/api/warehouse";
import { ALMATY_TIME_ZONE, formatDateTime } from "@/shared/lib/dateTime";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppDateRangePicker, type AppDateRange } from "@/shared/ui/AppDatePicker";
import { AppSelect } from "@/shared/ui/AppField";
import { DataPanel } from "@/shared/ui/DataPanel";
import type { WarehouseBalancesReturnState } from "./WarehouseBalancesPage";
import "./WarehousePages.css";

const numberFormatter = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 3 });

const DOCUMENT_TYPE_LABELS: Record<WarehouseDocumentType, string> = {
  PURCHASE_ORDER: "Заказ поставщику",
  OPENING_BALANCE: "Ввод начальных остатков",
  RECEIPT: "Приход",
  PRICE_SETTING: "Установка цен",
  CUSTOMER_RETURN: "Возврат",
  INVENTORY: "Инвентаризация",
  SALE: "Реализация",
};

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

type OperationFilter = WarehouseDocumentType | "CANCELLATION" | "all";

type WarehouseDetailLocationState = {
  returnTo?: string;
  returnState?: WarehouseBalancesReturnState;
};

const OPERATION_FILTER_OPTIONS: Array<{ value: OperationFilter; label: string }> = [
  { value: "all", label: "Все операции" },
  { value: "OPENING_BALANCE", label: "Начальные остатки" },
  { value: "RECEIPT", label: "Приходы" },
  { value: "CUSTOMER_RETURN", label: "Возвраты" },
  { value: "INVENTORY", label: "Инвентаризация" },
  { value: "SALE", label: "Реализации" },
  { value: "CANCELLATION", label: "Отмена проведения" },
];

function movementLabel(movement: WarehouseProductMovement) {
  return movement.movementType.startsWith("CANCEL_")
    ? "Отмена проведения"
    : DOCUMENT_TYPE_LABELS[movement.documentType];
}

function cost(value: number | null, fractionDigits = 2) {
  return value === null
    ? "—"
    : `${value.toLocaleString("ru-KZ", { maximumFractionDigits: fractionDigits })} ₸`;
}

function quantity(value: number, signed = false) {
  const absolute = numberFormatter.format(Math.abs(value));
  return signed && value > 0 ? `+${absolute}` : value < 0 ? `−${absolute}` : absolute;
}

const movementDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: ALMATY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isWithinRange(value: string, range?: AppDateRange) {
  if (!range?.from) return true;
  const occurredAt = new Date(value);
  if (Number.isNaN(occurredAt.getTime())) return false;
  // Picker Dates represent calendar fields, while movements are real instants.
  const selectedDateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const parts = movementDateFormatter.formatToParts(occurredAt);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  const occurredDate = `${part("year")}-${part("month")}-${part("day")}`;
  return (
    occurredDate >= selectedDateKey(range.from) &&
    occurredDate <= selectedDateKey(range.to ?? range.from)
  );
}

function balancesReturnContext(state: unknown) {
  const context = state as WarehouseDetailLocationState | null;
  if (context?.returnTo === "/admin/warehouse") {
    const search = context.returnState?.search;
    const stockFilter = context.returnState?.stockFilter;
    return {
      returnPath: context.returnTo,
      returnState:
        typeof search === "string" || typeof stockFilter === "string"
          ? { search, stockFilter }
          : undefined,
    };
  }

  const returnTo = context?.returnTo;
  if (typeof returnTo === "string") {
    try {
      const url = new URL(returnTo, window.location.origin);
      if (
        url.origin === window.location.origin &&
        /^\/admin\/orders\/[0-9a-f-]{36}$/i.test(url.pathname) &&
        !url.search &&
        !url.hash
      ) {
        return { returnPath: url.pathname, returnState: undefined };
      }
    } catch {
      // Invalid navigation context falls back to the warehouse balances page.
    }
  }

  return { returnPath: "/admin/warehouse", returnState: undefined };
}

export function WarehouseProductMovementsPage() {
  const { user } = useCommerce();
  const canViewCosts = user?.permissions?.includes("warehouse.costs.read") ?? false;
  const location = useLocation();
  const navigate = useNavigate();
  const { productId: rawProductId } = useParams();
  const productId = Number(rawProductId);
  const validProductId = Number.isSafeInteger(productId) && productId > 0;
  const [operation, setOperation] = useState<OperationFilter>("all");
  const [period, setPeriod] = useState<AppDateRange>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = useQuery({
    queryKey: ["warehouse-recalculation-preview", productId],
    queryFn: () => fetchWarehouseRecalculationPreview(productId),
    // An explicit click is the only trigger: no initial load, focus or retry requests.
    enabled: false,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const requestPreview = () => {
    if (!validProductId || !canViewCosts || preview.isFetching) return;
    setPreviewOpen(true);
    void preview.refetch();
  };
  const movements = useQuery({
    queryKey: ["warehouse-product-movements", productId],
    queryFn: () => fetchWarehouseProductMovements(productId),
    enabled: validProductId,
  });
  const { returnPath, returnState } = balancesReturnContext(location.state);
  const filteredMovements = useMemo(
    () =>
      (movements.data?.movements ?? []).filter((movement) => {
        const isCancellation = movement.movementType.startsWith("CANCEL_");
        const matchesOperation =
          operation === "all" ||
          (operation === "CANCELLATION"
            ? isCancellation
            : !isCancellation && movement.documentType === operation);
        return matchesOperation && isWithinRange(movement.occurredAt, period);
      }),
    [movements.data?.movements, operation, period],
  );
  const openSource = (movement: WarehouseProductMovement) => {
    if (movement.sourceOrderId) {
      navigate(`/admin/orders/${movement.sourceOrderId}`, {
        state: { returnTo: `${location.pathname}${location.search}` },
      });
      return;
    }
    navigate(`/admin/warehouse/documents/${movement.documentId}`, {
      state: { returnTo: `${location.pathname}${location.search}` },
    });
  };
  const columns = useMemo<AppDataTableColumn<WarehouseProductMovement>[]>(
    () => [
      {
        id: "occurredAt",
        header: "Дата",
        value: (movement) => movement.occurredAt,
        sortable: true,
        cell: (movement) => formatDateTime(movement.occurredAt, { dateStyle: "medium" }),
      },
      {
        id: "operation",
        header: "Операция",
        value: (movement) => `${movement.documentType} ${movement.movementType}`,
        cell: (movement) => (
          <div className="warehouse-document-cell">
            <b>{movementLabel(movement)}</b>
            {movement.movementType.startsWith("CANCEL_") && (
              <span>{DOCUMENT_TYPE_LABELS[movement.documentType]}</span>
            )}
          </div>
        ),
      },
      {
        id: "document",
        header: "Документ",
        value: (movement) => `${movement.documentNumber ?? ""} ${movement.reference ?? ""}`,
        cell: (movement) => (
          <div className="warehouse-document-cell">
            <b>{movement.documentNumber ?? (movement.sourceOrderId ? "Заказ" : "Документ")}</b>
            <span>{movement.reference ?? "—"}</span>
          </div>
        ),
      },
      {
        id: "status",
        header: "Статус",
        value: (movement) => movement.documentStatus,
        cell: (movement) => (
          <AppBadge tone={STATUS_TONES[movement.documentStatus]}>
            {STATUS_LABELS[movement.documentStatus]}
          </AppBadge>
        ),
      },
      {
        id: "quantity",
        header: "Изменение",
        value: (movement) => movement.quantity,
        align: "right",
        sortable: true,
        cell: (movement) => (
          <b
            className={
              movement.quantity > 0
                ? "warehouse-movement-quantity warehouse-movement-quantity--positive"
                : "warehouse-movement-quantity warehouse-movement-quantity--negative"
            }
          >
            {quantity(movement.quantity, true)}
          </b>
        ),
      },
      {
        id: "balance",
        header: "Остаток после",
        value: (movement) => movement.balanceAfter,
        align: "right",
        sortable: true,
        cell: (movement) => `${quantity(movement.balanceAfter)} ед.`,
      },
      {
        id: "actions",
        header: "",
        hideable: false,
        searchable: false,
        align: "right",
        width: 56,
        cell: (movement) => (
          <AppActionMenu
            label={`Действия: ${movement.documentNumber ?? "документ"}`}
            actions={[
              {
                label: movement.sourceOrderId ? "Открыть заказ" : "Открыть документ",
                icon: <ExternalLink size={17} />,
                onSelect: () => openSource(movement),
              },
            ]}
          />
        ),
      },
    ],
    [openSource],
  );
  const backAction = (
    <AppButton
      type="button"
      variant="ghost"
      aria-label={returnPath === "/admin/warehouse" ? "К остаткам" : "К заказу"}
      title={returnPath === "/admin/warehouse" ? "К остаткам" : "К заказу"}
      onClick={() => navigate(returnPath, { state: returnState })}
    >
      <ArrowLeft size={18} aria-hidden="true" />
    </AppButton>
  );

  if (!validProductId) {
    return (
      <AdminPage eyebrow="Внутренний учёт" title="Движение товара" backAction={backAction}>
        <AppAlert title="Товар не найден" tone="danger">
          Проверьте ссылку и попробуйте открыть движение товара ещё раз.
        </AppAlert>
      </AdminPage>
    );
  }

  const product = movements.data;
  return (
    <AdminPage
      eyebrow="Внутренний учёт"
      title={product ? `Движение: ${product.productName}` : "Движение товара"}
      backAction={backAction}
      actions={
        canViewCosts ? (
          <AppButton
            type="button"
            variant="secondary"
            loading={preview.isFetching}
            loadingText="Рассчитываем"
            onClick={requestPreview}
          >
            Просмотр пересчёта
          </AppButton>
        ) : undefined
      }
    >
      <div className="warehouse-page">
        <DataPanel
          title="История операций"
          className="warehouse-table-panel"
          actions={
            product ? (
              <span className="warehouse-reservations-product">
                Артикул: <b>{product.sku}</b>
              </span>
            ) : undefined
          }
        >
          {movements.isError ? (
            <div className="warehouse-panel-state">
              <AppAlert
                title="Не удалось загрузить движение товара"
                tone="danger"
                onRetry={movements.refetch}
              >
                Проверьте соединение с сервером и повторите попытку.
              </AppAlert>
            </div>
          ) : (
            <AppDataTable
              data={filteredMovements}
              columns={columns}
              rowId={(movement) => movement.id}
              loading={movements.isLoading}
              searchable={false}
              pagination={false}
              contextMenuActions={(movement) => [
                {
                  label: movement.sourceOrderId ? "Открыть заказ" : "Открыть документ",
                  icon: <ExternalLink size={17} />,
                  onSelect: () => openSource(movement),
                },
              ]}
              contextMenuLabel={(movement) => `Действия: ${movement.documentNumber ?? "документ"}`}
              toolbarFilters={
                <>
                  <AppSelect
                    fieldClassName="warehouse-movements-filter-operation"
                    ariaLabel="Тип операции"
                    options={OPERATION_FILTER_OPTIONS}
                    value={operation}
                    clearable={false}
                    onValueChange={(value) => setOperation(value as OperationFilter)}
                  />
                  <div className="warehouse-movements-filter-period">
                    <AppDateRangePicker value={period} onValueChange={setPeriod} />
                  </div>
                </>
              }
              emptyTitle="Движений пока нет"
              emptyDescription={
                product?.movements.length
                  ? "Измените фильтры, чтобы увидеть другие операции."
                  : "Операции появятся после проведения документов или реализации заказа."
              }
            />
          )}
        </DataPanel>
      </div>
      <AppModal
        title="Предварительный пересчёт товара"
        description="Расчёт по текущей сохранённой истории без применения изменений. Несохранённые правки и проведение нового документа здесь не моделируются. Фильтры журнала не ограничивают расчёт."
        open={previewOpen && canViewCosts}
        onOpenChange={setPreviewOpen}
        contentClassName="warehouse-purchase-progress-modal"
      >
        {preview.isFetching ? (
          <AppAlert title="Рассчитываем сохранённую историю" tone="info">
            Данные склада не изменяются.
          </AppAlert>
        ) : preview.isError ? (
          <AppAlert
            title="Не удалось получить предварительный расчёт"
            tone="danger"
            onRetry={requestPreview}
          >
            {preview.error instanceof Error ? preview.error.message : "Повторите запрос позднее."}
          </AppAlert>
        ) : preview.data ? (
          <div className="warehouse-page">
            <AppAlert
              title={preview.data.issues.length ? "Расчёт содержит замечания" : "Расчёт получен"}
              tone={preview.data.issues.length ? "warning" : "info"}
            >
              {preview.data.issues.length
                ? "Перед применением пересчёта необходимо разобрать диагностику ниже. Значения могут быть неполными."
                : "Это предварительные значения на момент запроса. Изменения не применены."}
            </AppAlert>
            {(!preview.data.beforeStockValueComplete || !preview.data.afterStockValueComplete) && (
              <AppAlert title="Стоимость запасов неполная" tone="warning">
                У части оставшихся партий не указана себестоимость. Суммы ниже учитывают только
                партии с известной стоимостью.
              </AppAlert>
            )}
            {preview.data.issues.length > 0 && (
              <DataPanel title="Диагностика" size="compact">
                <ul>
                  {preview.data.issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </DataPanel>
            )}
            <DataPanel title="Остатки и стоимость" size="compact">
              <AppDataTable
                data={[
                  {
                    id: "balance",
                    label: "Количество",
                    before: `${quantity(preview.data.beforeBalance)} ед.`,
                    after: `${quantity(preview.data.afterBalance)} ед.`,
                  },
                  {
                    id: "value",
                    label: "Стоимость запасов",
                    before: cost(preview.data.beforeStockValue),
                    after: cost(preview.data.afterStockValue),
                  },
                ]}
                columns={[
                  { id: "label", header: "Показатель", accessor: "label" },
                  { id: "before", header: "Сохранено", accessor: "before", align: "right" },
                  { id: "after", header: "По пересчёту", accessor: "after", align: "right" },
                ]}
                rowId={(row) => row.id}
                searchable={false}
                selectable={false}
                pagination={false}
              />
            </DataPanel>
            <DataPanel title="Изменения движений" size="compact" className="warehouse-table-panel">
              <AppDataTable<WarehouseRecalculationPreview["movements"][number]>
                data={preview.data.movements.filter(
                  (movement) =>
                    movement.beforeQuantity !== movement.afterQuantity ||
                    movement.beforeUnitCost !== movement.afterUnitCost,
                )}
                columns={[
                  {
                    id: "movement",
                    header: "Движение / документ",
                    cell: (movement) => {
                      const source = product?.movements.find(
                        (item) => item.id === movement.movementId,
                      );
                      return (
                        <div className="warehouse-document-cell">
                          <span>{movement.movementId}</span>
                          <AppButton
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              if (source) openSource(source);
                              else {
                                navigate(`/admin/warehouse/documents/${movement.documentId}`, {
                                  state: { returnTo: `${location.pathname}${location.search}` },
                                });
                              }
                            }}
                          >
                            <ExternalLink size={16} />
                            {source?.documentNumber ?? "Открыть документ"}
                          </AppButton>
                        </div>
                      );
                    },
                  },
                  {
                    id: "beforeQuantity",
                    header: "Количество: сохранено",
                    align: "right",
                    cell: (movement) => quantity(movement.beforeQuantity, true),
                  },
                  {
                    id: "afterQuantity",
                    header: "Количество: пересчёт",
                    align: "right",
                    cell: (movement) => quantity(movement.afterQuantity, true),
                  },
                  {
                    id: "beforeCost",
                    header: "Себестоимость: сохранено",
                    align: "right",
                    cell: (movement) => cost(movement.beforeUnitCost, 6),
                  },
                  {
                    id: "afterCost",
                    header: "Себестоимость: пересчёт",
                    align: "right",
                    cell: (movement) => cost(movement.afterUnitCost, 6),
                  },
                ]}
                rowId={(movement) => movement.movementId}
                searchable={false}
                selectable={false}
                pagination
                defaultPageSize={20}
                emptyTitle="Изменений движений нет"
                emptyDescription="Расчёт не выявил изменений количества и себестоимости движений."
              />
            </DataPanel>
          </div>
        ) : null}
        <div className="warehouse-document-page__actions">
          <AppButton
            type="button"
            variant="secondary"
            disabled={preview.isFetching}
            onClick={requestPreview}
          >
            Обновить расчёт
          </AppButton>
          <AppButton type="button" variant="ghost" onClick={() => setPreviewOpen(false)}>
            Закрыть
          </AppButton>
        </div>
      </AppModal>
    </AdminPage>
  );
}
