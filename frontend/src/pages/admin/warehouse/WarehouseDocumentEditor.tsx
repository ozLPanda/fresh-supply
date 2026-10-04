import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Eye,
  FolderPlus,
  FileDown,
  PackagePlus,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  type WarehouseDocument,
  type PurchaseAllocation,
  type PurchaseOrderRemainder,
  type WarehouseDocumentInput,
  type WarehouseDocumentLine,
  type WarehouseDocumentType,
  type WarehouseDocumentSummary,
  type WarehouseCounterpartyInput,
  type WarehousePriceSettingGroup,
  type WarehousePriceSettingOperation,
  type WarehousePriceSettingSourceType,
  type WarehousePriceType,
  fetchWarehouseCleanIncomingPriceHistory,
  fetchWarehouseDocument,
  fetchWarehouseCounterparties,
  fetchWarehouseDocuments,
  createWarehouseCounterparty,
  previewWarehousePriceSetting,
  updateWarehousePriceSettingGroup,
  type WarehousePriceSettingGroupInput,
} from "@/shared/api/warehouse";
import { OrderProductPickerModal } from "@/features/orders/OrderProductPickerModal";
import {
  WAREHOUSE_SOURCE_DOCUMENT_TYPES,
  WarehouseSourceDocumentPickerModal,
} from "./WarehouseSourceDocumentPickerModal";
import { PurchaseOrderRemainderPickerModal } from "./PurchaseOrderRemainderPickerModal";
import { WarehouseSupplierProductsPickerModal } from "./WarehouseSupplierProductsPickerModal";
import { saveWarehouseDocumentPdf } from "./saveWarehouseDocumentPdf";
import { reorderWarehouseDocumentLine } from "./warehouseDocumentLineOrder";
import "./WarehouseDocumentLineOrder.css";
import { selectNumericInputOnFocus } from "./selectNumericInputOnFocus";
import { WarehouseInventoryAiAssistant } from "./WarehouseInventoryAiAssistant";
import { WarehousePriceGroupCreateModal } from "./WarehousePriceGroupCreateModal";
import type { InventoryAiRow } from "@/shared/api/warehouseInventoryAi";
import {
  clearWarehouseDocumentDraft,
  readWarehouseDocumentDraft,
  writeWarehouseDocumentDraft,
  type WarehouseDocumentLocalDraft,
} from "./warehouseDocumentDraft";
import {
  emptyWarehouseCounterpartyInput,
  WarehouseCounterpartyFields,
} from "./WarehouseCounterpartyFields";
import { Order, Product } from "@/shared/types/models";
import { AppButton, AppSplitButton } from "@/shared/ui/AppButton";
import {
  AppInput,
  AppMoneyInput,
  AppNumberInput,
  AppSelect,
  AppTextarea,
} from "@/shared/ui/AppField";
import { AppDateTimePicker } from "@/shared/ui/AppDatePicker";
import { AppAlert, AppModal, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppChart, AppChartTooltip, appChartColors } from "@/shared/ui/AppChart";
import { timeInAlmaty, todayInAlmaty } from "@/shared/lib/dateTime";
import { Checkbox } from "@/components/ui/checkbox";
import { appToast } from "@/shared/ui/AppToast";
import { AppContextMenu, type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppFloatingWindow } from "@/shared/ui/AppFloatingWindow";
import { AppRichTextEditor, RichTextPreview } from "@/shared/ui/AppRichTextEditor";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";

type EditableLine = WarehouseDocumentLine & {
  localId: string;
  originalUnitPrice?: number | null;
  receiptAmount?: number | null;
  receiptAmountDriven?: boolean;
  /** System incoming price offered when the product was added to a supplier order. */
  suggestedUnitCost?: number | null;
};
type PriceLineContextMenuState = {
  line: EditableLine;
  x: number;
  y: number;
};
type PriceAdjustmentStep = {
  operation: "PERCENT" | "AMOUNT";
  value: number;
};
type GroupDocumentImportMode = "PRICES_ONLY" | "PRODUCTS_AND_PRICES";
type ManualDocumentType = Exclude<WarehouseDocumentType, "SALE">;

function priceGroupInput(group: WarehousePriceSettingGroup): WarehousePriceSettingGroupInput {
  return {
    name: group.name,
    commonRules: group.commonRules ?? "",
    comment: group.comment ?? "",
  };
}

const DOCUMENT_TYPE_LABELS: Record<ManualDocumentType, string> = {
  OPENING_BALANCE: "Ввод начальных остатков",
  RECEIPT: "Приход",
  PURCHASE_ORDER: "Заказ поставщику",
  CUSTOMER_RETURN: "Возврат",
  INVENTORY: "Инвентаризация",
  PRICE_SETTING: "Установка цен",
};

const PRICE_TYPE_OPTIONS: Array<{ value: WarehousePriceType; label: string }> = [
  { value: "RETAIL", label: "Розничная" },
  { value: "WHOLESALE", label: "Оптовая" },
  { value: "BULK_WHOLESALE", label: "Крупно-оптовая" },
  { value: "SKO", label: "СКО" },
  { value: "GSKO", label: "ГСКО" },
  { value: "INCOMING", label: "Приходная" },
];

const PRICE_SOURCE_OPTIONS: Array<{ value: WarehousePriceSettingSourceType | ""; label: string }> =
  [
    { value: "", label: "Вручную" },
    {
      value: "CLEAN_INCOMING",
      label: "Чистая приходная (последний приход, иначе из карточки)",
    },
    { value: "PRICE_TYPE", label: "Цена из карточки товара" },
  ];

const PRICE_OPERATION_OPTIONS: Array<{ value: WarehousePriceSettingOperation; label: string }> = [
  { value: "COPY", label: "Скопировать" },
  { value: "PERCENT", label: "Изменить на процент" },
  { value: "AMOUNT", label: "Изменить на сумму" },
];

function priceTypeLabel(priceType: WarehousePriceType) {
  return PRICE_TYPE_OPTIONS.find((option) => option.value === priceType)?.label ?? priceType;
}

function roundPrice(value: number | null | undefined) {
  return Math.max(1, Math.round(value ?? 0));
}

function roundReceiptUnitCost(value: number) {
  return Number(value.toFixed(6));
}

function roundReceiptAmount(value: number) {
  return Number(value.toFixed(2));
}

function InventoryQuantityInput({
  value,
  productName,
  disabled,
  onValueChange,
}: {
  value: number;
  productName: string;
  disabled: boolean;
  onValueChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return (
    <AppInput
      type="text"
      inputMode="decimal"
      label="Фактически"
      aria-label={`Фактически: ${productName}`}
      required
      pattern="[0-9]+([.,][0-9]{1,3})?"
      title="Укажите количество с точностью до трёх знаков после запятой"
      value={text}
      disabled={disabled}
      onFocus={(event) => {
        focused.current = true;
        selectNumericInputOnFocus(event);
      }}
      onChange={(event) => {
        const next = event.target.value;
        if (!/^\d*(?:[.,]\d{0,3})?$/.test(next)) return;
        const parsed = Number(next.replace(",", "."));
        if (Number.isFinite(parsed) && parsed > 99_999_999_999.999) return;
        setText(next);
        if (next !== "" && next !== "." && next !== ",") onValueChange(parsed);
      }}
      onBlur={() => {
        focused.current = false;
        setText(String(value));
      }}
    />
  );
}

function receiptAmount(line: EditableLine) {
  if (line.receiptAmountDriven) return line.receiptAmount ?? null;
  return line.unitCost == null ? null : roundReceiptAmount(line.quantity * line.unitCost);
}

function formatPrice(value: number) {
  return `${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 0 }).format(value)} ₸`;
}

const incomingHistoryDateFormatter = new Intl.DateTimeFormat("ru-KZ", {
  timeZone: "Asia/Almaty",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function useCleanIncomingPriceHistory(productId: number) {
  return useQuery({
    queryKey: ["warehouse", "clean-incoming-price-history", productId],
    queryFn: () => fetchWarehouseCleanIncomingPriceHistory(productId),
    retry: false,
  });
}

function CleanIncomingPriceHistoryToggle({
  productId,
  expanded,
  onToggle,
}: {
  productId: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const historyQuery = useCleanIncomingPriceHistory(productId);
  const hasHistory = (historyQuery.data ?? []).some((point) => point.unitCost !== null);
  if (!hasHistory) return null;

  return (
    <AppButton
      type="button"
      variant="ghost"
      className="warehouse-document-editor__incoming-cost-history-toggle"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? "Скрыть" : "Подробнее"}
    </AppButton>
  );
}

function CleanIncomingPriceHistory({ productId }: { productId: number }) {
  const historyQuery = useCleanIncomingPriceHistory(productId);
  const chartData = useMemo(
    () =>
      (historyQuery.data ?? [])
        .filter((point) => point.unitCost !== null)
        .map((point) => ({
          label: incomingHistoryDateFormatter.format(new Date(point.occurredAt)),
          unitCost: point.unitCost,
          documentNumber: point.documentNumber ?? "Приход",
        })),
    [historyQuery.data],
  );

  if (historyQuery.isLoading) return <AppSkeleton />;
  if (historyQuery.isError) {
    return (
      <AppAlert title="Не удалось загрузить историю приходных цен" tone="danger">
        Повторите попытку позднее.
      </AppAlert>
    );
  }
  if (chartData.length === 0) {
    return (
      <p className="warehouse-document-editor__incoming-cost-history-empty">
        Проведённых приходов пока нет.
      </p>
    );
  }

  return (
    <AppChart
      title="Динамика чистой приходной цены"
      description="Каждая точка — проведённый приход товара."
      height={230}
    >
      <LineChart data={chartData} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="4 4" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis
          dataKey="unitCost"
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(value) =>
            new Intl.NumberFormat("ru-KZ", { notation: "compact" }).format(value)
          }
        />
        <AppChartTooltip
          formatter={(value) => [formatPrice(Number(value)), "Чистая приходная"]}
          labelFormatter={(_, payload) =>
            (payload[0] as { payload?: { documentNumber?: string; label?: string } } | undefined)
              ?.payload?.documentNumber ?? "Приход"
          }
        />
        <Line
          type="monotone"
          dataKey="unitCost"
          name="Чистая приходная"
          stroke={appChartColors.orange}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={{ r: 4, fill: appChartColors.orange, strokeWidth: 0 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </AppChart>
  );
}

function formatPriceAdjustmentStep({ operation, value }: PriceAdjustmentStep) {
  const sign = value >= 0 ? "+" : "−";
  const absolute = Math.abs(value);
  if (operation === "PERCENT") {
    return `${sign}${absolute.toLocaleString("ru-KZ", { maximumFractionDigits: 2 })}%`;
  }
  return `${sign}${formatPrice(absolute)}`;
}

const dateFromKey = (value: string) => new Date(`${value}T12:00:00`);
const dateKey = (value?: Date) =>
  value
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
        value.getDate(),
      ).padStart(2, "0")}`
    : null;

function documentMoment(date = todayInAlmaty(), time = timeInAlmaty()) {
  const value = dateFromKey(date);
  const [hour, minute] = time.split(":").map(Number);
  value.setHours(hour || 0, minute || 0, 0, 0);
  return value;
}

function documentCreatedMoment(createdAt: string) {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return documentMoment();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(created);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return documentMoment(
    `${part("year")}-${part("month")}-${part("day")}`,
    `${part("hour")}:${part("minute")}`,
  );
}

function timeKey(value?: Date) {
  if (!value) return null;
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function newLine(product: Product): EditableLine | null {
  if (!product.id) return null;
  return {
    localId: crypto.randomUUID(),
    productId: product.id,
    sku: product.sku,
    productName: product.nameRu,
    quantity: 1,
    unitCost: null,
  };
}

function priceForType(product: Product, priceType: WarehousePriceType) {
  switch (priceType) {
    case "WHOLESALE":
      return product.wholesalePrice;
    case "BULK_WHOLESALE":
      return product.bulkWholesalePrice;
    case "SKO":
      return product.skoPrice;
    case "GSKO":
      return product.gskoPrice;
    case "INCOMING":
      return product.incomingPrice;
    default:
      return product.price;
  }
}

function toEditableLine(line: WarehouseDocumentLine): EditableLine {
  return {
    ...line,
    localId: String(line.id ?? `${line.productId}-${crypto.randomUUID()}`),
    originalUnitPrice: line.unitPrice ?? null,
  };
}

async function loadSourceDocuments(documents: WarehouseDocumentSummary[]) {
  const loaded: WarehouseDocument[] = [];
  for (let index = 0; index < documents.length; index += 8) {
    loaded.push(
      ...(await Promise.all(
        documents.slice(index, index + 8).map((document) => fetchWarehouseDocument(document.id)),
      )),
    );
  }
  return loaded;
}

export function WarehouseDocumentEditor({
  document,
  type,
  onSave,
  onPost,
  formId,
  saving,
  onDelete,
  deleting,
  readOnly = false,
  typeSelectable = false,
  onTypeChange,
  sourceOrder,
  priceSettingGroups = [],
  initialPriceSettingGroupId,
  localDraftKey,
}: {
  document: WarehouseDocument | null;
  type: ManualDocumentType;
  onSave: (input: WarehouseDocumentInput) => void;
  onPost?: (input: WarehouseDocumentInput) => void;
  formId?: string;
  saving?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  readOnly?: boolean;
  typeSelectable?: boolean;
  onTypeChange?: (type: ManualDocumentType) => void;
  sourceOrder?: Order | null;
  priceSettingGroups?: WarehousePriceSettingGroup[];
  initialPriceSettingGroupId?: string | null;
  localDraftKey?: string | null;
}) {
  const [reference, setReference] = useState("");
  const [counterpartyId, setCounterpartyId] = useState("");
  const [counterpartyCreateOpen, setCounterpartyCreateOpen] = useState(false);
  const [newCounterpartyInput, setNewCounterpartyInput] = useState<WarehouseCounterpartyInput>(
    emptyWarehouseCounterpartyInput,
  );
  const [comment, setComment] = useState("");
  const [receiptBasisMode, setReceiptBasisMode] = useState<"ORDER" | "TEXT">("TEXT");
  const [receiptPurchaseOrderId, setReceiptPurchaseOrderId] = useState("");
  const [commentOpen, setCommentOpen] = useState(true);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [inventorySaveReviewOpen, setInventorySaveReviewOpen] = useState(false);
  const [pendingInventoryInput, setPendingInventoryInput] = useState<WarehouseDocumentInput | null>(
    null,
  );
  const [inventoryMoreOpen, setInventoryMoreOpen] = useState(false);
  const [inventoryAiOpen, setInventoryAiOpen] = useState(false);
  const importedInventoryIdsRef = useRef<Set<number>>(new Set());
  const inventoryAiAnchorRef = useRef<number | null>(null);
  const [remainderPickerOpen, setRemainderPickerOpen] = useState(false);
  const [supplierProductsPickerOpen, setSupplierProductsPickerOpen] = useState(false);
  const [sourceDocumentPickerType, setSourceDocumentPickerType] =
    useState<WarehouseDocumentType | null>(null);
  const [purchaseAllocations, setPurchaseAllocations] = useState<PurchaseAllocation[]>([]);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [clearLinesOpen, setClearLinesOpen] = useState(false);
  const [draggedLineId, setDraggedLineId] = useState<string | null>(null);
  const [dragOverLineId, setDragOverLineId] = useState<string | null>(null);
  const [expandedIncomingCostLineIds, setExpandedIncomingCostLineIds] = useState<string[]>([]);
  const [priceLineContextMenu, setPriceLineContextMenu] =
    useState<PriceLineContextMenuState | null>(null);
  const [applyingContextPriceLineId, setApplyingContextPriceLineId] = useState<string | null>(null);
  const [priceType, setPriceType] = useState<WarehousePriceType>("RETAIL");
  const [priceSettingGroupId, setPriceSettingGroupId] = useState("");
  const [priceGroupCreateOpen, setPriceGroupCreateOpen] = useState(false);
  const [priceGroupRulesPreviewOpen, setPriceGroupRulesPreviewOpen] = useState(false);
  const [priceGroupRulesEditOpen, setPriceGroupRulesEditOpen] = useState(false);
  const [priceGroupRulesInput, setPriceGroupRulesInput] = useState<WarehousePriceSettingGroupInput>(
    { name: "", commonRules: "", comment: "" },
  );
  const [documentPriceRulePreviewOpen, setDocumentPriceRulePreviewOpen] = useState(false);
  const [documentPriceRuleEditOpen, setDocumentPriceRuleEditOpen] = useState(false);
  const [priceRuleComment, setPriceRuleComment] = useState("");
  const [priceRuleCommentDraft, setPriceRuleCommentDraft] = useState("");
  const [priceSourceType, setPriceSourceType] = useState<WarehousePriceSettingSourceType | "">("");
  const [priceSourcePriceType, setPriceSourcePriceType] = useState<WarehousePriceType>("INCOMING");
  const [priceOperation, setPriceOperation] = useState<WarehousePriceSettingOperation>("MANUAL");
  const [priceOperationValue, setPriceOperationValue] = useState("");
  const [importingSourceDocument, setImportingSourceDocument] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [groupDocumentFillOpen, setGroupDocumentFillOpen] = useState(false);
  const [groupDocumentFillId, setGroupDocumentFillId] = useState("");
  const [groupDocumentImportMode, setGroupDocumentImportMode] =
    useState<GroupDocumentImportMode>("PRODUCTS_AND_PRICES");
  const [selectedPriceLineIds, setSelectedPriceLineIds] = useState<string[]>([]);
  const [priceAdjustmentStepsByLineId, setPriceAdjustmentStepsByLineId] = useState<
    Record<string, PriceAdjustmentStep[]>
  >({});
  const [collapsedProductGroupNames, setCollapsedProductGroupNames] = useState<string[]>([]);
  const [productGroupModalOpen, setProductGroupModalOpen] = useState(false);
  const [productGroupName, setProductGroupName] = useState("");
  const [applyingPriceRule, setApplyingPriceRule] = useState(false);
  const [manualPriceAdjustmentOperation, setManualPriceAdjustmentOperation] = useState<
    "PERCENT" | "AMOUNT"
  >("PERCENT");
  const [manualPriceAdjustmentValue, setManualPriceAdjustmentValue] = useState("");
  const [effectiveAt, setEffectiveAt] = useState(() => documentMoment());
  const [effectiveAtValid, setEffectiveAtValid] = useState(true);
  const [effectiveAtModified, setEffectiveAtModified] = useState(false);
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);
  const [priceInputValueByLineId, setPriceInputValueByLineId] = useState<Record<string, string>>(
    {},
  );
  const counterparties = useQuery({
    queryKey: ["warehouse-counterparties"],
    queryFn: () => fetchWarehouseCounterparties(),
    enabled: type === "RECEIPT" || type === "PURCHASE_ORDER",
  });
  const supplierOrders = useQuery({
    queryKey: ["warehouse-documents", "supplier-orders", counterpartyId],
    queryFn: fetchWarehouseDocuments,
    enabled: type === "RECEIPT" && Boolean(counterpartyId),
  });
  const [priceBeforeEditingByLineId, setPriceBeforeEditingByLineId] = useState<
    Record<string, number>
  >({});
  const queryClient = useQueryClient();
  const createCounterparty = useMutation({
    mutationFn: () =>
      createWarehouseCounterparty({
        ...newCounterpartyInput,
        name: newCounterpartyInput.name.trim(),
      }),
    onSuccess: async (counterparty) => {
      await queryClient.invalidateQueries({ queryKey: ["warehouse-counterparties"] });
      setCounterpartyId(counterparty.id);
      setCounterpartyCreateOpen(false);
      setNewCounterpartyInput(emptyWarehouseCounterpartyInput());
      appToast.success("Контрагент создан и выбран в документе");
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось создать контрагента"),
  });
  const updatePriceGroupRules = useMutation({
    mutationFn: () => {
      if (!selectedPriceGroup) throw new Error("Группа установки цен не выбрана");
      return updateWarehousePriceSettingGroup(selectedPriceGroup.id, priceGroupRulesInput);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["warehouse-price-setting-groups"] });
      setPriceGroupRulesEditOpen(false);
      appToast.success("Правила группы обновлены");
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось обновить правила группы"),
  });
  useEffect(() => {
    setReference(document?.reference ?? "");
    setCounterpartyId(document?.counterpartyId ?? "");
    setReceiptBasisMode(document?.purchaseOrderId ? "ORDER" : "TEXT");
    setReceiptPurchaseOrderId(document?.purchaseOrderId ?? "");
    setPurchaseAllocations(document?.purchaseAllocations ?? []);
    setRemainderPickerOpen(false);
    setClearLinesOpen(false);
    setSourceDocumentPickerType(null);
    setComment(document?.comment ?? "");
    setPriceRuleComment(document?.priceRuleComment ?? "");
    setPriceRuleCommentDraft(document?.priceRuleComment ?? "");
    setCommentOpen(true);
    setPriceType(document?.priceType ?? "RETAIL");
    setPriceSettingGroupId(document?.priceSettingGroupId ?? initialPriceSettingGroupId ?? "");
    setPriceSourceType(
      document?.priceSourceType === "GROUP_DOCUMENT" ? "" : (document?.priceSourceType ?? ""),
    );
    setPriceSourcePriceType(document?.priceSourcePriceType ?? "INCOMING");
    setPriceOperation(document?.priceOperation ?? "MANUAL");
    setPriceOperationValue(
      document?.priceOperationValue === null || document?.priceOperationValue === undefined
        ? ""
        : String(document.priceOperationValue),
    );
    setPriceInputValueByLineId({});
    setPriceBeforeEditingByLineId({});
    setSelectedPriceLineIds([]);
    setPriceAdjustmentStepsByLineId({});
    setImportingSourceDocument(false);
    setGroupDocumentFillOpen(false);
    setGroupDocumentFillId("");
    setGroupDocumentImportMode("PRODUCTS_AND_PRICES");
    setPriceLineContextMenu(null);
    setPriceGroupCreateOpen(false);
    setPriceGroupRulesPreviewOpen(false);
    setPriceGroupRulesEditOpen(false);
    setDocumentPriceRulePreviewOpen(false);
    setDocumentPriceRuleEditOpen(false);
    setApplyingContextPriceLineId(null);
    setExpandedIncomingCostLineIds([]);
    setCollapsedProductGroupNames([]);
    setProductGroupModalOpen(false);
    setProductGroupName("");
    setManualPriceAdjustmentOperation("PERCENT");
    setManualPriceAdjustmentValue("");
    setEffectiveAtModified(false);
    setEffectiveAt(
      document?.effectiveDate
        ? documentMoment(document.effectiveDate, document.effectiveTime?.slice(0, 5) ?? "00:00")
        : document?.createdAt
          ? documentCreatedMoment(document.createdAt)
          : documentMoment(),
    );
    if (document) {
      setLines((document.lines ?? []).map(toEditableLine));
      setHydratedDraftKey(null);
      return;
    }
    let initialLines: EditableLine[] = [];
    if (type === "CUSTOMER_RETURN" && sourceOrder) {
      setReference(`Возврат по заказу № ${sourceOrder.displayCode}`);
      initialLines = sourceOrder.items
        .filter((item) => item.productId !== undefined)
        .map((item) => ({
          localId: crypto.randomUUID(),
          productId: item.productId!,
          sourceOrderItemId: item.id,
          sku: item.sku,
          productName: item.nameRu,
          quantity: item.quantity,
          unitPrice: item.confirmedUnitPrice ?? item.unitPrice,
          unitCost: null,
        }));
    }
    setLines(initialLines);
    const savedDraft = localDraftKey ? readWarehouseDocumentDraft(localDraftKey, type) : null;
    if (savedDraft) {
      setReference(savedDraft.reference);
      setCounterpartyId(savedDraft.counterpartyId);
      setReceiptBasisMode(savedDraft.receiptBasisMode);
      setReceiptPurchaseOrderId(savedDraft.receiptPurchaseOrderId);
      setPurchaseAllocations(savedDraft.purchaseAllocations);
      setComment(savedDraft.comment);
      setPriceRuleComment(savedDraft.priceRuleComment);
      setPriceRuleCommentDraft(savedDraft.priceRuleComment);
      setPriceType(savedDraft.priceType);
      setPriceSettingGroupId(savedDraft.priceSettingGroupId);
      setPriceSourceType(savedDraft.priceSourceType);
      setPriceSourcePriceType(savedDraft.priceSourcePriceType);
      setPriceOperation(savedDraft.priceOperation);
      setPriceOperationValue(savedDraft.priceOperationValue);
      setEffectiveAt(new Date(savedDraft.effectiveAt));
      setEffectiveAtModified(savedDraft.effectiveAtModified);
      setLines(savedDraft.lines);
      setSelectedPriceLineIds(savedDraft.selectedPriceLineIds);
      setPriceAdjustmentStepsByLineId(savedDraft.priceAdjustmentStepsByLineId);
    }
    setHydratedDraftKey(localDraftKey ?? null);
  }, [document, initialPriceSettingGroupId, localDraftKey, sourceOrder, type]);

  useEffect(() => {
    if (document || !localDraftKey || hydratedDraftKey !== localDraftKey) return;

    const hasChanges =
      lines.length > 0 ||
      Boolean(reference.trim() || comment.trim() || priceRuleComment.trim()) ||
      Boolean(counterpartyId || receiptPurchaseOrderId || priceSettingGroupId) ||
      Boolean(priceOperationValue || priceSourceType) ||
      receiptBasisMode !== "TEXT" ||
      purchaseAllocations.length > 0 ||
      priceType !== "RETAIL" ||
      priceSourcePriceType !== "INCOMING" ||
      priceOperation !== "MANUAL" ||
      effectiveAtModified;
    if (!hasChanges) {
      clearWarehouseDocumentDraft(localDraftKey);
      return;
    }

    const draft: WarehouseDocumentLocalDraft = {
      type,
      reference,
      counterpartyId,
      receiptBasisMode,
      receiptPurchaseOrderId,
      purchaseAllocations,
      comment,
      priceRuleComment,
      priceType,
      priceSettingGroupId,
      priceSourceType,
      priceSourcePriceType,
      priceOperation,
      priceOperationValue,
      effectiveAt: effectiveAt.toISOString(),
      effectiveAtModified,
      lines,
      selectedPriceLineIds,
      priceAdjustmentStepsByLineId,
    };
    writeWarehouseDocumentDraft(localDraftKey, draft);
  }, [
    comment,
    counterpartyId,
    document,
    effectiveAt,
    effectiveAtModified,
    hydratedDraftKey,
    lines,
    localDraftKey,
    priceAdjustmentStepsByLineId,
    priceOperation,
    priceOperationValue,
    priceRuleComment,
    priceSettingGroupId,
    priceSourcePriceType,
    priceSourceType,
    priceType,
    purchaseAllocations,
    receiptBasisMode,
    receiptPurchaseOrderId,
    reference,
    selectedPriceLineIds,
    type,
  ]);

  useEffect(() => {
    if (type !== "PURCHASE_ORDER" || !document?.id) return;
    const missingSuggestions = (document.lines ?? []).filter(
      (line) => line.suggestedUnitCost === null || line.suggestedUnitCost === undefined,
    );
    if (missingSuggestions.length === 0) return;

    let cancelled = false;
    void previewWarehousePriceSetting({
      type: "PRICE_SETTING",
      priceType: "INCOMING",
      priceSettingGroupId: null,
      priceSourceType: "CLEAN_INCOMING",
      priceSourcePriceType: null,
      priceSourceDocumentId: null,
      priceOperation: "COPY",
      priceOperationValue: null,
      lines: missingSuggestions.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: null,
        manualPrice: false,
      })),
    })
      .then((preview) => {
        if (cancelled) return;
        const suggestedByProductId = new Map(
          preview.map((line) => [line.productId, line.unitPrice]),
        );
        setLines((current) =>
          current.map((line) => ({
            ...line,
            suggestedUnitCost:
              line.suggestedUnitCost ?? suggestedByProductId.get(line.productId) ?? null,
          })),
        );
      })
      .catch(() => {
        // Analytics is optional: a draft remains editable if the suggested price cannot be restored.
      });

    return () => {
      cancelled = true;
    };
  }, [document?.id, document?.lines, type]);

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, line) =>
          sum +
          (type === "RECEIPT"
            ? line.quantity > 0
              ? (receiptAmount(line) ?? 0)
              : 0
            : line.quantity *
              (type === "CUSTOMER_RETURN" ? (line.unitPrice ?? 0) : (line.unitCost ?? 0))),
        0,
      ),
    [lines, type],
  );
  const quantityTotal = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);
  const formattedTotal = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(total);
  const formattedQuantity = new Intl.NumberFormat("ru-KZ", {
    maximumFractionDigits: 3,
  }).format(quantityTotal);
  const inventoryZeroCount = lines.filter((line) => line.quantity === 0).length;
  const inventoryMissingFields = [
    ...(lines.length === 0 ? ["товар"] : []),
    ...(!effectiveAtValid ? ["дата и время"] : []),
    ...(lines.some((line) => !Number.isFinite(line.quantity) || line.quantity < 0)
      ? ["корректное количество"]
      : []),
  ];
  const isOpeningBalance = type === "OPENING_BALANCE";
  const isCustomerReturn = type === "CUSTOMER_RETURN";
  const isPriceSetting = type === "PRICE_SETTING";
  const isReceipt = type === "RECEIPT" || type === "PURCHASE_ORDER";
  const incomingPriceHistoryQueries = useQueries({
    queries: lines.map((line) => ({
      queryKey: ["warehouse", "clean-incoming-price-history", line.productId],
      queryFn: () => fetchWarehouseCleanIncomingPriceHistory(line.productId),
      enabled: isReceipt && Boolean(line.productId),
      retry: false,
    })),
  });
  const incomingPriceHistoryByLineId = new Map(
    lines.map((line, index) => [line.localId, incomingPriceHistoryQueries[index]?.data ?? []]),
  );
  const incomingCostLineIdsWithHistory = lines
    .filter((line) =>
      (incomingPriceHistoryByLineId.get(line.localId) ?? []).some(
        (point) => point.unitCost !== null,
      ),
    )
    .map((line) => line.localId);
  const expandedIncomingCostLineIdSet = new Set(expandedIncomingCostLineIds);
  const hasExpandedIncomingCostHistory = incomingCostLineIdsWithHistory.some((lineId) =>
    expandedIncomingCostLineIdSet.has(lineId),
  );
  const allIncomingCostHistoriesExpanded =
    incomingCostLineIdsWithHistory.length > 0 &&
    incomingCostLineIdsWithHistory.every((lineId) => expandedIncomingCostLineIdSet.has(lineId));
  const requiresCounterparty = type === "PURCHASE_ORDER";
  const requiresReceiptPurchaseOrder = type === "RECEIPT" && receiptBasisMode === "ORDER";
  const supplierOrderOptions = useMemo(
    () =>
      (supplierOrders.data ?? [])
        .filter(
          (item) =>
            item.type === "PURCHASE_ORDER" &&
            item.status === "POSTED" &&
            item.counterpartyId === counterpartyId,
        )
        .sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
        )
        .map((item) => ({
          value: item.id,
          label: `${item.documentNumber ?? "Без номера"} · ${item.reference ?? "Без основания"} · ${new Intl.DateTimeFormat("ru-KZ", { dateStyle: "medium" }).format(new Date(item.createdAt))}`,
        })),
    [counterpartyId, supplierOrders.data],
  );
  const quantityLabel = type === "INVENTORY" ? "Фактически" : "Количество";
  const selectedPriceGroup = priceSettingGroups.find((group) => group.id === priceSettingGroupId);
  const usedPriceTypesInSelectedGroup = useMemo(
    () =>
      new Set<WarehousePriceType>(
        (selectedPriceGroup?.documents ?? [])
          .filter(
            (item) =>
              item.type === "PRICE_SETTING" &&
              item.status !== "CANCELLED" &&
              item.id !== document?.id &&
              item.priceType !== null &&
              item.priceType !== undefined,
          )
          .map((item) => item.priceType as WarehousePriceType),
      ),
    [document?.id, selectedPriceGroup?.documents],
  );
  const availablePriceTypeOptions = useMemo(
    () =>
      priceSettingGroupId
        ? PRICE_TYPE_OPTIONS.filter((option) => !usedPriceTypesInSelectedGroup.has(option.value))
        : PRICE_TYPE_OPTIONS,
    [priceSettingGroupId, usedPriceTypesInSelectedGroup],
  );
  const groupSourceDocuments = (selectedPriceGroup?.documents ?? []).filter(
    (item) => item.status === "POSTED" && item.id !== document?.id,
  );
  const ruleIsAutomatic = priceSourceType !== "" && priceOperation !== "MANUAL";
  const isManualPriceAdjustment = priceSourceType === "";
  const priceLineSelectionEnabled = !readOnly && (ruleIsAutomatic || isManualPriceAdjustment);
  const selectedPriceLineIdSet = useMemo(
    () => new Set(selectedPriceLineIds),
    [selectedPriceLineIds],
  );
  const selectedPriceLineCount = lines.filter((line) =>
    selectedPriceLineIdSet.has(line.localId),
  ).length;
  const allPriceLinesSelected = lines.length > 0 && selectedPriceLineCount === lines.length;
  const priceLineGroups = useMemo(() => {
    const groups = new Map<string, EditableLine[]>();
    lines.forEach((line) => {
      const name = line.productGroupName?.trim() ?? "";
      const group = groups.get(name) ?? [];
      group.push(line);
      groups.set(name, group);
    });
    return Array.from(groups, ([name, groupLines]) => ({ name, lines: groupLines }));
  }, [lines]);
  const canReorderLines = !readOnly && !saving && !isCustomerReturn;

  function moveLine(sourceId: string, targetId: string, placement: "before" | "after") {
    if (!canReorderLines) return;
    setLines((current) =>
      reorderWarehouseDocumentLine(current, sourceId, targetId, placement, isPriceSetting),
    );
  }

  function resetLineDrag() {
    setDraggedLineId(null);
    setDragOverLineId(null);
  }

  function canDropLine(target: EditableLine) {
    if (!canReorderLines || !draggedLineId || draggedLineId === target.localId) return false;
    const source = lines.find((line) => line.localId === draggedLineId);
    return (
      Boolean(source) &&
      (!isPriceSetting ||
        (source?.productGroupName?.trim() ?? "") === (target.productGroupName?.trim() ?? ""))
    );
  }

  const parsedManualPriceAdjustmentValue = Number(manualPriceAdjustmentValue);
  const hasValidManualPriceAdjustment =
    manualPriceAdjustmentValue.trim() !== "" && Number.isFinite(parsedManualPriceAdjustmentValue);

  useEffect(() => {
    if (!priceSettingGroupId || availablePriceTypeOptions.length === 0) return;
    if (availablePriceTypeOptions.some((option) => option.value === priceType)) return;
    setPriceType(availablePriceTypeOptions[0].value);
  }, [availablePriceTypeOptions, priceSettingGroupId, priceType]);

  function setSourceType(value: WarehousePriceSettingSourceType | "") {
    setPriceSourceType(value);
    setPriceOperation(value ? "COPY" : "MANUAL");
  }

  function openPriceGroupRulesEditor() {
    if (!selectedPriceGroup) return;
    setPriceGroupRulesInput(priceGroupInput(selectedPriceGroup));
    setPriceGroupRulesEditOpen(true);
  }

  function savePriceGroupRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!priceGroupRulesInput.name.trim()) return;
    updatePriceGroupRules.mutate();
  }

  function openDocumentPriceRuleEditor() {
    setPriceRuleCommentDraft(priceRuleComment);
    setDocumentPriceRuleEditOpen(true);
  }

  function cancelDocumentPriceRuleEditor() {
    setPriceRuleCommentDraft(priceRuleComment);
    setDocumentPriceRuleEditOpen(false);
  }

  function saveDocumentPriceRule() {
    setPriceRuleComment(priceRuleCommentDraft);
    setDocumentPriceRuleEditOpen(false);
  }

  function setPriceLineSelected(localId: string, selected: boolean) {
    setSelectedPriceLineIds((current) =>
      selected
        ? current.includes(localId)
          ? current
          : [...current, localId]
        : current.filter((id) => id !== localId),
    );
  }

  function setPriceLinesSelected(localIds: string[], selected: boolean) {
    setSelectedPriceLineIds((current) => {
      if (selected) return Array.from(new Set([...current, ...localIds]));
      const ids = new Set(localIds);
      return current.filter((id) => !ids.has(id));
    });
  }

  function clearPriceAdjustmentSteps(localId: string) {
    setPriceAdjustmentStepsByLineId((current) => {
      if (!current[localId]) return current;
      const { [localId]: _, ...next } = current;
      return next;
    });
  }

  function defaultProductGroupName() {
    const occupiedNames = new Set(
      lines
        .map((line) => line.productGroupName?.trim())
        .filter((name): name is string => Boolean(name)),
    );
    let ordinal = 1;
    while (occupiedNames.has(`Группа ${ordinal}`)) ordinal += 1;
    return `Группа ${ordinal}`;
  }

  function createProductGroup() {
    if (selectedPriceLineCount === 0) return;
    const name = productGroupName.trim() || defaultProductGroupName();
    setLines((current) =>
      current.map((line) =>
        selectedPriceLineIdSet.has(line.localId) ? { ...line, productGroupName: name } : line,
      ),
    );
    setCollapsedProductGroupNames((current) => current.filter((item) => item !== name));
    setProductGroupModalOpen(false);
    setProductGroupName("");
    appToast.success(`Создана группа «${name}»: ${selectedPriceLineCount}`);
  }

  function ungroupPriceLines(name: string, localIds: string[]) {
    const ids = new Set(localIds);
    setLines((current) =>
      current.map((line) => (ids.has(line.localId) ? { ...line, productGroupName: null } : line)),
    );
    setCollapsedProductGroupNames((current) => current.filter((item) => item !== name));
  }

  function setProductGroupCollapsed(name: string, collapsed: boolean) {
    setCollapsedProductGroupNames((current) =>
      collapsed
        ? current.includes(name)
          ? current
          : [...current, name]
        : current.filter((item) => item !== name),
    );
  }

  async function importFromGroupDocument(documentId: string, importMode: GroupDocumentImportMode) {
    if (!documentId) return;

    setImportingSourceDocument(true);
    try {
      const sourceDocument = await fetchWarehouseDocument(documentId);
      const sourceLines = sourceDocument.lines ?? [];
      if (sourceLines.length === 0) {
        appToast.error("В документе-источнике нет товаров для переноса");
        return;
      }

      if (importMode === "PRICES_ONLY") {
        const sourcePriceByProductId = new Map(
          sourceLines.map((sourceLine) => [sourceLine.productId, roundPrice(sourceLine.unitPrice)]),
        );
        const updatedLineIds = lines
          .filter((line) => sourcePriceByProductId.has(line.productId))
          .map((line) => line.localId);

        if (updatedLineIds.length === 0) {
          appToast.error("В таблице нет товаров из выбранного документа");
          return;
        }

        setLines((current) =>
          current.map((line) => {
            const unitPrice = sourcePriceByProductId.get(line.productId);
            return unitPrice === undefined
              ? line
              : {
                  ...line,
                  unitPrice,
                  sourcePrice: null,
                  sourceDescription: null,
                  priceOperation: "MANUAL" as const,
                  priceOperationValue: null,
                  manualPrice: true,
                };
          }),
        );
        setPriceAdjustmentStepsByLineId((current) => {
          const next = { ...current };
          updatedLineIds.forEach((localId) => delete next[localId]);
          return next;
        });
        setPriceInputValueByLineId((current) => {
          const next = { ...current };
          updatedLineIds.forEach((localId) => delete next[localId]);
          return next;
        });
        setPriceBeforeEditingByLineId((current) => {
          const next = { ...current };
          updatedLineIds.forEach((localId) => delete next[localId]);
          return next;
        });
        setGroupDocumentFillOpen(false);
        setGroupDocumentFillId("");
        appToast.success(`Цены обновлены: ${updatedLineIds.length}`);
        return;
      }

      const sourceLinesByProductId = new Map(
        sourceLines.map((sourceLine) => [sourceLine.productId, sourceLine]),
      );
      const updatedLineIds = lines
        .filter((line) => sourceLinesByProductId.has(line.productId))
        .map((line) => line.localId);
      const existingProductIds = new Set(lines.map((line) => line.productId));
      const addedLines = Array.from(sourceLinesByProductId.values())
        .filter((sourceLine) => !existingProductIds.has(sourceLine.productId))
        .map((sourceLine) => {
          const unitPrice = roundPrice(sourceLine.unitPrice);
          return {
            ...sourceLine,
            localId: crypto.randomUUID(),
            quantity: 1,
            unitCost: null,
            sourceDocumentId: null,
            sourcePrice: null,
            sourceDescription: null,
            unitPrice,
            originalUnitPrice: unitPrice,
            priceOperation: "MANUAL" as const,
            priceOperationValue: null,
            manualPrice: true,
          };
        });

      setLines((current) => [
        ...current.map((line) => {
          const sourceLine = sourceLinesByProductId.get(line.productId);
          return sourceLine
            ? {
                ...line,
                unitPrice: roundPrice(sourceLine.unitPrice),
                sourcePrice: null,
                sourceDescription: null,
                priceOperation: "MANUAL" as const,
                priceOperationValue: null,
                manualPrice: true,
              }
            : line;
        }),
        ...addedLines,
      ]);
      setPriceAdjustmentStepsByLineId((current) => {
        const next = { ...current };
        updatedLineIds.forEach((localId) => delete next[localId]);
        return next;
      });
      setPriceInputValueByLineId((current) => {
        const next = { ...current };
        updatedLineIds.forEach((localId) => delete next[localId]);
        return next;
      });
      setPriceBeforeEditingByLineId((current) => {
        const next = { ...current };
        updatedLineIds.forEach((localId) => delete next[localId]);
        return next;
      });
      setGroupDocumentFillOpen(false);
      setGroupDocumentFillId("");
      appToast.success(
        [
          addedLines.length > 0 && `Добавлено товаров: ${addedLines.length}`,
          updatedLineIds.length > 0 && `Цены обновлены: ${updatedLineIds.length}`,
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (error) {
      appToast.error(error instanceof Error ? error.message : "Не удалось импортировать товары");
    } finally {
      setImportingSourceDocument(false);
    }
  }

  async function setPriceLineFromSource(
    line: EditableLine,
    sourceType: WarehousePriceSettingSourceType,
    sourcePriceType?: WarehousePriceType,
  ) {
    setApplyingContextPriceLineId(line.localId);
    try {
      const [result] = await previewWarehousePriceSetting({
        type: "PRICE_SETTING",
        priceType,
        priceSettingGroupId: priceSettingGroupId || null,
        priceSourceType: sourceType,
        priceSourcePriceType: sourceType === "PRICE_TYPE" ? (sourcePriceType ?? null) : null,
        priceSourceDocumentId: null,
        priceOperation: "COPY",
        priceOperationValue: null,
        lines: [
          {
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: line.unitPrice ?? null,
            manualPrice: false,
          },
        ],
      });
      if (!result) throw new Error("Не удалось получить цену из выбранного источника");
      updateLine(line.localId, {
        unitPrice: result.unitPrice,
        sourcePrice: result.sourcePrice,
        sourceDescription: result.sourceDescription,
        priceOperation: "MANUAL",
        priceOperationValue: null,
        manualPrice: true,
      });
      clearPriceAdjustmentSteps(line.localId);
      setPriceInputValueByLineId((current) => {
        const { [line.localId]: _, ...next } = current;
        return next;
      });
      appToast.success(`Цена обновлена: ${line.productName}`);
    } catch (error) {
      appToast.error(error instanceof Error ? error.message : "Не удалось установить цену");
    } finally {
      setApplyingContextPriceLineId(null);
    }
  }

  function priceLineContextActions(line: EditableLine): AppContextMenuAction[] {
    const documentPriceType = priceTypeLabel(priceType);
    const disabled = applyingContextPriceLineId !== null;
    return [
      {
        label: `Сбросить к актуальной цене «${documentPriceType}»`,
        icon: <RotateCcw size={17} />,
        disabled,
        onSelect: () => setPriceLineFromSource(line, "PRICE_TYPE", priceType),
      },
      {
        label: "Установить из источника",
        icon: <RotateCcw size={17} />,
        disabled,
        separatorBefore: true,
        onSelect: () => undefined,
        children: [
          {
            label: "Чистая приходная (последний приход, иначе из карточки)",
            disabled,
            onSelect: () => setPriceLineFromSource(line, "CLEAN_INCOMING"),
          },
          {
            label: "Цена из карточки товара",
            disabled,
            onSelect: () => undefined,
            children: PRICE_TYPE_OPTIONS.map((option) => ({
              label: option.label,
              disabled,
              onSelect: () => setPriceLineFromSource(line, "PRICE_TYPE", option.value),
            })),
          },
        ],
      },
    ];
  }

  async function applyPriceRuleToSelectedLines() {
    const selectedLines = lines.filter((line) => selectedPriceLineIdSet.has(line.localId));
    if (!ruleIsAutomatic || selectedLines.length === 0) return;
    setApplyingPriceRule(true);
    try {
      const preview = await previewWarehousePriceSetting({
        type: "PRICE_SETTING",
        priceType,
        priceSettingGroupId: priceSettingGroupId || null,
        priceSourceType: priceSourceType || null,
        priceSourcePriceType: priceSourceType === "PRICE_TYPE" ? priceSourcePriceType : null,
        priceSourceDocumentId: null,
        priceOperation,
        priceOperationValue:
          priceOperation === "PERCENT" || priceOperation === "AMOUNT"
            ? Number(priceOperationValue || 0)
            : null,
        lines: selectedLines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice ?? null,
          manualPrice: false,
        })),
      });
      const results = new Map(preview.map((line) => [line.productId, line]));
      setLines((current) =>
        current.map((line) => {
          const result = selectedPriceLineIdSet.has(line.localId)
            ? results.get(line.productId)
            : undefined;
          return result
            ? {
                ...line,
                unitPrice: result.unitPrice,
                sourcePrice: result.sourcePrice,
                sourceDescription: result.sourceDescription,
                priceOperation: result.priceOperation,
                priceOperationValue: result.priceOperationValue,
                manualPrice: false,
              }
            : line;
        }),
      );
      setPriceAdjustmentStepsByLineId((current) => {
        const next = { ...current };
        selectedLines.forEach((line) => {
          if (priceOperation === "PERCENT" || priceOperation === "AMOUNT") {
            next[line.localId] = [
              { operation: priceOperation, value: Number(priceOperationValue || 0) },
            ];
          } else {
            delete next[line.localId];
          }
        });
        return next;
      });
      appToast.success(`Правило применено к позициям: ${selectedLines.length}`);
    } catch (error) {
      appToast.error(error instanceof Error ? error.message : "Не удалось рассчитать цены");
    } finally {
      setApplyingPriceRule(false);
    }
  }

  function applyManualPriceAdjustmentToSelectedLines() {
    if (selectedPriceLineCount === 0 || !hasValidManualPriceAdjustment) return;
    setLines((current) =>
      current.map((line) => {
        if (!selectedPriceLineIdSet.has(line.localId)) return line;
        return {
          ...line,
          unitPrice: roundPrice(
            manualPriceAdjustmentOperation === "PERCENT"
              ? (line.unitPrice ?? 1) * (1 + parsedManualPriceAdjustmentValue / 100)
              : (line.unitPrice ?? 1) + parsedManualPriceAdjustmentValue,
          ),
          sourcePrice: null,
          sourceDescription: null,
          priceOperation: "MANUAL",
          priceOperationValue: null,
          manualPrice: true,
        };
      }),
    );
    setPriceAdjustmentStepsByLineId((current) => {
      const next = { ...current };
      const step: PriceAdjustmentStep = {
        operation: manualPriceAdjustmentOperation,
        value: parsedManualPriceAdjustmentValue,
      };
      selectedPriceLineIds.forEach((localId) => {
        next[localId] = [...(next[localId] ?? []), step];
      });
      return next;
    });
    appToast.success(`Цена изменена для позиций: ${selectedPriceLineCount}`);
  }

  async function addProduct(product: Product, quantity = 1) {
    if (!product.id) return false;
    const existingIndex = lines.findIndex((line) => line.productId === product.id);
    if (existingIndex >= 0) {
      setLines((current) =>
        current.map((line, index) =>
          index === existingIndex
            ? {
                ...line,
                quantity:
                  type === "INVENTORY" ? quantity : Number((line.quantity + quantity).toFixed(3)),
                unitCost:
                  type === "RECEIPT" &&
                  line.receiptAmountDriven &&
                  line.receiptAmount != null &&
                  line.quantity + quantity > 0
                    ? roundReceiptUnitCost(line.receiptAmount / (line.quantity + quantity))
                    : line.unitCost,
              }
            : line,
        ),
      );
    } else {
      const nextLine = newLine(product);
      if (nextLine) nextLine.quantity = quantity;
      if (nextLine && type === "PURCHASE_ORDER") {
        // The preview uses the same server-side resolver as price-setting documents: the latest
        // posted receipt cost wins, with the product-card incoming price as a fallback.
        try {
          const [suggestion] = await previewWarehousePriceSetting({
            type: "PRICE_SETTING",
            priceType: "INCOMING",
            priceSettingGroupId: null,
            priceSourceType: "CLEAN_INCOMING",
            priceSourcePriceType: null,
            priceSourceDocumentId: null,
            priceOperation: "COPY",
            priceOperationValue: null,
            lines: [
              {
                productId: product.id,
                quantity: nextLine.quantity,
                unitPrice: null,
                manualPrice: false,
              },
            ],
          });
          nextLine.unitCost = suggestion?.unitPrice ?? null;
          nextLine.suggestedUnitCost = suggestion?.unitPrice ?? null;
        } catch {
          nextLine.unitCost =
            product.incomingPrice === null || product.incomingPrice === undefined
              ? null
              : roundPrice(product.incomingPrice);
          nextLine.suggestedUnitCost = nextLine.unitCost;
        }
      }
      if (nextLine) setLines((current) => [...current, nextLine]);
    }
    return true;
  }

  function applyInventoryAiRows(rows: InventoryAiRow[]) {
    const ready = rows.filter(
      (row) => row.productId != null && row.quantity != null && !row.question,
    );
    const ids = ready.map((row) => row.productId as number);
    if (new Set(ids).size !== ids.length) {
      appToast.error(
        "В фотографиях есть повторяющаяся номенклатура. Уточните строки в чате перед переносом.",
      );
      return false;
    }
    if (
      ready.some(
        (row) =>
          !Number.isFinite(row.quantity) ||
          (row.quantity as number) < 0 ||
          Math.abs(Math.round((row.quantity as number) * 1000) - (row.quantity as number) * 1000) >
            1e-7,
      )
    ) {
      appToast.error("Количество должно быть неотрицательным числом с точностью до 0,001.");
      return false;
    }
    const imported = ready.map(
      (row): EditableLine => ({
        localId: crypto.randomUUID(),
        productId: row.productId as number,
        sku: row.sku ?? "",
        productName: row.productName ?? row.sourceName,
        quantity: row.quantity as number,
        unitCost: null,
      }),
    );
    const previousImportedIds = importedInventoryIdsRef.current;
    setLines((current) => {
      const removedIds = new Set([...previousImportedIds, ...ids]);
      const remaining = current.filter((line) => !removedIds.has(line.productId));
      if (inventoryAiAnchorRef.current == null) inventoryAiAnchorRef.current = remaining.length;
      const insertion = Math.min(inventoryAiAnchorRef.current, remaining.length);
      return [...remaining.slice(0, insertion), ...imported, ...remaining.slice(insertion)];
    });
    importedInventoryIdsRef.current = new Set(ids);
    appToast.success(`Перенесено строк: ${ready.length}. Проверьте таблицу и сохраните черновик.`);
    return true;
  }

  function addPriceSettingProduct(product: Product) {
    if (!product.id || lines.some((line) => line.productId === product.id)) return false;
    const unitPrice = roundPrice(priceForType(product, priceType));
    setLines((current) => [
      ...current,
      {
        localId: crypto.randomUUID(),
        productId: product.id!,
        sku: product.sku,
        productName: product.nameRu,
        quantity: 1,
        unitCost: null,
        unitPrice,
        originalUnitPrice: unitPrice,
      },
    ]);
    return true;
  }

  function updateLine(localId: string, patch: Partial<EditableLine>) {
    setLines((current) =>
      current.map((line) => (line.localId === localId ? { ...line, ...patch } : line)),
    );
  }

  function updateReceiptQuantity(line: EditableLine, quantity: number) {
    updateLine(line.localId, {
      quantity,
      ...(line.receiptAmountDriven
        ? {
            unitCost:
              line.receiptAmount != null && quantity > 0
                ? roundReceiptUnitCost(line.receiptAmount / quantity)
                : null,
          }
        : {}),
    });
  }

  function updateReceiptAmount(line: EditableLine, amount: number | null) {
    updateLine(line.localId, {
      receiptAmount: amount === null ? null : roundReceiptAmount(amount),
      receiptAmountDriven: true,
      unitCost:
        amount !== null && line.quantity > 0 ? roundReceiptUnitCost(amount / line.quantity) : null,
    });
  }

  function priceInputValue(line: EditableLine) {
    return Object.prototype.hasOwnProperty.call(priceInputValueByLineId, line.localId)
      ? priceInputValueByLineId[line.localId]
      : String(line.unitPrice ?? 1);
  }

  function beginPriceEditing(line: EditableLine) {
    const unitPrice = line.unitPrice ?? 1;
    setPriceBeforeEditingByLineId((current) => ({ ...current, [line.localId]: unitPrice }));
    setPriceInputValueByLineId((current) => ({ ...current, [line.localId]: String(unitPrice) }));
  }

  function updatePriceInput(line: EditableLine, value: string) {
    setPriceInputValueByLineId((current) => ({ ...current, [line.localId]: value }));
    if (value === "") return;

    const unitPrice = Number(value);
    if (Number.isFinite(unitPrice)) {
      updateLine(line.localId, { unitPrice: roundPrice(unitPrice), manualPrice: true });
      clearPriceAdjustmentSteps(line.localId);
    }
  }

  function finishPriceEditing(line: EditableLine) {
    const value = priceInputValueByLineId[line.localId];
    const previousPrice = priceBeforeEditingByLineId[line.localId] ?? line.unitPrice ?? 1;
    const parsedPrice = Number(value);
    const unitPrice =
      value?.trim() && Number.isFinite(parsedPrice) ? roundPrice(parsedPrice) : previousPrice;

    updateLine(line.localId, { unitPrice, manualPrice: true });
    if (unitPrice !== previousPrice) clearPriceAdjustmentSteps(line.localId);
    setPriceInputValueByLineId((current) => {
      const { [line.localId]: _, ...next } = current;
      return next;
    });
    setPriceBeforeEditingByLineId((current) => {
      const { [line.localId]: _, ...next } = current;
      return next;
    });
  }

  function resetPrice(line: EditableLine) {
    if (line.originalUnitPrice === null || line.originalUnitPrice === undefined) return;
    updateLine(line.localId, { unitPrice: line.originalUnitPrice, manualPrice: true });
    clearPriceAdjustmentSteps(line.localId);
    setPriceInputValueByLineId((current) => {
      const { [line.localId]: _, ...next } = current;
      return next;
    });
    setPriceBeforeEditingByLineId((current) => {
      const { [line.localId]: _, ...next } = current;
      return next;
    });
  }

  async function addPriceSettingSourceDocuments(documents: WarehouseDocumentSummary[]) {
    try {
      const selectedDocuments = await loadSourceDocuments(documents);
      if (selectedDocuments.every((sourceDocument) => !sourceDocument.lines?.length)) {
        appToast.error("В выбранных документах нет позиций для переноса");
        return null;
      }
      const existingProductIds = new Set(lines.map((line) => line.productId));
      const addedCount = new Set(
        selectedDocuments.flatMap((sourceDocument) =>
          (sourceDocument.lines ?? [])
            .filter((line) => !existingProductIds.has(line.productId))
            .map((line) => line.productId),
        ),
      ).size;
      setLines((current) => {
        const selectedProducts = new Set(current.map((line) => line.productId));
        const next = [...current];
        for (const sourceDocument of selectedDocuments) {
          for (const line of sourceDocument.lines ?? []) {
            if (selectedProducts.has(line.productId)) continue;
            selectedProducts.add(line.productId);
            const priceFromDocument =
              sourceDocument.type === "PRICE_SETTING" ||
              sourceDocument.type === "SALE" ||
              sourceDocument.type === "CUSTOMER_RETURN"
                ? (line.unitPrice ?? line.unitCost)
                : (line.unitCost ?? line.unitPrice);
            const unitPrice = roundPrice(priceFromDocument);
            next.push({
              ...line,
              localId: crypto.randomUUID(),
              quantity: sourceDocument.type === "RECEIPT" ? line.quantity : 1,
              unitCost: sourceDocument.type === "RECEIPT" ? line.unitCost : null,
              sourceDocumentId: sourceDocument.type === "RECEIPT" ? sourceDocument.id : null,
              sourcePrice: null,
              sourceDescription: null,
              priceOperation: "MANUAL",
              priceOperationValue: null,
              unitPrice,
              originalUnitPrice: unitPrice,
              manualPrice: true,
            });
          }
        }
        return next;
      });
      appToast.success(
        addedCount > 0 ? `Добавлено товаров: ${addedCount}` : "Все товары уже есть в документе",
      );
      return addedCount;
    } catch (error) {
      appToast.error(error instanceof Error ? error.message : "Не удалось загрузить документы");
      return null;
    }
  }

  async function addInventorySourceDocuments(documents: WarehouseDocumentSummary[]) {
    try {
      const sourceDocuments = await loadSourceDocuments(documents);
      const sourceLines = sourceDocuments.flatMap((sourceDocument) => sourceDocument.lines ?? []);
      if (sourceLines.length === 0) {
        appToast.error("В выбранных документах нет позиций для переноса");
        return null;
      }
      const existingProductIds = new Set(lines.map((line) => line.productId));
      const addedCount = new Set(
        sourceLines
          .filter((line) => !existingProductIds.has(line.productId))
          .map((line) => line.productId),
      ).size;
      setLines((current) => {
        const selectedProducts = new Set(current.map((line) => line.productId));
        const next = [...current];
        for (const line of sourceLines) {
          if (selectedProducts.has(line.productId)) continue;
          selectedProducts.add(line.productId);
          next.push({
            localId: crypto.randomUUID(),
            productId: line.productId,
            sku: line.sku,
            productName: line.productName,
            quantity: Math.max(0, line.quantity),
            unitCost: null,
          });
        }
        return next;
      });
      appToast.success(
        addedCount > 0
          ? `Добавлено товаров: ${addedCount}. Проверьте фактическое количество.`
          : "Все товары уже есть в документе",
      );
      return addedCount;
    } catch (error) {
      appToast.error(error instanceof Error ? error.message : "Не удалось загрузить документы");
      return null;
    }
  }

  async function addPurchaseOrderSourceDocuments(documents: WarehouseDocumentSummary[]) {
    try {
      const sourceDocuments = await loadSourceDocuments(documents);
      const sourceLines = sourceDocuments
        .flatMap((document) => (document.lines ?? []).map((line) => ({ line, document })))
        .filter(({ line }) => line.quantity > 0);
      if (sourceLines.length === 0) {
        appToast.error("В выбранных документах нет позиций с положительным количеством");
        return null;
      }
      const existingProductIds = new Set(lines.map((line) => line.productId));
      const addedCount = new Set(
        sourceLines
          .filter(({ line }) => !existingProductIds.has(line.productId))
          .map(({ line }) => line.productId),
      ).size;
      const suggestedCosts = new Map<number, number | null>();
      await Promise.all(
        Array.from(
          new Map(sourceLines.map((source) => [source.line.productId, source])).values(),
        ).map(async ({ line, document }) => {
          if (
            line.unitCost != null ||
            (document.type === "PRICE_SETTING" &&
              document.priceType === "INCOMING" &&
              line.unitPrice != null)
          )
            return;
          try {
            const [suggestion] = await previewWarehousePriceSetting({
              type: "PRICE_SETTING",
              priceType: "INCOMING",
              priceSettingGroupId: null,
              priceSourceType: "CLEAN_INCOMING",
              priceSourcePriceType: null,
              priceSourceDocumentId: null,
              priceOperation: "COPY",
              priceOperationValue: null,
              lines: [
                {
                  productId: line.productId,
                  quantity: line.quantity,
                  unitPrice: null,
                  manualPrice: false,
                },
              ],
            });
            suggestedCosts.set(line.productId, suggestion?.unitPrice ?? null);
          } catch {
            suggestedCosts.set(line.productId, null);
          }
        }),
      );
      setLines((current) => {
        const selectedProducts = new Set(current.map((line) => line.productId));
        const next = [...current];
        for (const { line, document } of sourceLines) {
          if (selectedProducts.has(line.productId)) continue;
          selectedProducts.add(line.productId);
          const unitCost =
            line.unitCost ??
            (document.type === "PRICE_SETTING" && document.priceType === "INCOMING"
              ? line.unitPrice
              : null) ??
            suggestedCosts.get(line.productId) ??
            line.suggestedUnitCost ??
            null;
          next.push({
            ...line,
            localId: crypto.randomUUID(),
            unitCost,
            suggestedUnitCost: unitCost,
            sourceDocumentId: null,
          });
        }
        return next;
      });
      appToast.success(
        addedCount > 0 ? `Добавлено товаров: ${addedCount}` : "Все товары уже есть в документе",
      );
      return addedCount;
    } catch (error) {
      appToast.error(error instanceof Error ? error.message : "Не удалось загрузить документы");
      return null;
    }
  }

  const supplierProductsImportAction = {
    label: "От поставщика",
    icon: <PackagePlus size={17} />,
    onSelect: () => setSupplierProductsPickerOpen(true),
  };

  const normalizedPurchaseAllocations = useMemo(() => {
    const capacity = new Map(lines.map((line) => [line.productId, line.quantity]));
    return purchaseAllocations
      .map((allocation) => {
        const quantity = Math.max(
          0,
          Math.min(allocation.quantity, capacity.get(allocation.productId) ?? 0),
        );
        capacity.set(allocation.productId, (capacity.get(allocation.productId) ?? 0) - quantity);
        return { ...allocation, quantity: Math.round(quantity * 1000) / 1000 };
      })
      .filter((allocation) => allocation.quantity > 0);
  }, [lines, purchaseAllocations]);

  function addOrderRemainders(orders: PurchaseOrderRemainder[]) {
    const nextLines = [...lines];
    const nextAllocations = normalizedPurchaseAllocations.map((allocation) => ({ ...allocation }));
    for (const order of orders) {
      for (const source of order.lines) {
        const index = nextLines.findIndex((line) => line.productId === source.productId);
        if (index >= 0) {
          const existing = nextLines[index];
          const quantity = Math.round((existing.quantity + source.quantity) * 1000) / 1000;
          nextLines[index] = {
            ...existing,
            quantity,
            unitCost:
              source.unitCost == null
                ? existing.unitCost
                : existing.unitCost == null
                  ? source.unitCost
                  : roundPrice(
                      (existing.unitCost * existing.quantity + source.unitCost * source.quantity) /
                        quantity,
                    ),
          };
        } else {
          nextLines.push({ ...source, localId: crypto.randomUUID() });
        }
        const allocation = nextAllocations.find(
          (item) =>
            item.sourceDocumentId === order.document.id && item.productId === source.productId,
        );
        if (allocation)
          allocation.quantity = Math.round((allocation.quantity + source.quantity) * 1000) / 1000;
        else
          nextAllocations.push({
            sourceDocumentId: order.document.id,
            productId: source.productId,
            quantity: source.quantity,
          });
      }
    }
    setLines(nextLines);
    setPurchaseAllocations(nextAllocations);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || saving || !event.currentTarget.reportValidity()) return;
    if (!effectiveAtValid) {
      appToast.error("Укажите корректную дату и время документа");
      return;
    }
    if (requiresCounterparty && !counterpartyId) {
      appToast.error("Выберите контрагента для заказа поставщику");
      return;
    }
    if (requiresReceiptPurchaseOrder && !receiptPurchaseOrderId) {
      appToast.error("Выберите заказ поставщику или укажите другое основание");
      return;
    }
    const validLines = lines.filter((line) =>
      isOpeningBalance || type === "INVENTORY" || type === "PURCHASE_ORDER" || type === "RECEIPT"
        ? line.quantity >= 0
        : line.quantity > 0,
    );
    if (validLines.length === 0 || validLines.length !== lines.length) {
      appToast.error("Добавьте позиции и укажите допустимое количество для каждой строки");
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const action = submitter?.value === "post" ? onPost : onSave;
    if (!action) return;
    const input: WarehouseDocumentInput = {
      type,
      counterpartyId:
        type === "RECEIPT" || type === "PURCHASE_ORDER" ? counterpartyId || null : null,
      purchaseOrderId: requiresReceiptPurchaseOrder ? receiptPurchaseOrderId || null : null,
      purchaseAllocations: type === "PURCHASE_ORDER" ? normalizedPurchaseAllocations : [],
      priceType: isPriceSetting ? priceType : null,
      priceSettingGroupId: isPriceSetting ? priceSettingGroupId || null : null,
      priceSourceType: isPriceSetting ? priceSourceType || null : null,
      priceSourcePriceType:
        isPriceSetting && priceSourceType === "PRICE_TYPE" ? priceSourcePriceType : null,
      priceSourceDocumentId: null,
      priceOperation: isPriceSetting ? priceOperation : null,
      priceOperationValue:
        isPriceSetting && (priceOperation === "PERCENT" || priceOperation === "AMOUNT")
          ? Number(priceOperationValue || 0)
          : null,
      priceRuleComment: isPriceSetting ? priceRuleComment.trim() || null : null,
      reference: reference.trim() || null,
      comment: comment.trim() || null,
      effectiveDate: dateKey(effectiveAt),
      effectiveTime: timeKey(effectiveAt),
      lines: validLines.map((line) => ({
        productId: line.productId,
        quantity: isPriceSetting ? 1 : line.quantity,
        unitCost: isOpeningBalance || isCustomerReturn || isPriceSetting ? null : line.unitCost,
        suggestedUnitCost: type === "PURCHASE_ORDER" ? (line.suggestedUnitCost ?? null) : null,
        sourceOrderItemId: isCustomerReturn ? line.sourceOrderItemId : null,
        sourceDocumentId: isPriceSetting ? line.sourceDocumentId : null,
        unitPrice: isCustomerReturn || isPriceSetting ? line.unitPrice : null,
        productGroupName: isPriceSetting ? line.productGroupName?.trim() || null : null,
        manualPrice: isPriceSetting
          ? ruleIsAutomatic
            ? selectedPriceLineIdSet.has(line.localId)
              ? line.manualPrice === true
              : true
            : true
          : false,
      })),
    };
    if (type === "INVENTORY" && submitter?.value !== "post") {
      setPendingInventoryInput(input);
      setInventorySaveReviewOpen(true);
      return;
    }
    action(input);
  }

  function clearAllLines() {
    setLines([]);
    setPurchaseAllocations([]);
    setSelectedPriceLineIds([]);
    setPriceAdjustmentStepsByLineId({});
    setPriceInputValueByLineId({});
    setPriceBeforeEditingByLineId({});
    setExpandedIncomingCostLineIds([]);
    setCollapsedProductGroupNames([]);
    setPriceLineContextMenu(null);
    setDraggedLineId(null);
    setDragOverLineId(null);
    importedInventoryIdsRef.current.clear();
    inventoryAiAnchorRef.current = null;
    setClearLinesOpen(false);
  }

  async function downloadPdf() {
    if (!document?.id || (type !== "PURCHASE_ORDER" && type !== "RECEIPT") || exportingPdf) {
      return;
    }

    setExportingPdf(true);
    try {
      await saveWarehouseDocumentPdf(document);
    } catch (error) {
      appToast.error(error instanceof Error ? error.message : "Не удалось выгрузить PDF документа");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <>
      <form
        id={formId}
        className={`warehouse-document-editor${isOpeningBalance ? " warehouse-document-editor--without-cost" : ""}${isCustomerReturn ? " warehouse-document-editor--customer-return" : ""}${type === "INVENTORY" ? " warehouse-document-editor--inventory" : ""}`}
        onSubmit={submit}
      >
        <div className="warehouse-document-editor__meta">
          {typeSelectable && (
            <AppSelect
              label="Тип документа"
              options={Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              value={type}
              disabled={readOnly}
              onValueChange={(value) => onTypeChange?.(value as ManualDocumentType)}
            />
          )}
          {isPriceSetting && (
            <>
              <AppSelect
                label="Тип цены"
                options={availablePriceTypeOptions}
                value={priceType}
                hint={
                  priceSettingGroupId && availablePriceTypeOptions.length === 0
                    ? "Для этой группы уже созданы документы всех типов цен."
                    : undefined
                }
                disabled={
                  readOnly ||
                  (Boolean(priceSettingGroupId) && availablePriceTypeOptions.length === 0)
                }
                clearable={false}
                onValueChange={(value) => setPriceType(value as WarehousePriceType)}
              />
              <div className="warehouse-document-editor__price-group-picker">
                <AppSelect
                  label="Группа установки цен"
                  options={[
                    { value: "", label: "Без группы" },
                    ...priceSettingGroups.map((group) => ({ value: group.id, label: group.name })),
                  ]}
                  value={priceSettingGroupId}
                  disabled={readOnly}
                  clearable={false}
                  onValueChange={(value) => setPriceSettingGroupId(String(value))}
                />
                {!readOnly && (
                  <AppButton
                    type="button"
                    variant="secondary"
                    className="warehouse-document-editor__price-group-create"
                    onClick={() => setPriceGroupCreateOpen(true)}
                  >
                    <Plus size={17} />
                    Создать группу
                  </AppButton>
                )}
              </div>
              <div className="warehouse-document-editor__group-actions">
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (selectedPriceGroup) setPriceGroupRulesPreviewOpen(true);
                    else setDocumentPriceRulePreviewOpen(true);
                  }}
                >
                  <Eye size={17} />
                  Просмотр правил
                </AppButton>
                <AppButton
                  type="button"
                  variant="secondary"
                  title={
                    selectedPriceGroup
                      ? undefined
                      : readOnly
                        ? "Проведённый документ нельзя изменить"
                        : undefined
                  }
                  disabled={!selectedPriceGroup && readOnly}
                  onClick={
                    selectedPriceGroup ? openPriceGroupRulesEditor : openDocumentPriceRuleEditor
                  }
                >
                  <Pencil size={17} />
                  Редактировать правила
                </AppButton>
              </div>
            </>
          )}
          <AppDateTimePicker
            label={type === "INVENTORY" ? "Дата и время" : "Дата и время документа"}
            required
            onValidityChange={setEffectiveAtValid}
            value={effectiveAt}
            disabled={readOnly}
            clearable={false}
            onValueChange={(value) => {
              if (value) setEffectiveAt(value);
              setEffectiveAtModified(true);
            }}
          />
          {isReceipt && (
            <div className="warehouse-document-editor__counterparty-field">
              <AppSelect
                label="Контрагент"
                required={requiresCounterparty}
                error={
                  requiresCounterparty && !counterpartyId
                    ? "Для заказа поставщику выберите контрагента"
                    : undefined
                }
                searchable
                options={[
                  {
                    value: "",
                    label: requiresCounterparty ? "Выберите контрагента" : "Не выбран",
                  },
                  ...(document?.counterpartyId &&
                  document.counterpartyName &&
                  !counterparties.data?.some((item) => item.id === document.counterpartyId)
                    ? [
                        {
                          value: document.counterpartyId,
                          label: `${document.counterpartyName} · архив`,
                        },
                      ]
                    : []),
                  ...(counterparties.data ?? []).map((counterparty) => ({
                    value: counterparty.id,
                    label: counterparty.name,
                  })),
                ]}
                value={counterpartyId}
                disabled={readOnly || counterparties.isLoading}
                onValueChange={(value) => {
                  setCounterpartyId(String(value));
                  if (type === "RECEIPT") setReceiptPurchaseOrderId("");
                }}
              />
              {!readOnly && (
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => setCounterpartyCreateOpen(true)}
                >
                  <Plus size={17} />
                  Новый
                </AppButton>
              )}
            </div>
          )}
          {type === "RECEIPT" ? (
            <div className="warehouse-document-editor__receipt-basis">
              <SegmentedControl
                ariaLabel="Способ указания основания прихода"
                items={[
                  { value: "ORDER", label: "Связать с заказом", disabled: readOnly },
                  { value: "TEXT", label: "Указать вручную", disabled: readOnly },
                ]}
                value={receiptBasisMode}
                onValueChange={(value) => {
                  const mode = value as "ORDER" | "TEXT";
                  setReceiptBasisMode(mode);
                  if (mode === "TEXT") setReceiptPurchaseOrderId("");
                }}
              />
              {receiptBasisMode === "ORDER" ? (
                <AppSelect
                  label="Заказ поставщику"
                  required
                  searchable
                  hint={
                    !counterpartyId
                      ? "Сначала выберите контрагента."
                      : receiptPurchaseOrderId
                        ? "Показаны проведённые заказы выбранного контрагента: сначала новые."
                        : undefined
                  }
                  options={[
                    { value: "", label: "Выберите заказ поставщику" },
                    ...supplierOrderOptions,
                  ]}
                  value={receiptPurchaseOrderId}
                  disabled={readOnly || !counterpartyId || supplierOrders.isLoading}
                  onValueChange={(value) => setReceiptPurchaseOrderId(String(value))}
                />
              ) : (
                <AppInput
                  label="Номер накладной или другое основание"
                  placeholder="Например: накладная № 43"
                  disabled={readOnly}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              )}
            </div>
          ) : (
            <AppInput
              label={type === "INVENTORY" ? "Основание (необязательно)" : "Основание"}
              placeholder={
                type === "INVENTORY" ? "Причина пересчёта" : "Например: результат пересчёта склада"
              }
              disabled={readOnly || isCustomerReturn}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </div>

        {isPriceSetting && (
          <section className="warehouse-price-rule" aria-label="Правило установки цен">
            <div className="warehouse-price-rule__heading">
              <div>
                <strong>Правило расчёта</strong>
                <span>Источник и формула будут сохранены вместе с каждой позицией.</span>
              </div>
            </div>
            <div className="warehouse-price-rule__fields">
              <AppSelect
                label="Источник цены"
                options={PRICE_SOURCE_OPTIONS}
                value={priceSourceType}
                disabled={readOnly}
                clearable={false}
                onValueChange={(value) =>
                  setSourceType(value as WarehousePriceSettingSourceType | "")
                }
              />
              {priceSourceType === "PRICE_TYPE" && (
                <AppSelect
                  label="Тип цены-источника"
                  options={PRICE_TYPE_OPTIONS}
                  value={priceSourcePriceType}
                  disabled={readOnly}
                  clearable={false}
                  onValueChange={(value) => setPriceSourcePriceType(value as WarehousePriceType)}
                />
              )}
              {priceSourceType !== "" && (
                <AppSelect
                  label="Операция"
                  options={PRICE_OPERATION_OPTIONS}
                  value={priceOperation === "MANUAL" ? "COPY" : priceOperation}
                  disabled={readOnly}
                  clearable={false}
                  onValueChange={(value) =>
                    setPriceOperation(value as WarehousePriceSettingOperation)
                  }
                />
              )}
              {(priceOperation === "PERCENT" || priceOperation === "AMOUNT") && (
                <AppNumberInput
                  onFocus={selectNumericInputOnFocus}
                  label={priceOperation === "PERCENT" ? "Изменение, %" : "Изменение, ₸"}
                  value={priceOperationValue}
                  placeholder="Например, -10"
                  disabled={readOnly}
                  onChange={(event) => setPriceOperationValue(event.target.value)}
                />
              )}
            </div>
            {priceLineSelectionEnabled && (
              <>
                <div className="warehouse-price-rule__actions">
                  <span>Выбрано: {selectedPriceLineCount}</span>
                  <AppButton
                    type="button"
                    variant="secondary"
                    className="warehouse-price-rule__selection-button"
                    aria-label="Выбрать все товары"
                    title="Выбрать все товары"
                    disabled={readOnly || lines.length === 0}
                    onClick={() => setSelectedPriceLineIds(lines.map((line) => line.localId))}
                  >
                    <CheckCheck size={17} />
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    className="warehouse-price-rule__selection-button"
                    aria-label="Снять выделение"
                    title="Снять выделение"
                    disabled={readOnly || selectedPriceLineCount === 0}
                    onClick={() => setSelectedPriceLineIds([])}
                  >
                    <X size={17} />
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="secondary"
                    disabled={readOnly || selectedPriceLineCount === 0}
                    onClick={() => {
                      setProductGroupName("");
                      setProductGroupModalOpen(true);
                    }}
                  >
                    <FolderPlus size={17} />
                    Создать группу
                  </AppButton>
                  {isManualPriceAdjustment ? (
                    <>
                      <SegmentedControl
                        className="warehouse-price-rule__manual-operation"
                        ariaLabel="Способ изменения цены выбранных товаров"
                        items={[
                          { value: "PERCENT", label: "Процент" },
                          { value: "AMOUNT", label: "Сумма" },
                        ]}
                        value={manualPriceAdjustmentOperation}
                        onValueChange={(value) =>
                          setManualPriceAdjustmentOperation(value as "PERCENT" | "AMOUNT")
                        }
                      />
                      <AppNumberInput
                        onFocus={selectNumericInputOnFocus}
                        fieldClassName="warehouse-price-rule__manual-adjustment"
                        aria-label={
                          manualPriceAdjustmentOperation === "PERCENT"
                            ? "Изменение цены выбранных товаров, в процентах"
                            : "Изменение цены выбранных товаров, в тенге"
                        }
                        value={manualPriceAdjustmentValue}
                        placeholder={
                          manualPriceAdjustmentOperation === "PERCENT"
                            ? "Например, -10"
                            : "Например, -500"
                        }
                        disabled={readOnly}
                        onChange={(event) => setManualPriceAdjustmentValue(event.target.value)}
                      />
                      <AppButton
                        type="button"
                        disabled={
                          readOnly || selectedPriceLineCount === 0 || !hasValidManualPriceAdjustment
                        }
                        onClick={applyManualPriceAdjustmentToSelectedLines}
                      >
                        <Play size={17} />
                        Выполнить
                      </AppButton>
                    </>
                  ) : (
                    <AppButton
                      type="button"
                      disabled={readOnly || selectedPriceLineCount === 0}
                      loading={applyingPriceRule}
                      loadingText="Рассчитываем"
                      onClick={applyPriceRuleToSelectedLines}
                    >
                      <Play size={17} />
                      Выполнить
                    </AppButton>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        <section className="warehouse-document-editor__products" aria-label="Позиции документа">
          <div className="warehouse-document-editor__products-heading">
            <div>
              <strong>Позиции документа</strong>
              <span>
                {isCustomerReturn
                  ? "Позиции и цены зафиксированы исходным заказом. Уберите товары, которые не возвращают."
                  : isPriceSetting
                    ? "Подберите товары или добавьте позиции из проведённых складских документов, затем проверьте цены."
                    : "Добавьте товары и укажите фактическое количество."}
              </span>
            </div>
            <div className="warehouse-document-editor__products-actions">
              <b>{lines.length}</b>
              {!readOnly && (
                <AppButton
                  type="button"
                  variant="ghost"
                  className="warehouse-document-editor__clear-lines"
                  aria-label="Очистить все позиции документа"
                  title="Очистить все позиции"
                  disabled={lines.length === 0 || saving}
                  onClick={() => setClearLinesOpen(true)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </AppButton>
              )}
              {!readOnly && !isCustomerReturn && (
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => setProductPickerOpen(true)}
                >
                  <PackagePlus size={17} />
                  {type === "INVENTORY" ? "Добавить товар" : "Подобрать товар"}
                </AppButton>
              )}
              {!readOnly && type === "INVENTORY" && (
                <div
                  className={`warehouse-document-editor__inventory-extra${inventoryMoreOpen ? " is-open" : ""}`}
                >
                  <AppButton
                    type="button"
                    variant="ghost"
                    className="warehouse-document-editor__inventory-extra-toggle"
                    aria-expanded={inventoryMoreOpen}
                    onClick={() => setInventoryMoreOpen((open) => !open)}
                  >
                    Другие способы добавить <ChevronDown size={16} />
                  </AppButton>
                  <div className="warehouse-document-editor__inventory-extra-content">
                    <AppButton
                      type="button"
                      variant="secondary"
                      onClick={() => setInventoryAiOpen(true)}
                    >
                      <Sparkles size={17} /> Помощь ИИ по фото
                    </AppButton>
                    <AppSplitButton
                      variant="secondary"
                      onClick={() => setSourceDocumentPickerType("RECEIPT")}
                      actions={[
                        supplierProductsImportAction,
                        ...WAREHOUSE_SOURCE_DOCUMENT_TYPES.filter(
                          (sourceType) => sourceType.type !== "RECEIPT",
                        ).map((sourceType) => ({
                          label: sourceType.actionLabel,
                          icon: <PackagePlus size={17} />,
                          onSelect: () => setSourceDocumentPickerType(sourceType.type),
                        })),
                      ]}
                    >
                      <PackagePlus size={17} />
                      Добавить из приходов
                    </AppSplitButton>
                  </div>
                </div>
              )}
              {!readOnly && type === "PURCHASE_ORDER" && (
                <AppSplitButton
                  variant="secondary"
                  onClick={() => setRemainderPickerOpen(true)}
                  actions={[
                    supplierProductsImportAction,
                    ...WAREHOUSE_SOURCE_DOCUMENT_TYPES.map((sourceType) => ({
                      label: sourceType.actionLabel,
                      icon: <PackagePlus size={17} />,
                      onSelect: () => setSourceDocumentPickerType(sourceType.type),
                    })),
                  ]}
                >
                  <PackagePlus size={17} />
                  Из остатков заказов
                </AppSplitButton>
              )}
              {isReceipt && incomingCostLineIdsWithHistory.length > 0 && (
                <>
                  <AppButton
                    type="button"
                    variant="ghost"
                    disabled={allIncomingCostHistoriesExpanded}
                    onClick={() => setExpandedIncomingCostLineIds(incomingCostLineIdsWithHistory)}
                  >
                    <ChevronDown size={17} />
                    Раскрыть все
                  </AppButton>
                  <AppButton
                    type="button"
                    variant="ghost"
                    disabled={!hasExpandedIncomingCostHistory}
                    onClick={() => setExpandedIncomingCostLineIds([])}
                  >
                    <ChevronUp size={17} />
                    Скрыть все
                  </AppButton>
                </>
              )}
              {!readOnly && isPriceSetting && (
                <AppSplitButton
                  variant="secondary"
                  onClick={() => setSourceDocumentPickerType("RECEIPT")}
                  actions={[
                    supplierProductsImportAction,
                    ...WAREHOUSE_SOURCE_DOCUMENT_TYPES.filter(
                      (sourceType) => sourceType.type !== "RECEIPT",
                    ).map((sourceType) => ({
                      label: sourceType.actionLabel,
                      icon: <PackagePlus size={17} />,
                      onSelect: () => setSourceDocumentPickerType(sourceType.type),
                    })),
                    {
                      label: "Заполнить из документа группы",
                      icon: <PackagePlus size={17} />,
                      disabled:
                        !priceSettingGroupId ||
                        groupSourceDocuments.length === 0 ||
                        importingSourceDocument,
                      onSelect: () => {
                        setGroupDocumentFillId("");
                        setGroupDocumentImportMode(
                          lines.length > 0 ? "PRICES_ONLY" : "PRODUCTS_AND_PRICES",
                        );
                        setGroupDocumentFillOpen(true);
                      },
                    },
                  ]}
                >
                  <PackagePlus size={17} />
                  Добавить из приходов
                </AppSplitButton>
              )}
            </div>
          </div>

          {!readOnly && !isCustomerReturn && lines.length > 1 && (
            <p className="warehouse-document-editor__reorder-hint">
              {isPriceSetting && priceLineGroups.some((group) => group.name)
                ? "Меняйте порядок стрелками или перетаскиванием внутри товарной группы."
                : "Меняйте порядок позиций стрелками или перетаскиванием."}{" "}
              Порядок сохранится при сохранении документа.
            </p>
          )}
          {lines.length > 0 ? (
            <div
              className={`warehouse-document-editor__line-list${type === "RECEIPT" ? " warehouse-document-editor__line-list--receipt" : ""}${isPriceSetting ? " warehouse-document-editor__line-list--price-setting" : ""}${isPriceSetting && priceLineSelectionEnabled ? " warehouse-document-editor__line-list--selectable" : ""}`}
            >
              <div className="warehouse-document-editor__line-head">
                {isPriceSetting && priceLineSelectionEnabled && (
                  <Checkbox
                    aria-label="Выбрать все товары для правила цены"
                    checked={
                      allPriceLinesSelected
                        ? true
                        : selectedPriceLineCount > 0
                          ? "indeterminate"
                          : false
                    }
                    disabled={readOnly || lines.length === 0}
                    onCheckedChange={(selected) =>
                      setSelectedPriceLineIds(
                        selected === true ? lines.map((line) => line.localId) : [],
                      )
                    }
                  />
                )}
                <span>Товар</span>
                {!isPriceSetting && <span>{quantityLabel}</span>}
                {!isOpeningBalance && type !== "INVENTORY" && (
                  <span>
                    {isCustomerReturn
                      ? "Цена в заказе"
                      : isPriceSetting
                        ? "Цена и изменение"
                        : "Приходная цена"}
                  </span>
                )}
                {!isOpeningBalance && !isPriceSetting && type !== "INVENTORY" && (
                  <span>{isCustomerReturn ? "Сумма возврата" : "Сумма"}</span>
                )}
                <span />
              </div>
              {(isPriceSetting ? priceLineGroups : [{ name: "", lines }]).map((group) => {
                const groupLineIds = group.lines.map((line) => line.localId);
                const selectedGroupLineCount = groupLineIds.filter((id) =>
                  selectedPriceLineIdSet.has(id),
                ).length;
                const allGroupLinesSelected =
                  groupLineIds.length > 0 && selectedGroupLineCount === groupLineIds.length;
                const groupCollapsed =
                  Boolean(group.name) && collapsedProductGroupNames.includes(group.name);
                return (
                  <div
                    className="warehouse-document-editor__line-group"
                    key={group.name || "ungrouped"}
                  >
                    {isPriceSetting && group.name && (
                      <div className="warehouse-document-editor__line-group-head">
                        {priceLineSelectionEnabled && (
                          <Checkbox
                            aria-label={`Выбрать все товары группы «${group.name}»`}
                            checked={
                              allGroupLinesSelected
                                ? true
                                : selectedGroupLineCount > 0
                                  ? "indeterminate"
                                  : false
                            }
                            disabled={readOnly}
                            onCheckedChange={(selected) =>
                              setPriceLinesSelected(groupLineIds, selected === true)
                            }
                          />
                        )}
                        <div>
                          <b>{group.name}</b>
                          <span>Товаров: {group.lines.length}</span>
                        </div>
                        <AppButton
                          type="button"
                          variant="ghost"
                          className="warehouse-document-editor__line-group-toggle"
                          title={groupCollapsed ? "Развернуть группу" : "Свернуть группу"}
                          aria-label={`${groupCollapsed ? "Развернуть" : "Свернуть"} группу «${group.name}»`}
                          aria-expanded={!groupCollapsed}
                          onClick={() => setProductGroupCollapsed(group.name, !groupCollapsed)}
                        >
                          {groupCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          {groupCollapsed ? "Развернуть" : "Свернуть"}
                        </AppButton>
                        {!readOnly && (
                          <AppButton
                            type="button"
                            variant="ghost"
                            className="warehouse-document-editor__line-group-clear"
                            title={`Убрать группировку «${group.name}»`}
                            aria-label={`Убрать группировку «${group.name}»`}
                            onClick={() => ungroupPriceLines(group.name, groupLineIds)}
                          >
                            <X size={16} />
                            Разгруппировать
                          </AppButton>
                        )}
                      </div>
                    )}
                    {!groupCollapsed &&
                      group.lines.map((line, lineIndex) => {
                        const baselinePrice = line.originalUnitPrice ?? line.unitPrice ?? 1;
                        const priceDelta = (line.unitPrice ?? 1) - baselinePrice;
                        const priceChanged = isPriceSetting && priceDelta !== 0;
                        const priceChangePercent =
                          baselinePrice > 0 ? (priceDelta / baselinePrice) * 100 : null;
                        const priceAdjustmentSteps =
                          priceAdjustmentStepsByLineId[line.localId] ?? [];
                        const suggestedUnitCost = line.suggestedUnitCost ?? null;
                        const latestIncomingPrice = incomingPriceHistoryByLineId
                          .get(line.localId)
                          ?.filter(
                            (point) => point.unitCost !== null && point.documentId !== document?.id,
                          )
                          .slice(-1)[0];
                        const incomingCostBaseline =
                          latestIncomingPrice?.unitCost ?? suggestedUnitCost;
                        const incomingCostDelta =
                          incomingCostBaseline === null ||
                          incomingCostBaseline === undefined ||
                          line.unitCost == null
                            ? null
                            : line.unitCost - incomingCostBaseline;
                        const incomingCostChanged =
                          isReceipt && incomingCostDelta !== null && incomingCostDelta !== 0;
                        const incomingCostChangePercent =
                          incomingCostChanged &&
                          incomingCostBaseline !== null &&
                          incomingCostBaseline !== undefined &&
                          incomingCostBaseline > 0
                            ? (incomingCostDelta / incomingCostBaseline) * 100
                            : null;
                        const incomingCostChangeMagnitude = Math.abs(
                          incomingCostChangePercent ?? 0,
                        );
                        const incomingCostChangeLevel =
                          incomingCostChangeMagnitude >= 20
                            ? "significant"
                            : incomingCostChangeMagnitude >= 5
                              ? "noticeable"
                              : "minor";
                        const incomingCostHistoryExpanded = expandedIncomingCostLineIdSet.has(
                          line.localId,
                        );
                        return (
                          <div
                            className={`warehouse-document-editor__line${group.name ? " warehouse-document-editor__line--grouped" : ""}${isPriceSetting ? " warehouse-document-editor__line--price-setting" : ""}${incomingCostChanged ? " warehouse-document-editor__line--incoming-cost-changed" : ""}${incomingCostChanged ? ` warehouse-document-editor__line--incoming-cost-${incomingCostDelta > 0 ? "increased" : "decreased"}` : ""}${incomingCostChanged && incomingCostChangeLevel === "significant" ? " warehouse-document-editor__line--incoming-cost-significant" : ""}${selectedPriceLineIdSet.has(line.localId) ? " warehouse-document-editor__line--selected" : ""}${priceChanged || incomingCostChanged ? " warehouse-document-editor__line--price-changed" : ""}${isPriceSetting && !readOnly ? " warehouse-document-editor__line--context-menu" : ""}${draggedLineId === line.localId ? " warehouse-document-editor__line--dragging" : ""}${dragOverLineId === line.localId ? " warehouse-document-editor__line--drop-target" : ""}`}
                            key={line.localId}
                            onDragOver={(event) => {
                              if (!canDropLine(line)) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              setDragOverLineId(line.localId);
                            }}
                            onDragLeave={(event) => {
                              if (
                                !event.currentTarget.contains(event.relatedTarget as Node | null)
                              ) {
                                setDragOverLineId((current) =>
                                  current === line.localId ? null : current,
                                );
                              }
                            }}
                            onDrop={(event) => {
                              if (!canDropLine(line) || !draggedLineId) return;
                              event.preventDefault();
                              moveLine(draggedLineId, line.localId, "before");
                              resetLineDrag();
                            }}
                            onContextMenu={(event) => {
                              if (!isPriceSetting || readOnly) return;
                              event.preventDefault();
                              setPriceLineContextMenu({
                                line,
                                x: event.clientX,
                                y: event.clientY,
                              });
                            }}
                          >
                            {isPriceSetting && priceLineSelectionEnabled && (
                              <Checkbox
                                aria-label={`Выбрать «${line.productName}» для правила цены`}
                                checked={selectedPriceLineIdSet.has(line.localId)}
                                disabled={readOnly}
                                onCheckedChange={(selected) =>
                                  setPriceLineSelected(line.localId, selected === true)
                                }
                              />
                            )}
                            <div className="warehouse-document-editor__line-title">
                              <b>{line.productName}</b>
                              <span>Артикул: {line.sku}</span>
                              {isPriceSetting && line.sourceDescription && (
                                <span>{line.sourceDescription}</span>
                              )}
                              {isPriceSetting &&
                                !line.sourceDescription &&
                                line.sourceDocumentId && <span>Источник: приход</span>}
                              {!readOnly && !isCustomerReturn && lines.length > 1 && (
                                <div
                                  className="warehouse-document-editor__reorder-controls"
                                  role="group"
                                  aria-label={`Порядок позиции «${line.productName}»`}
                                >
                                  <span
                                    className="warehouse-document-editor__drag-handle"
                                    draggable={canReorderLines && group.lines.length > 1}
                                    role="img"
                                    aria-label={`Перетащить «${line.productName}»`}
                                    title="Перетащите перед другой позицией"
                                    onDragStart={(event) => {
                                      if (!canReorderLines) {
                                        event.preventDefault();
                                        return;
                                      }
                                      event.dataTransfer.effectAllowed = "move";
                                      event.dataTransfer.setData("text/plain", line.localId);
                                      setDraggedLineId(line.localId);
                                    }}
                                    onDragEnd={resetLineDrag}
                                  >
                                    <GripVertical size={17} />
                                  </span>
                                  <AppButton
                                    type="button"
                                    variant="ghost"
                                    className="warehouse-document-editor__reorder-button"
                                    aria-label={`Переместить «${line.productName}» выше`}
                                    title="Переместить выше"
                                    disabled={!canReorderLines || lineIndex === 0}
                                    onClick={() =>
                                      moveLine(
                                        line.localId,
                                        group.lines[lineIndex - 1].localId,
                                        "before",
                                      )
                                    }
                                  >
                                    <ArrowUp size={16} />
                                  </AppButton>
                                  <AppButton
                                    type="button"
                                    variant="ghost"
                                    className="warehouse-document-editor__reorder-button"
                                    aria-label={`Переместить «${line.productName}» ниже`}
                                    title="Переместить ниже"
                                    disabled={
                                      !canReorderLines || lineIndex === group.lines.length - 1
                                    }
                                    onClick={() =>
                                      moveLine(
                                        line.localId,
                                        group.lines[lineIndex + 1].localId,
                                        "after",
                                      )
                                    }
                                  >
                                    <ArrowDown size={16} />
                                  </AppButton>
                                </div>
                              )}
                            </div>
                            {!isPriceSetting && type === "INVENTORY" && (
                              <InventoryQuantityInput
                                value={line.quantity}
                                productName={line.productName}
                                disabled={readOnly}
                                onValueChange={(quantity) => updateLine(line.localId, { quantity })}
                              />
                            )}
                            {!isPriceSetting && type !== "INVENTORY" && (
                              <AppNumberInput
                                onFocus={selectNumericInputOnFocus}
                                label={quantityLabel}
                                aria-label={`${quantityLabel}: ${line.productName}`}
                                min={
                                  isOpeningBalance ||
                                  type === "PURCHASE_ORDER" ||
                                  type === "RECEIPT"
                                    ? 0
                                    : 0.001
                                }
                                step="any"
                                value={line.quantity}
                                disabled={readOnly}
                                onChange={(event) => {
                                  const quantity = Number(event.target.value) || 0;
                                  if (type === "RECEIPT") updateReceiptQuantity(line, quantity);
                                  else updateLine(line.localId, { quantity });
                                }}
                              />
                            )}
                            {!isOpeningBalance && (
                              <>
                                {isCustomerReturn ? (
                                  <b className="warehouse-document-editor__line-total">
                                    {new Intl.NumberFormat("ru-KZ", {
                                      maximumFractionDigits: 2,
                                    }).format(line.unitPrice ?? 0)}{" "}
                                    ₸
                                  </b>
                                ) : isPriceSetting ? (
                                  <div className="warehouse-document-editor__price-review">
                                    <AppNumberInput
                                      label="Цена"
                                      aria-label={`Цена: ${line.productName}`}
                                      min={1}
                                      step={1}
                                      value={priceInputValue(line)}
                                      disabled={readOnly}
                                      onFocus={(event) => {
                                        beginPriceEditing(line);
                                        selectNumericInputOnFocus(event);
                                      }}
                                      onChange={(event) =>
                                        updatePriceInput(line, event.target.value)
                                      }
                                      onBlur={() => finishPriceEditing(line)}
                                    />
                                    {priceChanged ? (
                                      <div
                                        className={`warehouse-document-editor__price-change${priceDelta < 0 ? " is-decrease" : ""}`}
                                      >
                                        <div className="warehouse-document-editor__price-change-summary">
                                          <span>Было: {formatPrice(baselinePrice)}</span>
                                          <strong>
                                            {priceDelta >= 0 ? "+" : "−"}
                                            {formatPrice(Math.abs(priceDelta))}
                                          </strong>
                                          {priceChangePercent !== null && (
                                            <span className="warehouse-document-editor__price-change-percent">
                                              {priceChangePercent >= 0 ? "+" : "−"}
                                              {Math.abs(priceChangePercent)
                                                .toFixed(1)
                                                .replace(".", ",")}
                                              %
                                            </span>
                                          )}
                                        </div>
                                        {priceAdjustmentSteps.length > 0 && (
                                          <div className="warehouse-document-editor__price-change-steps">
                                            <span>Действия:</span>
                                            {priceAdjustmentSteps.map((step, index) => (
                                              <b key={`${step.operation}-${step.value}-${index}`}>
                                                {formatPriceAdjustmentStep(step)}
                                              </b>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                ) : type === "INVENTORY" ? (
                                  <details className="warehouse-document-editor__inventory-cost">
                                    <summary>
                                      Приходная цена · необязательно
                                      {line.unitCost != null
                                        ? ` · ${formatPrice(line.unitCost)}`
                                        : ""}
                                    </summary>
                                    <AppMoneyInput
                                      onFocus={selectNumericInputOnFocus}
                                      label="Приходная цена"
                                      aria-label={`Приходная цена: ${line.productName}`}
                                      value={line.unitCost ?? null}
                                      maximumFractionDigits={2}
                                      disabled={readOnly}
                                      onValueChange={(unitCost) =>
                                        updateLine(line.localId, { unitCost })
                                      }
                                    />
                                  </details>
                                ) : (
                                  <div className="warehouse-document-editor__price-review">
                                    <AppMoneyInput
                                      onFocus={selectNumericInputOnFocus}
                                      label="Приходная цена"
                                      aria-label={`Приходная цена: ${line.productName}`}
                                      value={line.unitCost ?? null}
                                      maximumFractionDigits={type === "RECEIPT" ? 6 : 2}
                                      disabled={readOnly}
                                      onValueChange={(unitCost) =>
                                        updateLine(line.localId, {
                                          unitCost:
                                            type === "RECEIPT" && unitCost != null
                                              ? roundReceiptUnitCost(unitCost)
                                              : isReceipt
                                                ? roundPrice(unitCost)
                                                : unitCost,
                                          receiptAmountDriven: false,
                                          receiptAmount: undefined,
                                        })
                                      }
                                    />
                                    {incomingCostChanged && (
                                      <div
                                        className={`warehouse-document-editor__price-change is-incoming-cost ${incomingCostDelta > 0 ? "is-increase" : "is-decrease"} is-${incomingCostChangeLevel}`}
                                      >
                                        <div className="warehouse-document-editor__price-change-summary">
                                          <span className="warehouse-document-editor__price-change-source">
                                            {latestIncomingPrice
                                              ? `Последняя приходная: ${formatPrice(incomingCostBaseline ?? 0)} · ${incomingHistoryDateFormatter.format(new Date(latestIncomingPrice.occurredAt))}`
                                              : `Подставлено системой: ${formatPrice(incomingCostBaseline ?? 0)}`}
                                          </span>
                                          <strong className="warehouse-document-editor__price-change-trend">
                                            {incomingCostDelta > 0
                                              ? "Подорожало на "
                                              : "Подешевело на "}
                                            {formatPrice(Math.abs(incomingCostDelta))}
                                          </strong>
                                          {incomingCostChangePercent !== null && (
                                            <span className="warehouse-document-editor__price-change-percent">
                                              {incomingCostChangePercent >= 0 ? "+" : "−"}
                                              {Math.abs(incomingCostChangePercent)
                                                .toFixed(1)
                                                .replace(".", ",")}
                                              %
                                            </span>
                                          )}
                                        </div>
                                        <CleanIncomingPriceHistoryToggle
                                          productId={line.productId}
                                          expanded={incomingCostHistoryExpanded}
                                          onToggle={() =>
                                            setExpandedIncomingCostLineIds((current) =>
                                              current.includes(line.localId)
                                                ? current.filter(
                                                    (lineId) => lineId !== line.localId,
                                                  )
                                                : [...current, line.localId],
                                            )
                                          }
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                                {type === "RECEIPT" && (
                                  <AppMoneyInput
                                    onFocus={selectNumericInputOnFocus}
                                    label="Сумма"
                                    aria-label={`Сумма: ${line.productName}`}
                                    value={receiptAmount(line)}
                                    disabled={readOnly}
                                    onValueChange={(amount) => updateReceiptAmount(line, amount)}
                                  />
                                )}
                                {type !== "RECEIPT" && type !== "INVENTORY" && !isPriceSetting && (
                                  <b className="warehouse-document-editor__line-total">
                                    {new Intl.NumberFormat("ru-KZ", {
                                      maximumFractionDigits: 2,
                                    }).format(
                                      line.quantity *
                                        (isCustomerReturn
                                          ? (line.unitPrice ?? 0)
                                          : (line.unitCost ?? 0)),
                                    )}{" "}
                                    ₸
                                  </b>
                                )}
                              </>
                            )}
                            <div className="warehouse-document-editor__line-actions">
                              {isPriceSetting &&
                                line.originalUnitPrice !== null &&
                                line.originalUnitPrice !== undefined &&
                                line.unitPrice !== line.originalUnitPrice && (
                                  <AppButton
                                    type="button"
                                    variant="ghost"
                                    className="warehouse-document-editor__line-reset"
                                    aria-label={`Вернуть цену «${line.productName}» к ${line.originalUnitPrice}`}
                                    title={`Вернуть исходную цену: ${line.originalUnitPrice} ₸`}
                                    onClick={() => resetPrice(line)}
                                    disabled={readOnly}
                                  >
                                    <RotateCcw size={16} />
                                  </AppButton>
                                )}
                              <AppButton
                                type="button"
                                variant="ghost"
                                className="warehouse-document-editor__line-remove"
                                aria-label={`Убрать ${line.productName}`}
                                onClick={() =>
                                  setLines((current) =>
                                    current.filter((item) => item.localId !== line.localId),
                                  )
                                }
                                disabled={readOnly}
                              >
                                <Trash2 size={17} />
                              </AppButton>
                            </div>
                            {incomingCostChanged && incomingCostHistoryExpanded && (
                              <div className="warehouse-document-editor__incoming-cost-history">
                                <CleanIncomingPriceHistory productId={line.productId} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="warehouse-document-editor__empty">
              <Search size={20} />
              {isCustomerReturn
                ? "В исходном заказе нет товарных позиций для возврата."
                : type === "INVENTORY"
                  ? "Нажмите «Добавить товар», чтобы начать пересчёт."
                  : "Нажмите «Подобрать товар», чтобы добавить позиции."}
            </div>
          )}
        </section>

        <aside className="warehouse-document-editor__totals" aria-label="Итоги документа">
          <span className="warehouse-document-editor__totals-caption">Итоги документа</span>
          <div>
            <span>Позиций</span>
            <b>{lines.length}</b>
          </div>
          <div>
            <span>Единиц</span>
            <b>{formattedQuantity}</b>
          </div>
          {!isOpeningBalance && type !== "INVENTORY" && (
            <div className="warehouse-document-editor__total-value">
              <span>Сумма</span>
              <b>{formattedTotal} ₸</b>
            </div>
          )}
          {type === "INVENTORY" && !readOnly && (
            <div
              className="warehouse-document-editor__inventory-check"
              aria-label="Проверка перед сохранением"
            >
              <strong>Перед сохранением</strong>
              <span>
                Позиций: {lines.length} · с нулевым остатком: {inventoryZeroCount}
              </span>
              <span>
                Обязательные данные:{" "}
                {inventoryMissingFields.length > 0
                  ? `проверьте ${inventoryMissingFields.join(", ")}`
                  : "заполнены"}
              </span>
            </div>
          )}
          {document?.id && (type === "PURCHASE_ORDER" || type === "RECEIPT") && (
            <AppButton
              type="button"
              variant="secondary"
              loading={exportingPdf}
              loadingText="Выгружаем PDF"
              onClick={downloadPdf}
              title="Скачать сохранённую версию документа"
            >
              <FileDown size={17} />
              Скачать PDF
            </AppButton>
          )}
          {!readOnly && (
            <>
              <AppButton
                type="submit"
                className="warehouse-document-editor__save"
                disabled={
                  saving ||
                  lines.length === 0 ||
                  (requiresCounterparty && !counterpartyId) ||
                  (requiresReceiptPurchaseOrder && !receiptPurchaseOrderId)
                }
                title={
                  requiresCounterparty && !counterpartyId
                    ? "Выберите контрагента для заказа поставщику"
                    : requiresReceiptPurchaseOrder && !receiptPurchaseOrderId
                      ? "Выберите заказ поставщику или укажите другое основание"
                      : undefined
                }
                loading={saving}
                loadingText="Сохраняем"
              >
                <Save size={17} />
                Сохранить черновик
              </AppButton>
              {onDelete && (
                <AppButton
                  type="button"
                  variant="danger"
                  className="warehouse-document-editor__delete"
                  loading={deleting}
                  loadingText="Удаляем"
                  onClick={onDelete}
                >
                  <Trash2 size={17} />
                  Удалить документ
                </AppButton>
              )}
            </>
          )}
        </aside>

        <details
          className="warehouse-document-editor__comment"
          open={commentOpen}
          onToggle={(event) => setCommentOpen(event.currentTarget.open)}
        >
          <summary>Комментарий к документу</summary>
          <AppTextarea
            label="Комментарий"
            placeholder="Номер накладной, причина корректировки или другая служебная информация"
            rows={3}
            value={comment}
            disabled={readOnly}
            onChange={(event) => setComment(event.target.value)}
          />
        </details>
        {type === "INVENTORY" && !readOnly && (
          <div className="warehouse-document-editor__mobile-save">
            <span>Позиций: {lines.length}</span>
            <AppButton
              type="submit"
              disabled={saving || lines.length === 0}
              loading={saving}
              loadingText="Сохраняем"
            >
              <Save size={17} />
              Сохранить черновик
            </AppButton>
          </div>
        )}
      </form>
      <AppModal
        open={inventorySaveReviewOpen}
        onOpenChange={(open) => {
          setInventorySaveReviewOpen(open);
          if (!open) setPendingInventoryInput(null);
        }}
        title="Проверка инвентаризации"
        description="Проверьте подсчёт перед сохранением черновика."
        contentClassName="warehouse-confirm-modal"
      >
        <div className="warehouse-document-editor__inventory-confirm">
          <p>
            Позиций: <b>{lines.length}</b>
          </p>
          <p>
            С нулевым остатком: <b>{inventoryZeroCount}</b>
          </p>
          <p>
            Обязательные данные: <b>заполнены</b>
          </p>
          <div>
            <AppButton
              type="button"
              variant="ghost"
              onClick={() => setInventorySaveReviewOpen(false)}
            >
              Вернуться к подсчёту
            </AppButton>
            <AppButton
              type="button"
              loading={saving}
              loadingText="Сохраняем"
              onClick={() => {
                if (!pendingInventoryInput) return;
                setInventorySaveReviewOpen(false);
                onSave(pendingInventoryInput);
                setPendingInventoryInput(null);
              }}
            >
              Сохранить черновик
            </AppButton>
          </div>
        </div>
      </AppModal>
      <AppModal
        open={clearLinesOpen}
        onOpenChange={setClearLinesOpen}
        title="Очистить все позиции?"
        description={`Из таблицы будут убраны все позиции: ${lines.length}.`}
        contentClassName="warehouse-confirm-modal"
      >
        <div className="warehouse-document-page__actions">
          <AppButton type="button" variant="ghost" onClick={() => setClearLinesOpen(false)}>
            Отмена
          </AppButton>
          <AppButton type="button" variant="danger" onClick={clearAllLines}>
            Очистить
          </AppButton>
        </div>
      </AppModal>
      {type === "INVENTORY" && !readOnly && (
        <WarehouseInventoryAiAssistant
          open={inventoryAiOpen}
          onClose={() => setInventoryAiOpen(false)}
          onApply={applyInventoryAiRows}
        />
      )}
      <AppModal
        open={counterpartyCreateOpen}
        onOpenChange={(open) => {
          setCounterpartyCreateOpen(open);
          if (!open) setNewCounterpartyInput(emptyWarehouseCounterpartyInput());
        }}
        title="Новый контрагент"
        description="После сохранения контрагент будет сразу прикреплён к этому документу."
        contentClassName="warehouse-counterparty-modal"
      >
        <form
          className="warehouse-counterparty-modal__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (newCounterpartyInput.name.trim()) createCounterparty.mutate();
          }}
        >
          <WarehouseCounterpartyFields
            value={newCounterpartyInput}
            onChange={setNewCounterpartyInput}
          />
          <div className="warehouse-counterparty-modal__actions">
            <AppButton
              type="button"
              variant="ghost"
              onClick={() => setCounterpartyCreateOpen(false)}
            >
              Отмена
            </AppButton>
            <AppButton
              type="submit"
              loading={createCounterparty.isPending}
              loadingText="Создаём"
              disabled={!newCounterpartyInput.name.trim()}
            >
              Создать и выбрать
            </AppButton>
          </div>
        </form>
      </AppModal>
      <WarehousePriceGroupCreateModal
        open={priceGroupCreateOpen}
        onOpenChange={setPriceGroupCreateOpen}
        onCreated={(group) => {
          setPriceSettingGroupId(group.id);
          setPriceGroupRulesInput(priceGroupInput(group));
        }}
      />
      <AppModal
        open={priceGroupRulesEditOpen}
        onOpenChange={setPriceGroupRulesEditOpen}
        title="Изменить правила группы"
        description="Правила и комментарий будут видны во всех документах этой группы."
        contentClassName="warehouse-price-group-modal"
      >
        <form className="warehouse-price-group-modal__form" onSubmit={savePriceGroupRules}>
          <AppInput
            label="Название группы"
            required
            value={priceGroupRulesInput.name}
            placeholder="Сентябрь — цены от приходной"
            onChange={(event) =>
              setPriceGroupRulesInput((current) => ({ ...current, name: event.target.value }))
            }
          />
          <AppRichTextEditor
            label="Общие правила"
            value={priceGroupRulesInput.commonRules ?? ""}
            placeholder="Опишите правила, исключения и формулы для всех типов цен этой группы."
            onValueChange={(commonRules) =>
              setPriceGroupRulesInput((current) => ({ ...current, commonRules }))
            }
          />
          <AppTextarea
            label="Комментарий"
            rows={2}
            value={priceGroupRulesInput.comment ?? ""}
            placeholder="Служебная заметка для команды"
            onChange={(event) =>
              setPriceGroupRulesInput((current) => ({ ...current, comment: event.target.value }))
            }
          />
          <div className="warehouse-price-group-modal__actions">
            <AppButton
              type="button"
              variant="ghost"
              onClick={() => setPriceGroupRulesEditOpen(false)}
            >
              Отмена
            </AppButton>
            <AppButton
              type="submit"
              loading={updatePriceGroupRules.isPending}
              loadingText="Сохраняем"
            >
              Сохранить
            </AppButton>
          </div>
        </form>
      </AppModal>
      <AppModal
        open={documentPriceRuleEditOpen}
        onOpenChange={(open) => {
          if (!open) cancelDocumentPriceRuleEditor();
          else setDocumentPriceRuleEditOpen(true);
        }}
        title="Правила и комментарии документа"
        description="Правила относятся только к этому документу. После сохранения сохраните черновик, чтобы записать их в базу."
        contentClassName="warehouse-document-rule-modal"
      >
        <div className="warehouse-document-rule-modal__form">
          <AppRichTextEditor
            label="Правила и комментарии"
            value={priceRuleCommentDraft}
            placeholder="Опишите правило, исключения и комментарии для этого документа."
            onValueChange={setPriceRuleCommentDraft}
          />
          <div className="warehouse-document-rule-modal__actions">
            <AppButton type="button" variant="ghost" onClick={cancelDocumentPriceRuleEditor}>
              Отмена
            </AppButton>
            <AppButton type="button" onClick={saveDocumentPriceRule}>
              Сохранить
            </AppButton>
          </div>
        </div>
      </AppModal>
      <AppFloatingWindow
        open={priceGroupRulesPreviewOpen && selectedPriceGroup !== undefined}
        title={`Правила группы: ${selectedPriceGroup?.name ?? ""}`}
        onOpenChange={setPriceGroupRulesPreviewOpen}
      >
        <div className="warehouse-price-group-preview-window">
          {selectedPriceGroup?.commonRules ? (
            <RichTextPreview value={selectedPriceGroup.commonRules} />
          ) : (
            <p>Общие правила для этой группы пока не указаны.</p>
          )}
          {selectedPriceGroup?.comment && (
            <div>
              <b>Комментарий</b>
              <p>{selectedPriceGroup.comment}</p>
            </div>
          )}
        </div>
      </AppFloatingWindow>
      <AppFloatingWindow
        open={documentPriceRulePreviewOpen}
        title="Правила документа"
        onOpenChange={setDocumentPriceRulePreviewOpen}
      >
        <div className="warehouse-price-group-preview-window">
          {priceRuleComment ? (
            <RichTextPreview value={priceRuleComment} />
          ) : (
            <p>Правила и комментарии для этого документа пока не указаны.</p>
          )}
        </div>
      </AppFloatingWindow>
      <AppModal
        open={productGroupModalOpen}
        onOpenChange={(open) => {
          setProductGroupModalOpen(open);
          if (!open) setProductGroupName("");
        }}
        title="Создать группу товаров"
        description={`В группу попадёт позиций: ${selectedPriceLineCount}. Название можно не указывать.`}
        contentClassName="warehouse-product-group-modal"
      >
        <div className="warehouse-product-group-modal__form">
          <AppInput
            label="Название группы"
            autoFocus
            value={productGroupName}
            placeholder={defaultProductGroupName()}
            onChange={(event) => setProductGroupName(event.target.value)}
          />
          <small>Если оставить поле пустым, будет создана «{defaultProductGroupName()}».</small>
          <div className="warehouse-product-group-modal__actions">
            <AppButton
              type="button"
              variant="ghost"
              onClick={() => setProductGroupModalOpen(false)}
            >
              Отмена
            </AppButton>
            <AppButton type="button" onClick={createProductGroup}>
              <FolderPlus size={17} />
              Создать группу
            </AppButton>
          </div>
        </div>
      </AppModal>
      <AppContextMenu
        open={Boolean(priceLineContextMenu)}
        x={priceLineContextMenu?.x ?? 0}
        y={priceLineContextMenu?.y ?? 0}
        label={
          priceLineContextMenu
            ? `Установка цены: ${priceLineContextMenu.line.productName}`
            : "Установка цены"
        }
        actions={priceLineContextMenu ? priceLineContextActions(priceLineContextMenu.line) : []}
        onOpenChange={(open) => {
          if (!open) setPriceLineContextMenu(null);
        }}
      />
      {!isCustomerReturn && (
        <OrderProductPickerModal
          open={productPickerOpen}
          onOpenChange={setProductPickerOpen}
          priceTier={isPriceSetting ? priceType : "RETAIL"}
          allowMissingPrice
          onAdd={isPriceSetting ? addPriceSettingProduct : addProduct}
          showQuantityPicker={
            type === "PURCHASE_ORDER" || type === "RECEIPT" || type === "INVENTORY"
          }
          quantityInOrderLabel="В документе"
          destinationName="документ"
          minQuantity={0}
          maxQuantity={99_999_999_999.999}
          quantityInOrder={(product) =>
            lines.find((line) => line.productId === product.id)?.quantity ?? 0
          }
          inventoryMode={type === "INVENTORY"}
          inventoryCount={type === "INVENTORY" ? lines.length : undefined}
          isProductInDocument={(product) => lines.some((line) => line.productId === product.id)}
        />
      )}
      {type === "PURCHASE_ORDER" && (
        <PurchaseOrderRemainderPickerModal
          open={remainderPickerOpen}
          onOpenChange={setRemainderPickerOpen}
          documentId={document?.id}
          initialCounterpartyId={counterpartyId || null}
          allocations={normalizedPurchaseAllocations}
          onAdd={addOrderRemainders}
        />
      )}
      {(type === "PURCHASE_ORDER" || type === "INVENTORY" || isPriceSetting) &&
        sourceDocumentPickerType && (
          <WarehouseSourceDocumentPickerModal
            open
            onOpenChange={(open) => {
              if (!open) setSourceDocumentPickerType(null);
            }}
            documentType={sourceDocumentPickerType}
            excludedDocumentIds={
              new Set([
                ...(document?.id ? [document.id] : []),
                ...(isPriceSetting && sourceDocumentPickerType === "RECEIPT"
                  ? lines
                      .map((line) => line.sourceDocumentId)
                      .filter((documentId): documentId is string => Boolean(documentId))
                  : []),
              ])
            }
            onAdd={
              isPriceSetting
                ? addPriceSettingSourceDocuments
                : type === "INVENTORY"
                  ? addInventorySourceDocuments
                  : addPurchaseOrderSourceDocuments
            }
            afterImportHint={
              type === "INVENTORY"
                ? "После переноса проверьте фактическое количество перед проведением."
                : undefined
            }
          />
        )}
      {(type === "PURCHASE_ORDER" || type === "INVENTORY" || isPriceSetting) && (
        <WarehouseSupplierProductsPickerModal
          open={supplierProductsPickerOpen}
          onOpenChange={setSupplierProductsPickerOpen}
          initialCounterpartyId={type === "PURCHASE_ORDER" ? counterpartyId : null}
          onAdd={
            isPriceSetting
              ? addPriceSettingSourceDocuments
              : type === "INVENTORY"
                ? addInventorySourceDocuments
                : addPurchaseOrderSourceDocuments
          }
        />
      )}
      <AppModal
        open={groupDocumentFillOpen}
        onOpenChange={(open) => {
          setGroupDocumentFillOpen(open);
          if (!open) setGroupDocumentFillId("");
        }}
        title="Заполнить из документа группы"
        description="Выберите документ, затем укажите, что перенести в текущую установку цен."
        contentClassName="warehouse-group-document-fill-modal"
      >
        <div className="warehouse-group-document-fill-modal__form">
          <AppSelect
            label="Документ группы"
            options={[
              { value: "", label: "Выберите проведённый документ" },
              ...groupSourceDocuments.map((item) => ({
                value: item.id,
                label: `${PRICE_TYPE_OPTIONS.find((option) => option.value === item.priceType)?.label ?? item.priceType ?? "Цена"} · ${item.documentNumber ?? "документ"}`,
              })),
            ]}
            value={groupDocumentFillId}
            disabled={importingSourceDocument}
            clearable={false}
            onValueChange={(value) => setGroupDocumentFillId(String(value))}
          />
          {groupDocumentFillId && (
            <div className="warehouse-group-document-fill-modal__mode">
              <span>Что импортировать</span>
              <SegmentedControl
                ariaLabel="Состав импорта из документа группы"
                items={[
                  { value: "PRICES_ONLY", label: "Только цены" },
                  {
                    value: "PRODUCTS_AND_PRICES",
                    label: "Товары и цены",
                  },
                ]}
                value={groupDocumentImportMode}
                onValueChange={(value) =>
                  setGroupDocumentImportMode(value as GroupDocumentImportMode)
                }
              />
            </div>
          )}
          <div className="warehouse-group-document-fill-modal__actions">
            <AppButton
              type="button"
              variant="ghost"
              disabled={importingSourceDocument}
              onClick={() => setGroupDocumentFillOpen(false)}
            >
              Отмена
            </AppButton>
            <AppButton
              type="button"
              loading={importingSourceDocument}
              loadingText="Заполняем"
              disabled={!groupDocumentFillId || importingSourceDocument}
              onClick={() => importFromGroupDocument(groupDocumentFillId, groupDocumentImportMode)}
            >
              {groupDocumentImportMode === "PRICES_ONLY"
                ? "Импортировать цены"
                : "Заполнить таблицу"}
            </AppButton>
          </div>
        </div>
      </AppModal>
    </>
  );
}

export { DOCUMENT_TYPE_LABELS };
