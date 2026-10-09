import {
  type CSSProperties,
  FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  CheckCheck,
  CheckCircle2,
  Calculator,
  ClipboardCheck,
  CopyPlus,
  FileDown,
  GripVertical,
  History,
  Minus,
  ListX,
  PackageCheck,
  PackagePlus,
  Pencil,
  Plus,
  Play,
  Printer,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { RegularBuyerSelect } from "@/features/orders/RegularBuyerSelect";
import { OrderCompletionFlow } from "@/features/orders/OrderCompletionFlow";
import { getOrderBuyerName } from "@/features/orders/orderBuyer";
import { openPaymentInvoicePdf } from "@/features/orders/openPaymentInvoicePdf";
import {
  OrderItemUnitFields,
  orderItemUnitsPayload,
  type OrderItemUnits,
} from "@/features/orders/OrderItemUnitFields";
import { measurementUnitLabel, measurementUnitOptions } from "@/shared/lib/measurementUnit";
import { OrderProductPickerModal } from "@/features/orders/OrderProductPickerModal";
import {
  clearOrderPriceReviewDraft,
  orderPriceReviewSignature,
  readOrderPriceReviewDraft,
  writeOrderPriceReviewDraft,
  type OrderPriceReviewDraft,
  type OrderPriceTier,
  type PriceAdjustmentOperation,
  type PriceChangeSource,
} from "@/features/orders/orderPriceReviewDraft";
import {
  MAX_ORDER_QUANTITY,
  MIN_ORDER_QUANTITY,
  normalizeOrderQuantity,
} from "@/features/orders/OrderQuantityInput";
import { PRICE_TIER_LABELS, priceTierTone } from "@/features/orders/price-tier";
import { AdminPage } from "@/layouts/AdminPage";
import { API_URL, api } from "@/shared/api/http";
import {
  fetchWarehouseBalances,
  type WarehouseBalance,
  type WarehouseDocumentSummary,
} from "@/shared/api/warehouse";
import { formatDateTime } from "@/shared/lib/dateTime";
import { productMatchesSearch } from "@/shared/lib/productSearch";
import { MeasurementUnit, Order, OrderReturnSummary, Product } from "@/shared/types/models";
import { formatMoney } from "@/pages/public/store-utils";
import {
  orderStatusLabel,
  orderStatusTone,
  paymentMethodLabel,
  cashlessPaymentTypeLabel,
  paymentStatusLabel,
} from "@/pages/customer/OrdersPage";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton, AppSplitButton } from "@/shared/ui/AppButton";
import { AppDateTimePicker } from "@/shared/ui/AppDatePicker";
import { AppCard } from "@/shared/ui/AppCard";
import {
  AppInput,
  AppMoneyInput,
  AppSearchInput,
  AppSelect,
  AppTextarea,
} from "@/shared/ui/AppField";
import { AppCheckbox, AppRadioGroup, AppTabs } from "@/shared/ui/AppControls";
import { AppContextMenu } from "@/shared/ui/AppContextMenu";
import { AppAlert, AppModal, AppSkeleton, AppTooltip } from "@/shared/ui/AppFeedback";
import { AppTable } from "@/shared/ui/AppTable";
import { appToast } from "@/shared/ui/AppToast";
import { notificationsQueryKey } from "@/features/notifications/NotificationCenter";
import { DataPanel } from "@/shared/ui/DataPanel";
import { OrderActivityHistory } from "./OrderActivityHistory";
import "./OrderDetailPage.css";
import "./OrderWorkspace.css";

type AdminPaymentMethod = "CASH" | "CASHLESS" | "KASPI_STORE" | "MIXED";
type OrderPriceTierItem = { orderItemId: number; unitPrice: number };
type PriceReviewRequestContext = {
  orderId: string;
  userId: number;
  draftSavedAt: string | null;
};
type PriceReviewSubmission = PriceReviewRequestContext & {
  priceTier: OrderPriceTier | null;
  items: OrderPriceTierItem[];
};
type PriceTierPreviewRequest = {
  orderId: string;
  userId: number;
  reviewSession: number;
  priceTier: OrderPriceTier;
  selectedItemIds: number[];
};
type OrderIncomingPriceCheck = {
  applicable: boolean;
  problems: { orderItemId: number; incomingPrice: number }[];
};

type OrderDetailLocationState = {
  returnTo?: string;
  returnState?: unknown;
};

function getOrderReturnPath(state: unknown, currentPath: string) {
  const returnTo = (state as OrderDetailLocationState | null)?.returnTo;
  if (
    typeof returnTo !== "string" ||
    !returnTo.startsWith("/admin/") ||
    /[\\\u0000-\u001f]|%2f|%5c/i.test(returnTo)
  ) {
    return "/admin/orders";
  }
  try {
    const destination = new URL(returnTo, window.location.origin);
    return destination.origin === window.location.origin &&
      destination.pathname.startsWith("/admin/") &&
      destination.pathname !== currentPath
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : "/admin/orders";
  } catch {
    return "/admin/orders";
  }
}

const PRICE_TIER_ITEMS = [
  { value: "RETAIL", label: "Розничная" },
  { value: "WHOLESALE", label: "Оптовая" },
  { value: "BULK_WHOLESALE", label: "Крупно-оптовая" },
  { value: "SKO", label: "СКО" },
];
const PRICE_DOCUMENT_TYPE_LABELS: Record<string, string> = {
  RETAIL: "Розничная",
  WHOLESALE: "Оптовая",
  BULK_WHOLESALE: "Крупно-оптовая",
  SKO: "СКО",
  GSKO: "ГСКО",
  INCOMING: "Приходная",
};
function priceChangeSourceLabel(source: PriceChangeSource | undefined) {
  if (!source) return "Изменена цена";
  if (source.type === "MANUAL") return "Вручную";
  if (source.type === "TIER") return `Тип цены: ${PRICE_TIER_LABELS[source.tier]}`;
  if (source.type === "PERCENT") {
    return `${source.value >= 0 ? "+" : "−"}${Math.abs(source.value).toLocaleString("ru-RU")}%`;
  }
  return `${source.value >= 0 ? "+" : "−"}${formatMoney(Math.abs(source.value))}`;
}

function normalizedQuantity(value: string | number, fallback: number) {
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < MIN_ORDER_QUANTITY || parsed > MAX_ORDER_QUANTITY) {
    return fallback;
  }
  return normalizeOrderQuantity(parsed);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function formatPriceInput(value: number) {
  return new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value);
}

function parsePriceInput(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!normalized || normalized === ".") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function PriceReviewMoneyInput({
  value,
  ariaLabel,
  disabled,
  onValueChange,
}: {
  value: number;
  ariaLabel: string;
  disabled?: boolean;
  onValueChange: (value: number) => void;
}) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [valueBeforeEditing, setValueBeforeEditing] = useState<number | null>(null);
  const displayValue = draftValue ?? formatPriceInput(value);

  return (
    <AppInput
      value={displayValue}
      inputMode="decimal"
      suffix="₸"
      aria-label={ariaLabel}
      disabled={disabled}
      onFocus={(event) => {
        const input = event.currentTarget;
        setValueBeforeEditing(value);
        setDraftValue(String(value));
        window.requestAnimationFrame(() => input.select());
      }}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);
        const parsed = parsePriceInput(nextValue);
        if (parsed !== null) onValueChange(parsed);
      }}
      onBlur={() => {
        if (parsePriceInput(draftValue ?? "") === null && valueBeforeEditing !== null) {
          onValueChange(valueBeforeEditing);
        }
        setDraftValue(null);
        setValueBeforeEditing(null);
      }}
    />
  );
}

function getOrderPriceValues(order: Order) {
  return Object.fromEntries(order.items.map((item) => [item.id, item.unitPrice])) as Record<
    number,
    number
  >;
}

function paymentCommentDescription(
  paymentMethod: AdminPaymentMethod,
  cashlessPaymentType: "TRANSFER" | "CARD" | "QR",
  cashAmount: number | null,
  transferAmount: number | null,
  cardAmount: number | null,
  qrAmount: number | null,
) {
  if (paymentMethod === "CASH") return "наличный расчёт";
  if (paymentMethod === "KASPI_STORE") return "Kaspi Магазин";
  if (paymentMethod === "CASHLESS") {
    return { TRANSFER: "перевод", CARD: "картой", QR: "QR" }[cashlessPaymentType];
  }
  const parts = [`комбинированный расчёт: наличными ${cashAmount ?? 0}`];
  if ((transferAmount ?? 0) > 0) parts.push(`перевод ${transferAmount}`);
  if ((cardAmount ?? 0) > 0) parts.push(`картой ${cardAmount}`);
  if ((qrAmount ?? 0) > 0) parts.push(`QR ${qrAmount}`);
  return parts.join(", ");
}

function generatedPaymentPrintComment(
  invoiceTemplate: string,
  paymentMethod: AdminPaymentMethod,
  cashlessPaymentType: "TRANSFER" | "CARD" | "QR",
  cashAmount: number | null,
  transferAmount: number | null,
  cardAmount: number | null,
  qrAmount: number | null,
) {
  const payment = paymentCommentDescription(
    paymentMethod,
    cashlessPaymentType,
    cashAmount,
    transferAmount,
    cardAmount,
    qrAmount,
  );
  return [invoiceTemplate.trim(), payment].filter(Boolean).join("\n");
}

type InvoicePrintTemplate = "standard" | "z2";

function invoicePdfUrl(order: Order, includePrintComment: boolean, template: InvoicePrintTemplate) {
  const query = includePrintComment ? "" : "?includePrintComment=false";
  const document = template === "z2" ? "invoice-z2.pdf" : "invoice.pdf";
  return `${API_URL}/api/admin/orders/${order.id}/${document}${query}`;
}

function OrderItemQuantityControl({
  itemId,
  quantity,
  disabled,
  onQuantityChange,
}: {
  itemId: number;
  quantity: number;
  disabled: boolean;
  onQuantityChange: (itemId: number, quantity: number) => void;
}) {
  const [value, setValue] = useState(String(quantity));

  useEffect(() => setValue(String(quantity)), [quantity]);

  const commitValue = () => {
    const nextQuantity = normalizedQuantity(value, quantity);
    setValue(String(nextQuantity));
    if (nextQuantity !== quantity) onQuantityChange(itemId, nextQuantity);
  };

  return (
    <div className="order-item-quantity">
      <AppButton
        type="button"
        variant="ghost"
        className="order-item-quantity__button"
        aria-label="Уменьшить количество"
        disabled={disabled || quantity <= MIN_ORDER_QUANTITY}
        onClick={() =>
          onQuantityChange(
            itemId,
            normalizedQuantity(quantity - (quantity <= 1 ? 0.1 : 1), quantity),
          )
        }
      >
        <Minus size={15} />
      </AppButton>
      <input
        className="order-item-quantity__input"
        inputMode="decimal"
        step="0.001"
        min={MIN_ORDER_QUANTITY}
        max={MAX_ORDER_QUANTITY}
        aria-label="Количество"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value.replace(",", ".").replace(/[^0-9.]/g, ""))}
        onBlur={commitValue}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
      <AppButton
        type="button"
        variant="ghost"
        className="order-item-quantity__button"
        aria-label="Увеличить количество"
        disabled={disabled || quantity >= MAX_ORDER_QUANTITY}
        onClick={() =>
          onQuantityChange(
            itemId,
            normalizedQuantity(quantity + (quantity < 1 ? 0.1 : 1), quantity),
          )
        }
      >
        <Plus size={15} />
      </AppButton>
    </div>
  );
}

function PaymentAmountInput({
  label,
  value,
  onValueChange,
  onFillRemainder,
}: {
  label: string;
  value: number | null;
  onValueChange: (value: number | null) => void;
  onFillRemainder: () => void;
}) {
  const tooltip = `Заполнить остаток в поле «${label}»`;

  return (
    <div className="order-payment-confirmation__amount-field">
      <AppMoneyInput label={label} value={value} onValueChange={onValueChange} />
      <AppTooltip content={tooltip}>
        <AppButton
          type="button"
          variant="secondary"
          className="order-payment-confirmation__remainder-button"
          aria-label={tooltip}
          title={tooltip}
          onClick={onFillRemainder}
        >
          <Calculator size={17} />
        </AppButton>
      </AppTooltip>
    </div>
  );
}

async function openInvoicePdf(
  order: Order,
  includePrintComment: boolean,
  template: InvoicePrintTemplate,
) {
  const previewWindow = window.open("about:blank", "_blank");
  if (!previewWindow) {
    appToast.error("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
    return;
  }

  previewWindow.document.title = "Загрузка накладной…";
  previewWindow.document.body.textContent = "Загружаем накладную…";

  try {
    const response = await fetch(invoicePdfUrl(order, includePrintComment, template), {
      credentials: "include",
    });
    if (!response.ok) {
      let message = "Не удалось загрузить накладную";
      try {
        const error = (await response.json()) as { message?: string };
        if (error.message) message = error.message;
      } catch {
        // A proxy can return an HTML error page instead of the API response.
      }
      throw new Error(message);
    }

    const pdfUrl = URL.createObjectURL(await response.blob());
    previewWindow.location.replace(pdfUrl);
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 30 * 60 * 1000);
  } catch (error) {
    previewWindow.close();
    appToast.error(error instanceof Error ? error.message : "Не удалось открыть накладную");
  }
}

async function openComparisonPdf(orderId: string) {
  const previewWindow = window.open("about:blank", "_blank");
  if (!previewWindow) {
    appToast.error("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
    return;
  }

  previewWindow.document.title = "Загрузка сравнительной таблицы…";
  previewWindow.document.body.textContent = "Формируем сравнительную таблицу…";

  try {
    const response = await fetch(`${API_URL}/api/admin/orders/${orderId}/comparison.pdf`, {
      credentials: "include",
    });
    if (!response.ok) {
      let message = "Не удалось сформировать сравнительную таблицу";
      try {
        const error = (await response.json()) as { message?: string };
        if (error.message) message = error.message;
      } catch {
        // A proxy can return an HTML error page instead of the API response.
      }
      throw new Error(message);
    }

    const pdfUrl = URL.createObjectURL(await response.blob());
    previewWindow.location.replace(pdfUrl);
    window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 30 * 60 * 1_000);
  } catch (error) {
    previewWindow.close();
    appToast.error(
      error instanceof Error ? error.message : "Не удалось сформировать сравнительную таблицу",
    );
  }
}

export function AdminOrderDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const returnPath = getOrderReturnPath(location.state, location.pathname);
  const returnState = (location.state as OrderDetailLocationState | null)?.returnState;
  const initialOrderTab =
    new URLSearchParams(location.search).get("tab") === "items" ? "items" : "overview";
  const { user } = useCommerce();
  const priceDraftScope = user?.id && id ? `${user.id}:${id}` : null;
  const queryClient = useQueryClient();
  const invalidateIncomingPriceCheck = () =>
    queryClient.invalidateQueries({ queryKey: ["orders", "admin", id, "incoming-price-check"] });
  const [priceValues, setPriceValues] = useState<Record<number, number | null>>({});
  const [priceBaselineValues, setPriceBaselineValues] = useState<Record<number, number>>({});
  const [selectedPriceTier, setSelectedPriceTier] = useState<OrderPriceTier | null>(null);
  const [priceTierValuesByItemId, setPriceTierValuesByItemId] = useState<Record<number, number>>(
    {},
  );
  const [selectedPriceItemIds, setSelectedPriceItemIds] = useState<number[]>([]);
  const [priceAdjustmentOperation, setPriceAdjustmentOperation] =
    useState<PriceAdjustmentOperation>("PERCENT");
  const [priceAdjustmentValue, setPriceAdjustmentValue] = useState("");
  const [priceChangeSourceByItemId, setPriceChangeSourceByItemId] = useState<
    Record<number, PriceChangeSource>
  >({});
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [activePriceDraftScope, setActivePriceDraftScope] = useState<string | null>(null);
  const [priceReviewSignature, setPriceReviewSignature] = useState("");
  const [availablePriceDraft, setAvailablePriceDraft] = useState<OrderPriceReviewDraft | null>(
    null,
  );
  const [restoredPriceDraft, setRestoredPriceDraft] = useState<{
    savedAt: string;
    orderChanged: boolean;
  } | null>(null);
  const [priceDraftStorageFailed, setPriceDraftStorageFailed] = useState(false);
  const priceReviewSessionRef = useRef(0);
  const [discardPriceChangesOpen, setDiscardPriceChangesOpen] = useState(false);
  const [selectedPriceDocumentId, setSelectedPriceDocumentId] = useState("");
  const [priceReviewControlsHeight, setPriceReviewControlsHeight] = useState(0);
  const priceReviewControlsRef = useRef<HTMLDivElement>(null);
  const [completionConfirmationOpen, setCompletionConfirmationOpen] = useState(false);
  const [paidReleaseOpen, setPaidReleaseOpen] = useState(false);
  const [itemUnits, setItemUnits] = useState<OrderItemUnits>({});
  const [paymentConfirmationOpen, setPaymentConfirmationOpen] = useState(false);
  const [completionPrintPromptOpen, setCompletionPrintPromptOpen] = useState(false);
  const [paymentEditOpen, setPaymentEditOpen] = useState(false);
  const [paymentComment, setPaymentComment] = useState("");
  const [paymentPrintComment, setPaymentPrintComment] = useState("");
  const [stockShortageReleaseOpen, setStockShortageReleaseOpen] = useState(false);
  const [stockShortageComment, setStockShortageComment] = useState("");
  const [reservationModalOpen, setReservationModalOpen] = useState(false);
  const [reservationExpiresAt, setReservationExpiresAt] = useState<Date | undefined>();
  const [orderComment, setOrderComment] = useState("");
  const [printComment, setPrintComment] = useState("");
  const [regularBuyerId, setRegularBuyerId] = useState<string | null>(null);
  const [completedPaymentMethod, setCompletedPaymentMethod] = useState<AdminPaymentMethod>("CASH");
  const [cashPaymentAmount, setCashPaymentAmount] = useState<number | null>(null);
  const [transferPaymentAmount, setTransferPaymentAmount] = useState<number | null>(null);
  const [cardPaymentAmount, setCardPaymentAmount] = useState<number | null>(null);
  const [qrPaymentAmount, setQrPaymentAmount] = useState<number | null>(null);
  const [cashlessPaymentType, setCashlessPaymentType] = useState<"TRANSFER" | "CARD" | "QR">(
    "TRANSFER",
  );
  const [invoiceOpening, setInvoiceOpening] = useState(false);
  const [paymentInvoiceOpening, setPaymentInvoiceOpening] = useState(false);
  const [comparisonPdfOpening, setComparisonPdfOpening] = useState(false);
  const [invoicePrintOptionsOpen, setInvoicePrintOptionsOpen] = useState(false);
  const [invoicePrintTemplate, setInvoicePrintTemplate] =
    useState<InvoicePrintTemplate>("standard");
  const [manualItemOpen, setManualItemOpen] = useState(false);
  const [manualItemName, setManualItemName] = useState("");
  const [manualItemPrice, setManualItemPrice] = useState<number | null>(null);
  const [manualItemQuantity, setManualItemQuantity] = useState("1");
  const [catalogItemOpen, setCatalogItemOpen] = useState(false);
  const [addingCatalogProductId, setAddingCatalogProductId] = useState<number | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<Order["items"][number] | null>(null);
  const [orderItemContextMenu, setOrderItemContextMenu] = useState<{
    item: Order["items"][number];
    x: number;
    y: number;
  } | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<number | null>(null);
  const [itemsSearch, setItemsSearch] = useState("");
  const [deleteOrderOpen, setDeleteOrderOpen] = useState(false);
  const query = useQuery({
    queryKey: ["orders", "admin", id],
    queryFn: () => api<Order>(`/api/admin/orders/${id}`),
    enabled: Boolean(id),
  });
  const returnSummaryQuery = useQuery({
    queryKey: ["orders", "admin", id, "returns"],
    queryFn: () => api<OrderReturnSummary>(`/api/admin/orders/${id}/returns`),
    enabled: Boolean(id) && Boolean(query.data),
  });
  const orderSettingsQuery = useQuery({
    queryKey: ["my-order-settings"],
    queryFn: () => api<{ invoiceTemplate: string }>("/api/auth/order-settings"),
    enabled: paymentConfirmationOpen,
  });
  const priceSettingDocumentsQuery = useQuery({
    queryKey: ["orders", "admin", id, "price-setting-documents"],
    queryFn: () =>
      api<WarehouseDocumentSummary[]>(`/api/admin/orders/${id}/price-setting-documents`),
    enabled: Boolean(id) && priceModalOpen,
  });
  const update = useMutation({
    mutationFn: (status: Order["status"]) =>
      api<Order>(`/api/admin/orders/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (order) => {
      queryClient.setQueryData(["orders", "admin", id], order);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      invalidateIncomingPriceCheck();
      queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
      appToast.success("Статус заказа обновлён");
    },
    onError: (exception) =>
      appToast.error(exception instanceof Error ? exception.message : "Не удалось изменить статус"),
  });
  const reserve = useMutation({
    mutationFn: (expiresAt: Date) =>
      api<Order>(`/api/admin/orders/${id}/reservation`, {
        method: "PUT",
        body: JSON.stringify({ expiresAt: expiresAt.toISOString() }),
      }),
    onSuccess: (updatedOrder) => {
      setReservationModalOpen(false);
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-balances"] });
      queryClient.invalidateQueries({ queryKey: ["warehouse-product-reservations"] });
      appToast.success("Товар зарезервирован");
    },
    onError: (exception) =>
      appToast.error(exception instanceof Error ? exception.message : "Не удалось создать резерв"),
  });
  const deleteOrder = useMutation({
    mutationFn: () => api<void>(`/api/admin/orders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      clearPriceDraft();
      queryClient.removeQueries({ queryKey: ["orders", "admin", id] });
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
      appToast.success("Заказ удалён из рабочих списков");
      navigate(returnPath, { replace: true, state: returnState });
    },
    onError: (exception) =>
      appToast.error(exception instanceof Error ? exception.message : "Не удалось удалить заказ"),
  });
  const copyOrder = useMutation({
    mutationFn: () => api<Order>(`/api/admin/orders/${id}/copy`, { method: "POST" }),
    onSuccess: (copiedOrder) => {
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      appToast.success(`Создан новый заказ № ${copiedOrder.displayCode}`);
      navigate(`/admin/orders/${copiedOrder.id}`, {
        state: { returnTo: returnPath, returnState },
      });
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось создать новый заказ",
      ),
  });
  const completePayment = useMutation({
    mutationFn: ({
      paymentMethod,
      cashAmount,
      cashlessAmount,
      cashlessPaymentType,
      transferAmount,
      cardAmount,
      qrAmount,
      comment,
      printComment,
      releaseWithStockShortage,
      stockShortageComment,
    }: {
      paymentMethod: AdminPaymentMethod;
      cashAmount: number | null;
      cashlessAmount: number | null;
      cashlessPaymentType: "TRANSFER" | "CARD" | "QR" | null;
      transferAmount: number | null;
      cardAmount: number | null;
      qrAmount: number | null;
      comment: string;
      printComment: string;
      releaseWithStockShortage?: boolean;
      stockShortageComment?: string;
    }) =>
      api<Order>(`/api/admin/orders/${id}/complete-payment`, {
        method: "POST",
        body: JSON.stringify({
          paymentMethod,
          cashAmount,
          cashlessAmount,
          cashlessPaymentType,
          transferAmount,
          cardAmount,
          qrAmount,
          comment: comment.trim() || null,
          printComment: printComment.trim() || null,
          itemUnits: orderItemUnitsPayload(query.data?.items ?? [], itemUnits),
          releaseWithStockShortage: Boolean(releaseWithStockShortage),
          stockShortageComment: stockShortageComment?.trim() || null,
        }),
      }),
    onSuccess: (updatedOrder) => {
      setPaymentConfirmationOpen(false);
      setStockShortageReleaseOpen(false);
      setCompletionPrintPromptOpen(true);
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      invalidateIncomingPriceCheck();
      queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
      appToast.success("Оплата принята, заказ завершён");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось завершить оплату заказа",
      ),
  });
  const updateCompletedPayment = useMutation({
    mutationFn: ({
      paymentMethod,
      cashAmount,
      cashlessAmount,
      cashlessPaymentType,
      transferAmount,
      cardAmount,
      qrAmount,
    }: {
      paymentMethod: AdminPaymentMethod;
      cashAmount: number | null;
      cashlessAmount: number | null;
      cashlessPaymentType: "TRANSFER" | "CARD" | "QR" | null;
      transferAmount: number | null;
      cardAmount: number | null;
      qrAmount: number | null;
    }) =>
      api<Order>(`/api/admin/orders/${id}/payment`, {
        method: "PATCH",
        body: JSON.stringify({
          paymentMethod,
          cashAmount,
          cashlessAmount,
          cashlessPaymentType,
          transferAmount,
          cardAmount,
          qrAmount,
        }),
      }),
    onSuccess: (updatedOrder) => {
      setPaymentEditOpen(false);
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      appToast.success("Способ оплаты обновлён");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось изменить способ оплаты",
      ),
  });
  const canReleaseWithStockShortage =
    user?.permissions?.includes("warehouse.negative_stock") ?? false;
  const order = query.data;
  const returnSummaryByItemId = useMemo(
    () => new Map((returnSummaryQuery.data?.items ?? []).map((item) => [item.orderItemId, item])),
    [returnSummaryQuery.data],
  );
  const canEditCompletedPayment = Boolean(
    order &&
    order.status === "COMPLETED" &&
    order.paymentStatus === "PAID" &&
    order.paymentMethod !== "BALANCE" &&
    user?.permissions.includes("orders.update"),
  );
  const incomingPriceCheckQuery = useQuery({
    queryKey: ["orders", "admin", id, "incoming-price-check"],
    queryFn: () => api<OrderIncomingPriceCheck>(`/api/admin/orders/${id}/incoming-price-check`),
    enabled: Boolean(id) && order?.status !== "COMPLETED" && order?.status !== "CANCELLED",
  });
  const incomingPriceByItemId = useMemo(
    () =>
      new Map(
        (incomingPriceCheckQuery.data?.problems ?? []).map((problem) => [
          problem.orderItemId,
          problem.incomingPrice,
        ]),
      ),
    [incomingPriceCheckQuery.data?.problems],
  );
  const belowIncomingPriceItemCount = incomingPriceByItemId.size;
  const filteredOrderItems = useMemo(() => {
    return (order?.items ?? []).filter((item) => {
      return productMatchesSearch(`${item.nameRu} ${item.sku}`, itemsSearch);
    });
  }, [itemsSearch, order?.items]);
  useEffect(() => {
    setOrderComment(order?.comment ?? "");
  }, [order?.id, order?.comment]);
  useEffect(() => {
    setPrintComment(order?.printComment ?? "");
  }, [order?.id, order?.printComment]);
  useEffect(() => {
    setRegularBuyerId(order?.regularBuyerId ?? null);
  }, [order?.id, order?.regularBuyerId]);
  const canUpdateRegularBuyer = user?.permissions.includes("orders.update") ?? false;
  const updateRegularBuyer = useMutation({
    mutationFn: (buyerId: string | null) =>
      api<Order>(`/api/admin/orders/${id}/regular-buyer`, {
        method: "PUT",
        body: JSON.stringify({ regularBuyerId: buyerId }),
      }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["order-activity", id] });
      appToast.success("Получатель накладной сохранён");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось сохранить получателя",
      ),
  });
  const updateComment = useMutation({
    mutationFn: (comment: string) =>
      api<Order>(`/api/admin/orders/${id}/comment`, {
        method: "PATCH",
        body: JSON.stringify({ comment: comment.trim() || null }),
      }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      appToast.success("Комментарий к заказу сохранён");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось сохранить комментарий",
      ),
  });
  const updatePrintComment = useMutation({
    mutationFn: (value: string) =>
      api<Order>(`/api/admin/orders/${id}/print-comment`, {
        method: "PATCH",
        body: JSON.stringify({ printComment: value.trim() || null }),
      }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      appToast.success("Комментарий для накладной сохранён");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error
          ? exception.message
          : "Не удалось сохранить комментарий для накладной",
      ),
  });
  const manualItem = useMutation({
    mutationFn: () =>
      api<Order>(`/api/admin/orders/${id}/manual-items`, {
        method: "POST",
        body: JSON.stringify({
          nameRu: manualItemName,
          unitPrice: manualItemPrice,
          quantity: normalizedQuantity(manualItemQuantity, 0),
        }),
      }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      invalidateIncomingPriceCheck();
      setManualItemOpen(false);
      setManualItemName("");
      setManualItemPrice(null);
      setManualItemQuantity("1");
      appToast.success("Ручная позиция добавлена");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось добавить позицию",
      ),
  });
  const catalogItem = useMutation({
    mutationFn: ({ product, quantity }: { product: Product; quantity: number }) =>
      api<Order>(`/api/admin/orders/${id}/catalog-items`, {
        method: "POST",
        body: JSON.stringify({
          productId: product.id,
          quantity,
        }),
      }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      invalidateIncomingPriceCheck();
      appToast.success("Товар добавлен в заказ");
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось добавить товар в заказ",
      ),
    onSettled: () => setAddingCatalogProductId(null),
  });
  const updateItemQuantity = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      api<Order>(`/api/admin/orders/${id}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      invalidateIncomingPriceCheck();
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось изменить количество",
      ),
  });
  const updateItemMeasurementUnit = useMutation({
    mutationFn: ({
      itemId,
      measurementUnit,
    }: {
      itemId: number;
      measurementUnit: MeasurementUnit;
    }) =>
      api<Order>(`/api/admin/orders/${id}/items/${itemId}/measurement-unit`, {
        method: "PATCH",
        body: JSON.stringify({ measurementUnit }),
      }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось изменить единицу измерения",
      ),
  });
  const deleteItem = useMutation({
    mutationFn: (itemId: number) =>
      api<Order>(`/api/admin/orders/${id}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: (updatedOrder) => {
      setDeleteItemTarget(null);
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
      invalidateIncomingPriceCheck();
      appToast.success("Позиция удалена из заказа");
    },
    onError: (exception) =>
      appToast.error(exception instanceof Error ? exception.message : "Не удалось удалить позицию"),
  });
  const updateItemOrder = useMutation({
    mutationFn: (itemIds: number[]) =>
      api<Order>(`/api/admin/orders/${id}/items/order`, {
        method: "PATCH",
        body: JSON.stringify({ itemIds }),
      }),
    onSuccess: (updatedOrder) => {
      queryClient.setQueryData(["orders", "admin", id], updatedOrder);
      queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
    },
    onError: (exception) =>
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось изменить порядок позиций",
      ),
  });
  const statusOptions = useMemo(
    () =>
      order
        ? Object.entries(orderStatusLabel).map(([value, label]) => ({
            value,
            label,
            disabled:
              order.status === "PRICE_REVIEW"
                ? value !== "PRICE_REVIEW" && value !== "CANCELLED"
                : value === "PRICE_REVIEW" ||
                  (value === "READY_FOR_PICKUP" && order.checkedItems !== order.items.length) ||
                  (value === "COMPLETED" && order.paymentStatus === "PENDING"),
          }))
        : [],
    [order],
  );
  const canUpdatePrices =
    order?.status === "NEW" || order?.status === "PROCESSING" || order?.status === "PRICE_REVIEW";
  const canUpdateProducts = user?.permissions.includes("products.update") ?? false;
  const canReadWarehouse = user?.permissions.includes("warehouse.read") ?? false;
  const warehouseBalancesQuery = useQuery({
    queryKey: ["warehouse-balances"],
    queryFn: fetchWarehouseBalances,
    enabled: canReadWarehouse && catalogItemOpen,
    staleTime: 30_000,
  });
  const stockByProductId = useMemo<ReadonlyMap<number, WarehouseBalance>>(
    () =>
      new Map((warehouseBalancesQuery.data ?? []).map((balance) => [balance.productId, balance])),
    [warehouseBalancesQuery.data],
  );
  const canDeleteOrder = user?.permissions.includes("orders.delete") ?? false;
  const canManageWarehouse = user?.permissions?.includes("warehouse.manage") ?? false;
  const canManageReservation =
    canManageWarehouse && (user?.permissions.includes("orders.update") ?? false);
  const reservationIsActive = Boolean(
    order?.reservationExpiresAt && new Date(order.reservationExpiresAt).getTime() > Date.now(),
  );
  const canEditItems = Boolean(
    order &&
    order.status !== "READY_FOR_PICKUP" &&
    order.status !== "COMPLETED" &&
    order.status !== "CANCELLED",
  );
  const totalItems = order?.items.length ?? 0;
  const checkedItems = order?.checkedItems ?? 0;
  const editOrderProduct = (productId: number | undefined) => {
    if (!order || !productId) return;

    const productReturnPath = `/admin/orders/${order.id}?tab=items`;
    navigate(`/admin/products/${productId}?returnTo=${encodeURIComponent(productReturnPath)}`, {
      state: { returnTo: productReturnPath },
    });
  };
  const moveItem = (itemId: number, direction: -1 | 1) => {
    if (!order) return;
    const currentIndex = order.items.findIndex((item) => item.id === itemId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.items.length) return;
    const itemIds = order.items.map((item) => item.id);
    [itemIds[currentIndex], itemIds[nextIndex]] = [itemIds[nextIndex], itemIds[currentIndex]];
    updateItemOrder.mutate(itemIds);
  };
  const moveItemBefore = (itemId: number, targetItemId: number) => {
    if (!order || itemId === targetItemId) return;
    const itemIds = order.items.map((item) => item.id).filter((id) => id !== itemId);
    const targetIndex = itemIds.indexOf(targetItemId);
    if (targetIndex < 0) return;
    itemIds.splice(targetIndex, 0, itemId);
    updateItemOrder.mutate(itemIds);
  };
  const priceReviewTotal = order
    ? order.items.reduce((sum, item) => {
        const unitPrice = priceValues[item.id] ?? item.unitPrice;
        return sum + unitPrice * item.quantity;
      }, 0)
    : 0;
  const priceReviewDelta = order ? priceReviewTotal - order.paidTotal : 0;
  const priceChangeSummary = useMemo(() => {
    if (!order) return null;
    const changedItems = order.items.flatMap((item) => {
      const unitPrice = priceValues[item.id] ?? item.unitPrice;
      const baselinePrice = priceBaselineValues[item.id] ?? item.unitPrice;
      return unitPrice === baselinePrice ? [] : [{ item, unitPrice, baselinePrice }];
    });
    if (!changedItems.length) return null;
    const previousTotal = changedItems.reduce(
      (sum, { item, baselinePrice }) => sum + baselinePrice * item.quantity,
      0,
    );
    const nextTotal = changedItems.reduce(
      (sum, { item, unitPrice }) => sum + unitPrice * item.quantity,
      0,
    );
    return {
      count: changedItems.length,
      previousTotal,
      nextTotal,
      delta: nextTotal - previousTotal,
    };
  }, [order, priceBaselineValues, priceValues]);
  const hasInvalidPrices = order
    ? order.items.some((item) => {
        const unitPrice = priceValues[item.id] ?? item.unitPrice;
        return unitPrice === null || unitPrice < 0;
      })
    : true;
  const selectedPriceItemIdSet = useMemo(
    () => new Set(selectedPriceItemIds),
    [selectedPriceItemIds],
  );
  const parsedPriceAdjustmentValue = Number(priceAdjustmentValue.replace(",", "."));
  const hasValidPriceAdjustment =
    priceAdjustmentValue.trim() !== "" && Number.isFinite(parsedPriceAdjustmentValue);
  const mixedCashlessPaymentTotal =
    (transferPaymentAmount ?? 0) + (cardPaymentAmount ?? 0) + (qrPaymentAmount ?? 0);
  const mixedPaymentTotal = (cashPaymentAmount ?? 0) + mixedCashlessPaymentTotal;
  const paymentAllocationTotal = paymentEditOpen ? (order?.paidTotal ?? 0) : (order?.total ?? 0);
  const mixedPaymentMatchesOrder =
    paymentAllocationTotal > 0 &&
    cashPaymentAmount !== null &&
    cashPaymentAmount > 0 &&
    mixedCashlessPaymentTotal > 0 &&
    Math.abs(mixedPaymentTotal - paymentAllocationTotal) < 0.005;
  useEffect(() => {
    if (!paymentConfirmationOpen) return;
    setPaymentPrintComment(
      generatedPaymentPrintComment(
        orderSettingsQuery.data?.invoiceTemplate ?? "",
        completedPaymentMethod,
        cashlessPaymentType,
        cashPaymentAmount,
        transferPaymentAmount,
        cardPaymentAmount,
        qrPaymentAmount,
      ),
    );
  }, [
    cardPaymentAmount,
    cashPaymentAmount,
    cashlessPaymentType,
    completedPaymentMethod,
    orderSettingsQuery.data?.invoiceTemplate,
    paymentConfirmationOpen,
    qrPaymentAmount,
    transferPaymentAmount,
  ]);
  useEffect(() => {
    if (!priceModalOpen) {
      setPriceReviewControlsHeight(0);
      return;
    }

    const controls = priceReviewControlsRef.current;
    if (!controls) return;

    const updateHeight = () =>
      setPriceReviewControlsHeight(controls.getBoundingClientRect().height);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [priceModalOpen]);
  const hasPriceChanges = order
    ? (selectedPriceTier !== null && selectedPriceTier !== (order.priceTier ?? "RETAIL")) ||
      order.items.some(
        (item) =>
          (priceValues[item.id] ?? item.unitPrice) !==
          (priceBaselineValues[item.id] ?? item.unitPrice),
      )
    : false;
  const priceReviewOrderChanged = Boolean(
    priceModalOpen &&
    order &&
    priceReviewSignature &&
    orderPriceReviewSignature(order) !== priceReviewSignature,
  );

  useEffect(() => {
    priceReviewSessionRef.current += 1;
    setActivePriceDraftScope(null);
    setPriceModalOpen(false);
    setDiscardPriceChangesOpen(false);
    setRestoredPriceDraft(null);
    setPriceDraftStorageFailed(false);
    setAvailablePriceDraft(user?.id && id ? readOrderPriceReviewDraft(user.id, id) : null);
  }, [priceDraftScope, user?.id, id]);

  // Commit the draft before the next paint, so immediate Back/navigation also
  // preserves the last edit. The scope prevents saving one order under another ID.
  useLayoutEffect(() => {
    if (!priceModalOpen || !user?.id || !id || activePriceDraftScope !== priceDraftScope) return;
    if (!hasPriceChanges) {
      clearOrderPriceReviewDraft(user.id, id);
      return;
    }
    const stored = writeOrderPriceReviewDraft(user.id, id, {
      version: 1,
      savedAt: new Date().toISOString(),
      orderSignature: priceReviewSignature,
      priceValues,
      baselineValues: priceBaselineValues,
      selectedTier: selectedPriceTier,
      tierValues: priceTierValuesByItemId,
      selectedItemIds: selectedPriceItemIds,
      adjustmentOperation: priceAdjustmentOperation,
      adjustmentValue: priceAdjustmentValue,
      changeSources: priceChangeSourceByItemId,
      documentId: selectedPriceDocumentId,
    });
    setPriceDraftStorageFailed(!stored);
  }, [
    activePriceDraftScope,
    hasPriceChanges,
    id,
    priceAdjustmentOperation,
    priceAdjustmentValue,
    priceBaselineValues,
    priceChangeSourceByItemId,
    priceDraftScope,
    priceModalOpen,
    priceReviewSignature,
    priceTierValuesByItemId,
    priceValues,
    selectedPriceDocumentId,
    selectedPriceItemIds,
    selectedPriceTier,
    user?.id,
  ]);

  useEffect(() => {
    if (!priceModalOpen || !hasPriceChanges || activePriceDraftScope !== priceDraftScope) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [activePriceDraftScope, hasPriceChanges, priceDraftScope, priceModalOpen]);

  const priceUpdate = useMutation({
    mutationFn: ({ orderId, priceTier, items }: PriceReviewSubmission) =>
      api<Order>(`/api/admin/orders/${orderId}/prices`, {
        method: "PATCH",
        body: JSON.stringify({ priceTier, items }),
      }),
    onSuccess: (updatedOrder, context) => {
      if (finishPriceReview(updatedOrder, context)) {
        appToast.success("Цены отправлены покупателю на подтверждение");
      }
    },
    onError: (exception, context) => {
      if (context.userId !== user?.id) return;
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось актуализировать цены",
      );
    },
  });
  const priceDocumentUpdate = useMutation({
    mutationFn: ({ orderId, documentId }: PriceReviewRequestContext & { documentId: string }) =>
      api<Order>(`/api/admin/orders/${orderId}/prices/from-price-setting/${documentId}`, {
        method: "POST",
      }),
    onSuccess: (updatedOrder, context) => {
      if (!finishPriceReview(updatedOrder, context)) return;
      appToast.success(
        updatedOrder.createdByUserId === null
          ? "Цены из документа отправлены покупателю на подтверждение"
          : "Цены заказа актуализированы по документу",
      );
    },
    onError: (exception, context) => {
      if (context.userId !== user?.id) return;
      appToast.error(
        exception instanceof Error
          ? exception.message
          : "Не удалось актуализировать цены по документу",
      );
    },
  });
  const priceTierPreview = useMutation({
    mutationFn: ({ orderId, priceTier }: PriceTierPreviewRequest) =>
      api<OrderPriceTierItem[]>(`/api/admin/orders/${orderId}/price-tiers/${priceTier}`),
    onSuccess: (items, context) => {
      if (!isCurrentPricePreview(context)) return;
      const { priceTier, selectedItemIds } = context;
      const catalogPriceValues = Object.fromEntries(
        items.map((item) => [item.orderItemId, item.unitPrice]),
      ) as Record<number, number>;
      const selectedItemIdSet = new Set(selectedItemIds);
      setPriceTierValuesByItemId(catalogPriceValues);
      setPriceValues((current) => {
        if (!order) return current;
        const next = { ...current };
        for (const item of order.items) {
          if (selectedItemIdSet.has(item.id) && catalogPriceValues[item.id] !== undefined) {
            next[item.id] = catalogPriceValues[item.id];
          } else if (priceChangeSourceByItemId[item.id]?.type !== "MANUAL") {
            next[item.id] = priceBaselineValues[item.id] ?? item.unitPrice;
          }
        }
        return next;
      });
      setPriceChangeSourceByItemId((current) => {
        if (!order) return {};
        const next = { ...current };
        for (const item of order.items) {
          if (!selectedItemIdSet.has(item.id)) {
            if (next[item.id]?.type !== "MANUAL") delete next[item.id];
            continue;
          }
          if (catalogPriceValues[item.id] === (priceBaselineValues[item.id] ?? item.unitPrice)) {
            delete next[item.id];
          } else if (catalogPriceValues[item.id] !== undefined) {
            next[item.id] = { type: "TIER", tier: priceTier };
          }
        }
        return next;
      });
    },
    onError: (exception, context) => {
      if (!isCurrentPricePreview(context)) return;
      setSelectedPriceTier(null);
      appToast.error(
        exception instanceof Error ? exception.message : "Не удалось подобрать цены по типу",
      );
    },
  });
  useEffect(() => {
    if (!order || priceModalOpen) return;
    setPriceValues(getOrderPriceValues(order));
    setSelectedPriceTier(order.priceTier ?? "RETAIL");
    setPriceTierValuesByItemId({});
    setPriceChangeSourceByItemId({});
  }, [order, priceModalOpen]);

  function submitPrices(event: FormEvent) {
    event.preventDefault();
    if (
      !order ||
      !canUpdatePrices ||
      !hasPriceChanges ||
      hasInvalidPrices ||
      priceUpdate.isPending ||
      priceDocumentUpdate.isPending ||
      priceTierPreview.isPending
    )
      return;
    if (priceReviewOrderChanged) {
      appToast.error("Заказ изменился. Сверьте цены с текущим заказом перед отправкой.");
      return;
    }
    const context = priceRequestContext();
    if (!context) return;
    priceUpdate.mutate({
      ...context,
      priceTier: selectedPriceTier,
      items: order.items.map((item) => ({
        orderItemId: item.id,
        unitPrice: priceValues[item.id] ?? item.unitPrice,
      })),
    });
  }

  function priceRequestContext(): PriceReviewRequestContext | null {
    if (!user?.id || !id || order?.id !== id) return null;
    return {
      orderId: id,
      userId: user.id,
      draftSavedAt: readOrderPriceReviewDraft(user.id, id)?.savedAt ?? null,
    };
  }

  function finishPriceReview(updatedOrder: Order, context: PriceReviewRequestContext) {
    const draft = readOrderPriceReviewDraft(context.userId, context.orderId);
    const sameDraft = (draft?.savedAt ?? null) === context.draftSavedAt;
    if (sameDraft) clearPriceDraft(context.orderId, context.userId);
    if (user?.id !== context.userId) return false;
    queryClient.setQueryData(["orders", "admin", updatedOrder.id], updatedOrder);
    queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
    queryClient.invalidateQueries({
      queryKey: ["orders", "admin", context.orderId, "incoming-price-check"],
    });
    queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
    if (sameDraft && id === context.orderId) setPriceModalOpen(false);
    return true;
  }

  function applyPriceDocument() {
    if (
      !canUpdatePrices ||
      !selectedPriceDocumentId ||
      priceReviewOrderChanged ||
      priceUpdate.isPending ||
      priceDocumentUpdate.isPending ||
      priceTierPreview.isPending
    )
      return;
    const context = priceRequestContext();
    if (context) priceDocumentUpdate.mutate({ ...context, documentId: selectedPriceDocumentId });
  }

  function isCurrentPricePreview(context: PriceTierPreviewRequest) {
    return (
      priceModalOpen &&
      !priceReviewOrderChanged &&
      id === context.orderId &&
      user?.id === context.userId &&
      context.reviewSession === priceReviewSessionRef.current
    );
  }

  function reconcilePriceReview() {
    if (
      !order ||
      priceUpdate.isPending ||
      priceDocumentUpdate.isPending ||
      priceTierPreview.isPending
    )
      return;
    const itemIds = new Set(order.items.map((item) => item.id));
    const existingEntries = <T,>(values: Record<number, T>): Record<number, T> =>
      Object.fromEntries(Object.entries(values).filter(([key]) => itemIds.has(Number(key))));
    const editedPrices = Object.fromEntries(
      Object.entries(existingEntries(priceValues)).filter(
        ([key, price]) => price !== priceBaselineValues[Number(key)],
      ),
    );
    priceReviewSessionRef.current += 1;
    setPriceValues({ ...getOrderPriceValues(order), ...editedPrices });
    setPriceBaselineValues(getOrderPriceValues(order));
    setPriceTierValuesByItemId(existingEntries(priceTierValuesByItemId));
    setPriceChangeSourceByItemId(existingEntries(priceChangeSourceByItemId));
    setSelectedPriceItemIds((current) => current.filter((itemId) => itemIds.has(itemId)));
    setPriceReviewSignature(orderPriceReviewSignature(order));
    setRestoredPriceDraft({ savedAt: new Date().toISOString(), orderChanged: true });
  }

  function openCompletedPaymentEditor() {
    if (!order || !canEditCompletedPayment) return;
    const paymentMethod =
      order.paymentMethod === "CASH" ||
      order.paymentMethod === "CASHLESS" ||
      order.paymentMethod === "KASPI_STORE" ||
      order.paymentMethod === "MIXED"
        ? order.paymentMethod
        : "CASH";
    setCompletedPaymentMethod(paymentMethod);
    setCashPaymentAmount(order.cashPaymentAmount ?? null);
    setTransferPaymentAmount(order.transferPaymentAmount ?? null);
    setCardPaymentAmount(order.cardPaymentAmount ?? null);
    setQrPaymentAmount(order.qrPaymentAmount ?? null);
    setCashlessPaymentType(order.cashlessPaymentType ?? "TRANSFER");
    setPaymentEditOpen(true);
  }

  function fillPaymentRemainder(target: "cash" | "transfer" | "card" | "qr") {
    const amounts = {
      cash: cashPaymentAmount ?? 0,
      transfer: transferPaymentAmount ?? 0,
      card: cardPaymentAmount ?? 0,
      qr: qrPaymentAmount ?? 0,
    };
    const otherTotal = Object.entries(amounts)
      .filter(([key]) => key !== target)
      .reduce((total, [, amount]) => total + amount, 0);
    const remainder = Math.round((paymentAllocationTotal - otherTotal) * 100) / 100;
    if (remainder < 0) {
      appToast.error("Указанные суммы уже превышают итог заказа");
      return;
    }
    if (target === "cash") setCashPaymentAmount(remainder);
    if (target === "transfer") setTransferPaymentAmount(remainder);
    if (target === "card") setCardPaymentAmount(remainder);
    if (target === "qr") setQrPaymentAmount(remainder);
  }

  function changePriceModalOpen(open: boolean) {
    if (open) {
      openPriceModal();
      return;
    }
    if (priceUpdate.isPending || priceDocumentUpdate.isPending || priceTierPreview.isPending)
      return;
    if (hasPriceChanges) {
      setDiscardPriceChangesOpen(true);
      return;
    }
    clearPriceDraft();
    setPriceModalOpen(false);
  }

  function openPriceModal() {
    if (!order || !canUpdatePrices || order.id !== id) return;
    priceReviewSessionRef.current += 1;
    const draft = user?.id ? readOrderPriceReviewDraft(user.id, order.id) : null;
    if (draft) {
      const signature = orderPriceReviewSignature(order);
      const orderChanged = signature !== draft.orderSignature;
      const itemIds = new Set(order.items.map((item) => item.id));
      const existingEntries = <T,>(values: Record<number, T>): Record<number, T> =>
        Object.fromEntries(Object.entries(values).filter(([key]) => itemIds.has(Number(key))));
      const draftPrices = existingEntries(draft.priceValues);
      const restoredPrices = orderChanged
        ? Object.fromEntries(
            Object.entries(draftPrices).filter(
              ([key, price]) => price !== draft.baselineValues[Number(key)],
            ),
          )
        : draftPrices;
      setPriceValues({ ...getOrderPriceValues(order), ...restoredPrices });
      setPriceBaselineValues(orderChanged ? getOrderPriceValues(order) : draft.baselineValues);
      setSelectedPriceTier(draft.selectedTier);
      setPriceTierValuesByItemId(existingEntries(draft.tierValues));
      setSelectedPriceItemIds(draft.selectedItemIds.filter((itemId) => itemIds.has(itemId)));
      setPriceAdjustmentOperation(draft.adjustmentOperation);
      setPriceAdjustmentValue(draft.adjustmentValue);
      setPriceChangeSourceByItemId(existingEntries(draft.changeSources));
      setSelectedPriceDocumentId(draft.documentId);
      setPriceReviewSignature(signature);
      setActivePriceDraftScope(priceDraftScope);
      setRestoredPriceDraft({ savedAt: draft.savedAt, orderChanged });
    } else {
      resetPriceReview();
    }
    setPriceModalOpen(true);
  }

  function clearPriceDraft(orderId = id, ownerId = user?.id) {
    if (ownerId && orderId) clearOrderPriceReviewDraft(ownerId, orderId);
    if (orderId !== id || ownerId !== user?.id) return;
    priceReviewSessionRef.current += 1;
    setActivePriceDraftScope(null);
    setAvailablePriceDraft(null);
    setRestoredPriceDraft(null);
    setPriceDraftStorageFailed(false);
  }

  function resetPriceReview() {
    if (!order) return;
    clearPriceDraft();
    setActivePriceDraftScope(priceDraftScope);
    setPriceReviewSignature(orderPriceReviewSignature(order));
    const baselineValues = getOrderPriceValues(order);
    setPriceValues(baselineValues);
    setPriceBaselineValues(baselineValues);
    setPriceTierValuesByItemId({});
    setPriceChangeSourceByItemId({});
    setSelectedPriceItemIds(order.items.map((item) => item.id));
    setPriceAdjustmentOperation("PERCENT");
    setPriceAdjustmentValue("");
    setSelectedPriceTier(null);
    setSelectedPriceDocumentId("");
  }

  function selectPriceTier(priceTier: OrderPriceTier) {
    if (priceReviewOrderChanged || !user?.id || !id) return;
    setSelectedPriceTier(priceTier);
    setPriceTierValuesByItemId({});
    if (priceModalOpen) {
      priceTierPreview.mutate({
        orderId: id,
        userId: user.id,
        reviewSession: priceReviewSessionRef.current,
        priceTier,
        selectedItemIds: selectedPriceItemIds,
      });
    }
  }

  function updatePriceValue(item: Order["items"][number], value: number | null) {
    const unitPrice = value === null ? null : Math.max(0, value);
    const baselinePrice = priceBaselineValues[item.id] ?? item.unitPrice;
    setPriceValues((current) => ({ ...current, [item.id]: unitPrice }));
    setPriceChangeSourceByItemId((current) => {
      const next = { ...current };
      if (unitPrice === baselinePrice) delete next[item.id];
      else next[item.id] = { type: "MANUAL" };
      return next;
    });
  }

  function updateLineTotal(item: Order["items"][number], total: number) {
    if (item.quantity <= 0) return;
    updatePriceValue(item, Math.round((total / item.quantity) * 100) / 100);
  }

  function setPriceItemSelected(itemId: number, selected: boolean) {
    const catalogPrice = priceTierValuesByItemId[itemId];
    const item = order?.items.find((candidate) => candidate.id === itemId);
    if (item && selectedPriceTier !== null && catalogPrice !== undefined) {
      const baselinePrice = priceBaselineValues[itemId] ?? item.unitPrice;
      const currentSource = priceChangeSourceByItemId[itemId];
      setPriceValues((current) => ({
        ...current,
        [itemId]: selected
          ? catalogPrice
          : currentSource?.type === "MANUAL"
            ? (current[itemId] ?? item.unitPrice)
            : baselinePrice,
      }));
      setPriceChangeSourceByItemId((current) => {
        const next = { ...current };
        if (selected && catalogPrice !== baselinePrice) {
          next[itemId] = { type: "TIER", tier: selectedPriceTier };
        } else if (selected) {
          delete next[itemId];
        } else if (next[itemId]?.type !== "MANUAL") {
          delete next[itemId];
        }
        return next;
      });
    }
    setSelectedPriceItemIds((current) =>
      selected
        ? current.includes(itemId)
          ? current
          : [...current, itemId]
        : current.filter((id) => id !== itemId),
    );
  }

  function applyPriceAdjustment() {
    if (!order || selectedPriceItemIds.length === 0 || !hasValidPriceAdjustment) return;

    setPriceValues((current) => {
      const next = { ...current };
      const nextSources = { ...priceChangeSourceByItemId };
      for (const item of order.items) {
        if (!selectedPriceItemIdSet.has(item.id)) continue;
        const currentPrice = current[item.id] ?? item.unitPrice;
        const adjustedPrice =
          priceAdjustmentOperation === "PERCENT"
            ? currentPrice * (1 + parsedPriceAdjustmentValue / 100)
            : currentPrice + parsedPriceAdjustmentValue;
        const nextUnitPrice = Math.max(0, Math.round(adjustedPrice));
        next[item.id] = nextUnitPrice;
        if (nextUnitPrice === (priceBaselineValues[item.id] ?? item.unitPrice)) {
          delete nextSources[item.id];
        } else {
          nextSources[item.id] = {
            type: priceAdjustmentOperation,
            value: parsedPriceAdjustmentValue,
          };
        }
      }
      setPriceChangeSourceByItemId(nextSources);
      return next;
    });
  }

  function openInvoice(
    includePrintComment: boolean,
    template: InvoicePrintTemplate = invoicePrintTemplate,
  ) {
    if (!order) return;
    setInvoiceOpening(true);
    void openInvoicePdf(order, includePrintComment, template).finally(() =>
      setInvoiceOpening(false),
    );
  }

  function handleInvoiceClick(template: InvoicePrintTemplate = "standard") {
    setInvoicePrintTemplate(template);
    if (order?.printComment?.trim()) {
      setInvoicePrintOptionsOpen(true);
      return;
    }
    openInvoice(false, template);
  }

  function handleComparisonPdfClick() {
    if (!order) return;
    setComparisonPdfOpening(true);
    void openComparisonPdf(order.id).finally(() => setComparisonPdfOpening(false));
  }

  function handlePaymentInvoiceClick() {
    if (!order) return;
    setPaymentInvoiceOpening(true);
    void openPaymentInvoicePdf(order.id).finally(() => setPaymentInvoiceOpening(false));
  }

  function openReservationModal() {
    const currentExpiry = order?.reservationExpiresAt ? new Date(order.reservationExpiresAt) : null;
    setReservationExpiresAt(
      currentExpiry && currentExpiry.getTime() > Date.now()
        ? currentExpiry
        : new Date(Date.now() + 24 * 60 * 60 * 1000),
    );
    setReservationModalOpen(true);
  }

  function submitReservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reservationExpiresAt || reservationExpiresAt.getTime() <= Date.now()) {
      appToast.error("Укажите время окончания резерва в будущем");
      return;
    }
    reserve.mutate(reservationExpiresAt);
  }

  return (
    <AdminPage
      className="order-workspace"
      title={order ? `Заказ № ${order.displayCode}` : "Заказ"}
      eyebrow="Продажи"
      backAction={
        <AppButton
          type="button"
          variant="ghost"
          aria-label="Назад"
          onClick={() => navigate(returnPath, { replace: true, state: returnState })}
        >
          <ArrowLeft size={18} />
        </AppButton>
      }
      actions={
        order && (
          <>
            <AppSplitButton
              variant="secondary"
              loading={invoiceOpening || paymentInvoiceOpening}
              loadingText="Открываем PDF..."
              onClick={() => handleInvoiceClick()}
              menuLabel="Другие документы для печати"
              actions={[
                {
                  label: "Накладная PDF",
                  icon: <Printer size={18} />,
                  onSelect: () => handleInvoiceClick("z2"),
                },
                {
                  label: "Счёт на оплату PDF",
                  icon: <Printer size={18} />,
                  onSelect: handlePaymentInvoiceClick,
                },
              ]}
            >
              <Printer size={18} />
              Накладная З-2
            </AppSplitButton>
            <AppButton
              type="button"
              variant="secondary"
              loading={copyOrder.isPending}
              loadingText="Создаём заказ..."
              onClick={() => copyOrder.mutate()}
            >
              <CopyPlus size={18} />
              Создать на основе
            </AppButton>
            {canManageReservation && order.status === "PROCESSING" && (
              <AppButton type="button" variant="secondary" onClick={openReservationModal}>
                <PackageCheck size={18} />
                {reservationIsActive ? "Изменить срок резерва" : "В резерв"}
              </AppButton>
            )}
            {canManageWarehouse && order.status === "COMPLETED" && (
              <AppButton
                type="button"
                variant="secondary"
                onClick={() =>
                  navigate("/admin/warehouse/returns/new", {
                    state: {
                      sourceOrderId: order.id,
                      returnTo: `/admin/orders/${order.id}`,
                    },
                  })
                }
              >
                <RotateCcw size={18} />
                Создать возврат
              </AppButton>
            )}
            {canDeleteOrder && (
              <AppButton
                type="button"
                variant="danger"
                onClick={() => setDeleteOrderOpen(true)}
                disabled={deleteOrder.isPending}
              >
                <Trash2 size={18} />
                Удалить заказ
              </AppButton>
            )}
            {order.paymentStatus === "PENDING" &&
              order.status !== "CANCELLED" &&
              order.status !== "COMPLETED" && (
                <AppButton
                  type="button"
                  onClick={() => {
                    setItemUnits({});
                    setPaymentComment(order.comment ?? "");
                    setCompletionConfirmationOpen(true);
                  }}
                  loading={completePayment.isPending}
                >
                  <CheckCircle2 size={18} />
                  Принять оплату и завершить
                </AppButton>
              )}
            <AppSelect
              options={statusOptions}
              value={order.status}
              onValueChange={(value) => {
                if (value === "COMPLETED" && order.paymentStatus === "PAID") {
                  setPaidReleaseOpen(true);
                  return;
                }
                update.mutate(value as Order["status"]);
              }}
              disabled={update.isPending || order.status === "CANCELLED"}
            />
          </>
        )
      }
    >
      {order && canUpdatePrices && availablePriceDraft && !priceModalOpen && (
        <AppCard
          title="Сохранён черновик цен"
          description={`От ${formatDateTime(availablePriceDraft.savedAt)}. Изменения ещё не отправлены на подтверждение.`}
          actions={
            <AppButton type="button" onClick={openPriceModal}>
              Продолжить
            </AppButton>
          }
        >
          При открытии актуализации восстановятся введённые цены. Вернуть исходные значения можно в
          окне цен.
        </AppCard>
      )}
      {!order ? (
        <AppCard>
          <AppSkeleton />
        </AppCard>
      ) : (
        <>
          {order.priceTier && order.priceTier !== "RETAIL" && (
            <AppAlert
              title={`Заказ по цене «${PRICE_TIER_LABELS[order.priceTier]}»`}
              tone="warning"
            >
              Тип цены зафиксирован при оформлении заказа.
            </AppAlert>
          )}
          {order.priceSourceDocumentDeleted && order.priceSourceDocumentId && (
            <AppAlert title="Документ установки цен удалён" tone="warning">
              Цены этого заказа были актуализированы по документу{" "}
              <Link
                to={`/admin/warehouse/documents/${order.priceSourceDocumentId}`}
                state={{ returnTo: `/admin/orders/${order.id}` }}
              >
                {order.priceSourceDocumentNumber ?? "без номера"}
              </Link>
              . Он доступен только для просмотра; восстановление пока недоступно.
              {order.status === "COMPLETED"
                ? " Для изменения цен сначала переведите заказ в статус «В работе»."
                : " При необходимости откройте актуализацию цен и выберите свежий проведённый документ."}
            </AppAlert>
          )}
          {reservationIsActive && (
            <AppAlert title="Товар в резерве" tone="warning">
              Резерв действует до {formatDateTime(order.reservationExpiresAt)}. Статус заказа при
              окончании резерва не изменится.
            </AppAlert>
          )}
          {returnSummaryQuery.data && returnSummaryQuery.data.returnedTotal > 0 && (
            <AppAlert title="По заказу оформлен возврат" tone="warning">
              Возвращено {formatMoney(returnSummaryQuery.data.returnedTotal)}. После возвратов по
              заказу остаётся {formatMoney(returnSummaryQuery.data.remainingTotal)}.
            </AppAlert>
          )}

          <div className="order-detail-tabs">
            <AppTabs
              variant="card"
              defaultValue={initialOrderTab}
              items={[
                {
                  value: "overview",
                  label: "Обзор",
                  content: (
                    <>
                      <div className="dashboard-grid two">
                        <DataPanel title="Клиент" size="compact">
                          <div className="admin-detail-list">
                            <div>
                              <span>Имя</span>
                              <strong>{getOrderBuyerName(order) ?? "Без привязки"}</strong>
                            </div>
                            {order.regularBuyerName?.trim() && order.customerName && (
                              <div>
                                <span>Аккаунт клиента</span>
                                <strong>{order.customerName}</strong>
                              </div>
                            )}
                            <div>
                              <span>
                                {order.regularBuyerName?.trim() ? "Email аккаунта" : "Email"}
                              </span>
                              <strong>{order.customerEmail ?? "—"}</strong>
                            </div>
                            <div>
                              <span>Телефон</span>
                              <strong>{order.contactPhone ?? "—"}</strong>
                            </div>
                          </div>
                          {order.userId && (
                            <div className="admin-panel-footer">
                              <AppButton asChild variant="secondary">
                                <Link to={`/admin/users/${order.userId}`}>
                                  {order.regularBuyerName?.trim()
                                    ? "Аккаунт клиента"
                                    : "Карточка клиента"}
                                </Link>
                              </AppButton>
                            </div>
                          )}
                        </DataPanel>

                        <DataPanel title="Заказ" size="compact">
                          <div className="admin-detail-list">
                            <div>
                              <span>Статус</span>
                              <strong>
                                <AppBadge tone={orderStatusTone(order.status)}>
                                  {orderStatusLabel[order.status]}
                                </AppBadge>
                              </strong>
                            </div>
                            {reservationIsActive && (
                              <div>
                                <span>Резерв</span>
                                <strong>
                                  <AppBadge tone="orange">
                                    До {formatDateTime(order.reservationExpiresAt)}
                                  </AppBadge>
                                </strong>
                              </div>
                            )}
                            <div>
                              <span>Оплата</span>
                              <strong>{paymentStatusLabel[order.paymentStatus]}</strong>
                            </div>
                            <div>
                              <span>Способ оплаты</span>
                              <strong className="admin-order-payment-method">
                                {paymentMethodLabel[order.paymentMethod]}
                                {canEditCompletedPayment && (
                                  <AppButton
                                    type="button"
                                    variant="secondary"
                                    className="admin-order-payment-method__edit"
                                    onClick={openCompletedPaymentEditor}
                                  >
                                    <Pencil size={14} />
                                    Изменить
                                  </AppButton>
                                )}
                              </strong>
                            </div>
                            <div>
                              <span>Тип цены</span>
                              <strong>
                                <AppBadge tone={priceTierTone(order.priceTier ?? "RETAIL")}>
                                  {PRICE_TIER_LABELS[order.priceTier ?? "RETAIL"]}
                                </AppBadge>
                              </strong>
                            </div>
                            {order.paymentStatus === "PAID" && order.cashPaymentAmount != null && (
                              <div>
                                <span>Наличными</span>
                                <strong>{formatMoney(order.cashPaymentAmount)}</strong>
                              </div>
                            )}
                            {order.paymentStatus === "PAID" &&
                              order.paymentMethod !== "MIXED" &&
                              order.cashlessPaymentAmount != null && (
                                <div>
                                  <span>
                                    {order.paymentMethod === "KASPI_STORE"
                                      ? "Kaspi Магазин"
                                      : order.cashlessPaymentType
                                        ? cashlessPaymentTypeLabel[order.cashlessPaymentType]
                                        : "Безналично"}
                                  </span>
                                  <strong>{formatMoney(order.cashlessPaymentAmount)}</strong>
                                </div>
                              )}
                            {order.paymentStatus === "PAID" &&
                              order.paymentMethod === "MIXED" &&
                              order.transferPaymentAmount != null &&
                              order.transferPaymentAmount > 0 && (
                                <div>
                                  <span>Перевод</span>
                                  <strong>{formatMoney(order.transferPaymentAmount)}</strong>
                                </div>
                              )}
                            {order.paymentStatus === "PAID" &&
                              order.paymentMethod === "MIXED" &&
                              order.cardPaymentAmount != null &&
                              order.cardPaymentAmount > 0 && (
                                <div>
                                  <span>Картой</span>
                                  <strong>{formatMoney(order.cardPaymentAmount)}</strong>
                                </div>
                              )}
                            {order.paymentStatus === "PAID" &&
                              order.paymentMethod === "MIXED" &&
                              order.qrPaymentAmount != null &&
                              order.qrPaymentAmount > 0 && (
                                <div>
                                  <span>QR</span>
                                  <strong>{formatMoney(order.qrPaymentAmount)}</strong>
                                </div>
                              )}
                            <div>
                              <span>Получение</span>
                              <strong>
                                {order.fulfillmentType === "DELIVERY" ? "Доставка" : "Самовывоз"}
                              </strong>
                            </div>
                            {order.address && (
                              <div>
                                <span>Адрес</span>
                                <strong>{order.address}</strong>
                              </div>
                            )}
                          </div>
                        </DataPanel>
                      </div>
                      <DataPanel
                        title="Получатель накладной"
                        size="compact"
                        className="order-comment-panel"
                        actions={
                          canUpdateRegularBuyer ? (
                            <AppButton
                              type="submit"
                              form="order-regular-buyer-form"
                              loading={updateRegularBuyer.isPending}
                              disabled={
                                updateRegularBuyer.isPending ||
                                regularBuyerId === (order.regularBuyerId ?? null)
                              }
                            >
                              Сохранить
                            </AppButton>
                          ) : undefined
                        }
                      >
                        {canUpdateRegularBuyer ? (
                          <form
                            id="order-regular-buyer-form"
                            className="order-comment-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              updateRegularBuyer.mutate(regularBuyerId);
                            }}
                          >
                            <RegularBuyerSelect
                              value={regularBuyerId}
                              currentName={
                                regularBuyerId === order.regularBuyerId
                                  ? order.regularBuyerName
                                  : null
                              }
                              onChange={setRegularBuyerId}
                              disabled={updateRegularBuyer.isPending}
                            />
                          </form>
                        ) : (
                          <div className="admin-detail-list">
                            <div>
                              <span>Постоянный покупатель</span>
                              <strong>{order.regularBuyerName || "Не выбран"}</strong>
                            </div>
                          </div>
                        )}
                        {order.regularBuyerName && (
                          <p className="order-regular-buyer-snapshot">
                            В накладной: <strong>{order.regularBuyerName}</strong>
                          </p>
                        )}
                      </DataPanel>
                      <DataPanel
                        title="Комментарий к заказу"
                        size="compact"
                        className="order-comment-panel"
                        actions={
                          <AppButton
                            type="submit"
                            form="order-comment-form"
                            variant="primary"
                            loading={updateComment.isPending}
                            disabled={
                              updateComment.isPending ||
                              orderComment.trim() === (order.comment ?? "").trim()
                            }
                          >
                            Сохранить
                          </AppButton>
                        }
                      >
                        <form
                          id="order-comment-form"
                          className="order-comment-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            updateComment.mutate(orderComment);
                          }}
                        >
                          <AppTextarea
                            label="Комментарий"
                            value={orderComment}
                            maxLength={2_000}
                            rows={4}
                            placeholder="Например, детали оплаты или выдачи заказа"
                            onChange={(event) => setOrderComment(event.target.value)}
                          />
                        </form>
                      </DataPanel>
                      <DataPanel
                        title="Комментарий для накладной"
                        size="compact"
                        className="order-comment-panel"
                        actions={
                          <AppButton
                            type="submit"
                            form="order-print-comment-form"
                            variant="primary"
                            loading={updatePrintComment.isPending}
                            disabled={
                              updatePrintComment.isPending ||
                              printComment.trim() === (order.printComment ?? "").trim()
                            }
                          >
                            Сохранить
                          </AppButton>
                        }
                      >
                        <form
                          id="order-print-comment-form"
                          className="order-comment-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            updatePrintComment.mutate(printComment);
                          }}
                        >
                          <AppTextarea
                            label="Текст печатается внизу накладной"
                            value={printComment}
                            maxLength={4_000}
                            rows={5}
                            placeholder="Например, условия выдачи или важная информация для получателя"
                            onChange={(event) => setPrintComment(event.target.value)}
                          />
                        </form>
                      </DataPanel>
                    </>
                  ),
                },
                {
                  value: "items",
                  label: "Позиции и цены",
                  count: totalItems,
                  content: (
                    <>
                      <DataPanel
                        title="Состав заказа"
                        actions={
                          <>
                            <AppButton
                              type="button"
                              variant="secondary"
                              disabled={!canEditItems}
                              onClick={() => setCatalogItemOpen(true)}
                            >
                              <PackagePlus size={17} />
                              Подобрать товар
                            </AppButton>
                            <AppButton
                              type="button"
                              variant="secondary"
                              disabled={!canEditItems}
                              onClick={() => setManualItemOpen(true)}
                            >
                              Добавить вручную
                            </AppButton>
                            <AppButton
                              type="button"
                              variant="secondary"
                              onClick={openPriceModal}
                              disabled={!canUpdatePrices || priceTierPreview.isPending}
                            >
                              Актуализировать цены
                            </AppButton>
                          </>
                        }
                      >
                        {belowIncomingPriceItemCount > 0 && (
                          <AppAlert title="Есть цены ниже приходной" tone="danger">
                            В {belowIncomingPriceItemCount}{" "}
                            {belowIncomingPriceItemCount === 1 ? "позиции" : "позициях"} цена
                            продажи ниже приходной, действовавшей на дату заказа. Проверьте цены
                            перед завершением заказа.
                          </AppAlert>
                        )}
                        <AppSearchInput
                          fieldClassName="order-items-search"
                          value={itemsSearch}
                          placeholder="Поиск по названию или артикулу"
                          aria-label="Поиск в составе заказа"
                          onChange={(event) => setItemsSearch(event.target.value)}
                        />
                        {filteredOrderItems.length > 0 ? (
                          <div
                            className="order-items-table-scroll"
                            role="region"
                            aria-label="Состав заказа с прокруткой"
                            tabIndex={0}
                          >
                            <AppTable
                              size="compact"
                              className="order-items-table"
                              headers={[
                                "Товар",
                                "Артикул",
                                "Цена",
                                "Количество",
                                "Сумма",
                                "Порядок",
                                "",
                              ]}
                              rowKey={(_, index) => filteredOrderItems[index].id}
                              getRowProps={(_, index) => {
                                const item = filteredOrderItems[index];
                                const isDragTarget =
                                  draggedItemId !== null &&
                                  draggedItemId !== item.id &&
                                  dragOverItemId === item.id;
                                return {
                                  className: isDragTarget
                                    ? "order-items-table__drop-target"
                                    : undefined,
                                  onContextMenu: (event) => {
                                    if (
                                      (!canUpdateProducts && !canReadWarehouse) ||
                                      !item.productId
                                    ) {
                                      return;
                                    }
                                    const target = event.target as HTMLElement;
                                    if (target.closest("button, input, a, [role='button']")) return;
                                    event.preventDefault();
                                    setOrderItemContextMenu({
                                      item,
                                      x: event.clientX,
                                      y: event.clientY,
                                    });
                                  },
                                  onDragOver: (event) => {
                                    if (
                                      !canEditItems ||
                                      updateItemOrder.isPending ||
                                      draggedItemId === null ||
                                      draggedItemId === item.id
                                    ) {
                                      return;
                                    }
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "move";
                                    setDragOverItemId(item.id);
                                  },
                                  onDrop: (event) => {
                                    event.preventDefault();
                                    if (draggedItemId !== null)
                                      moveItemBefore(draggedItemId, item.id);
                                    setDraggedItemId(null);
                                    setDragOverItemId(null);
                                  },
                                };
                              }}
                              rows={filteredOrderItems.map((item) => {
                                const orderItemIndex = order.items.findIndex(
                                  (orderItem) => orderItem.id === item.id,
                                );
                                const incomingPrice = incomingPriceByItemId.get(item.id);
                                const returnItem = returnSummaryByItemId.get(item.id);
                                const belowIncomingPrice = incomingPrice !== undefined;
                                const incomingPriceTooltip = `Приходная цена на дату заказа: ${formatMoney(incomingPrice ?? 0)}`;
                                const productName = (
                                  <div
                                    className={`order-item-name${belowIncomingPrice ? " order-item-name--below-incoming" : ""}`}
                                    tabIndex={belowIncomingPrice ? 0 : undefined}
                                  >
                                    <strong>{item.nameRu}</strong>
                                    {item.madeToOrder && (
                                      <AppBadge className="order-item-made-to-order" tone="orange">
                                        Под заказ
                                      </AppBadge>
                                    )}
                                    {(item.stockShortageQuantity ?? 0) > 0 && (
                                      <AppTooltip
                                        content={
                                          <span>
                                            Отпущено с расхождением: {item.stockShortageQuantity}.{" "}
                                            {item.stockShortageReleasedByUserName ?? "Сотрудник"}
                                            {item.stockShortageReleasedAt
                                              ? ` · ${formatDateTime(item.stockShortageReleasedAt)}`
                                              : ""}
                                            {item.stockShortageComment
                                              ? ` · ${item.stockShortageComment}`
                                              : ""}
                                          </span>
                                        }
                                      >
                                        <AppBadge
                                          className="order-item-stock-shortage-desktop"
                                          tone="red"
                                        >
                                          Расхождение: {item.stockShortageQuantity}
                                        </AppBadge>
                                      </AppTooltip>
                                    )}
                                    {(item.stockShortageQuantity ?? 0) > 0 && (
                                      <details className="order-item-details">
                                        <summary>
                                          Расхождение:{" "}
                                          {formatQuantity(item.stockShortageQuantity ?? 0)}
                                        </summary>
                                        <p>
                                          Отпущено с расхождением:{" "}
                                          {formatQuantity(item.stockShortageQuantity ?? 0)}.{" "}
                                          {item.stockShortageReleasedByUserName ?? "Сотрудник"}
                                          {item.stockShortageReleasedAt
                                            ? ` · ${formatDateTime(item.stockShortageReleasedAt)}`
                                            : ""}
                                          {item.stockShortageComment
                                            ? ` · ${item.stockShortageComment}`
                                            : ""}
                                        </p>
                                      </details>
                                    )}
                                    {belowIncomingPrice && (
                                      <details className="order-item-details">
                                        <summary>Цена ниже приходной</summary>
                                        <p>{incomingPriceTooltip}</p>
                                      </details>
                                    )}
                                    {item.productId && (canUpdateProducts || canReadWarehouse) && (
                                      <div className="order-item-explicit-actions">
                                        <AppActionMenu
                                          label={`Действия с товаром «${item.nameRu}»`}
                                          actions={[
                                            ...(canUpdateProducts
                                              ? [
                                                  {
                                                    label: "Карточка и редактирование товара",
                                                    icon: <Pencil size={17} />,
                                                    onSelect: () =>
                                                      editOrderProduct(item.productId),
                                                  },
                                                ]
                                              : []),
                                            ...(canReadWarehouse
                                              ? [
                                                  {
                                                    label: "Складские документы",
                                                    icon: <ClipboardCheck size={17} />,
                                                    onSelect: () =>
                                                      navigate(
                                                        `/admin/warehouse/balances/${item.productId}/movements`,
                                                        {
                                                          state: {
                                                            returnTo: `/admin/orders/${id}?tab=items`,
                                                          },
                                                        },
                                                      ),
                                                  },
                                                ]
                                              : []),
                                          ]}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                                const unitPrice = (
                                  <span
                                    className={
                                      belowIncomingPrice ? "order-item-price--below-incoming" : ""
                                    }
                                    tabIndex={belowIncomingPrice ? 0 : undefined}
                                  >
                                    {formatMoney(item.unitPrice)}
                                    {item.wholesale && <AppBadge tone="green">Опт</AppBadge>}
                                  </span>
                                );
                                return [
                                  belowIncomingPrice ? (
                                    <AppTooltip content={incomingPriceTooltip}>
                                      {productName}
                                    </AppTooltip>
                                  ) : (
                                    productName
                                  ),
                                  item.sku,
                                  belowIncomingPrice ? (
                                    <AppTooltip content={incomingPriceTooltip}>
                                      {unitPrice}
                                    </AppTooltip>
                                  ) : (
                                    unitPrice
                                  ),
                                  canEditItems ? (
                                    <div className="order-item-quantity-and-unit">
                                      <OrderItemQuantityControl
                                        itemId={item.id}
                                        quantity={item.quantity}
                                        disabled={
                                          updateItemQuantity.isPending ||
                                          deleteItem.isPending ||
                                          updateItemMeasurementUnit.isPending
                                        }
                                        onQuantityChange={(itemId, quantity) =>
                                          updateItemQuantity.mutate({ itemId, quantity })
                                        }
                                      />
                                      <AppSelect
                                        fieldClassName="order-item-measurement-unit"
                                        aria-label={`Единица измерения товара ${item.nameRu}`}
                                        value={item.measurementUnit ?? "PIECE"}
                                        disabled={
                                          !user?.permissions.includes("orders.update") ||
                                          updateItemMeasurementUnit.isPending ||
                                          updateItemQuantity.isPending ||
                                          deleteItem.isPending
                                        }
                                        onChange={(event) =>
                                          updateItemMeasurementUnit.mutate({
                                            itemId: item.id,
                                            measurementUnit: event.target.value as MeasurementUnit,
                                          })
                                        }
                                      >
                                        {measurementUnitOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </AppSelect>
                                    </div>
                                  ) : returnItem && returnItem.returnedQuantity > 0 ? (
                                    <div className="order-item-return-summary">
                                      <strong>
                                        Осталось: {formatQuantity(returnItem.remainingQuantity)} из{" "}
                                        {formatQuantity(returnItem.orderedQuantity)}
                                      </strong>
                                      <small>
                                        Возвращено: {formatQuantity(returnItem.returnedQuantity)}
                                      </small>
                                    </div>
                                  ) : (
                                    `${formatQuantity(item.quantity)} ${measurementUnitLabel(item.measurementUnit)}`
                                  ),
                                  returnItem && returnItem.returnedQuantity > 0 ? (
                                    <div className="order-item-return-summary">
                                      <strong>{formatMoney(returnItem.remainingAmount)}</strong>
                                      <small>
                                        Было: {formatMoney(returnItem.originalAmount)} · возврат:{" "}
                                        {formatMoney(returnItem.returnedAmount)}
                                      </small>
                                    </div>
                                  ) : (
                                    formatMoney(item.lineTotal)
                                  ),
                                  <div className="order-item-order-controls">
                                    <span
                                      className="order-item-drag-handle"
                                      draggable={canEditItems && !updateItemOrder.isPending}
                                      role="img"
                                      aria-label={`Перетащить «${item.nameRu}»`}
                                      title="Перетащите, чтобы изменить порядок"
                                      onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed = "move";
                                        event.dataTransfer.setData("text/plain", String(item.id));
                                        setDraggedItemId(item.id);
                                      }}
                                      onDragEnd={() => {
                                        setDraggedItemId(null);
                                        setDragOverItemId(null);
                                      }}
                                    >
                                      <GripVertical size={17} />
                                    </span>
                                    <AppButton
                                      type="button"
                                      variant="ghost"
                                      className="order-item-order-controls__button"
                                      aria-label={`Переместить «${item.nameRu}» выше`}
                                      title="Переместить выше"
                                      disabled={
                                        !canEditItems ||
                                        orderItemIndex === 0 ||
                                        updateItemOrder.isPending ||
                                        updateItemQuantity.isPending ||
                                        deleteItem.isPending
                                      }
                                      onClick={() => moveItem(item.id, -1)}
                                    >
                                      <ArrowUp size={16} />
                                    </AppButton>
                                    <AppButton
                                      type="button"
                                      variant="ghost"
                                      className="order-item-order-controls__button"
                                      aria-label={`Переместить «${item.nameRu}» ниже`}
                                      title="Переместить ниже"
                                      disabled={
                                        !canEditItems ||
                                        orderItemIndex === order.items.length - 1 ||
                                        updateItemOrder.isPending ||
                                        updateItemQuantity.isPending ||
                                        deleteItem.isPending
                                      }
                                      onClick={() => moveItem(item.id, 1)}
                                    >
                                      <ArrowDown size={16} />
                                    </AppButton>
                                  </div>,
                                  <AppButton
                                    type="button"
                                    variant="ghost"
                                    className="order-item-delete"
                                    aria-label={`Удалить ${item.nameRu}`}
                                    title={
                                      order.items.length <= 1
                                        ? "Последнюю позицию удалить нельзя"
                                        : "Удалить позицию"
                                    }
                                    disabled={
                                      !canEditItems ||
                                      order.items.length <= 1 ||
                                      updateItemOrder.isPending ||
                                      updateItemQuantity.isPending ||
                                      deleteItem.isPending
                                    }
                                    onClick={() => setDeleteItemTarget(item)}
                                  >
                                    <Trash2 size={17} />
                                  </AppButton>,
                                ];
                              })}
                            />
                          </div>
                        ) : (
                          <AppAlert title="Позиции не найдены">
                            Измените запрос или очистите поле поиска.
                          </AppAlert>
                        )}
                        <div className="admin-total-row order-return-total">
                          {returnSummaryQuery.data && returnSummaryQuery.data.returnedTotal > 0 ? (
                            <>
                              <span>
                                Было: {formatMoney(returnSummaryQuery.data.originalTotal)}
                              </span>
                              <span>
                                Возвращено: {formatMoney(returnSummaryQuery.data.returnedTotal)}
                              </span>
                              <strong>
                                После возврата:{" "}
                                {formatMoney(returnSummaryQuery.data.remainingTotal)}
                              </strong>
                            </>
                          ) : (
                            <>
                              <span>Итого</span>
                              <strong>{formatMoney(order.total)}</strong>
                            </>
                          )}
                        </div>
                        {returnSummaryQuery.data &&
                          returnSummaryQuery.data.documents.length > 0 && (
                            <div className="order-return-documents">
                              <strong>Проведённые возвраты</strong>
                              {returnSummaryQuery.data.documents.map((document) => (
                                <div className="order-return-document" key={document.id}>
                                  <AppButton
                                    type="button"
                                    variant="ghost"
                                    onClick={() =>
                                      navigate(`/admin/warehouse/documents/${document.id}`, {
                                        state: { returnTo: `/admin/orders/${order.id}` },
                                      })
                                    }
                                  >
                                    {document.documentNumber ?? "Возврат"}
                                  </AppButton>
                                  <span>
                                    {document.postedAt
                                      ? formatDateTime(document.postedAt)
                                      : "Проведён"}{" "}
                                    · {formatMoney(document.total)}
                                  </span>
                                  <small>
                                    {document.lines
                                      .map(
                                        (line) =>
                                          `${line.productName}: ${formatQuantity(line.quantity)} · ${formatMoney(line.amount)}`,
                                      )
                                      .join("; ")}
                                  </small>
                                </div>
                              ))}
                            </div>
                          )}
                      </DataPanel>
                    </>
                  ),
                },
                {
                  value: "history",
                  label: "История изменений",
                  icon: <History size={17} />,
                  align: "end",
                  content: <OrderActivityHistory orderId={order.id} />,
                },
              ]}
            />
            <AppButton
              type="button"
              variant="secondary"
              className="order-detail-tabs__comparison-pdf"
              loading={comparisonPdfOpening}
              loadingMode="spinner-only"
              aria-label="Скачать сравнительную таблицу в PDF"
              title="Скачать сравнительную таблицу в PDF"
              onClick={handleComparisonPdfClick}
            >
              <FileDown size={17} />
            </AppButton>
          </div>

          <AppContextMenu
            open={Boolean(orderItemContextMenu)}
            x={orderItemContextMenu?.x ?? 0}
            y={orderItemContextMenu?.y ?? 0}
            label={
              orderItemContextMenu
                ? `Действия: ${orderItemContextMenu.item.nameRu}`
                : "Действия с товаром"
            }
            actions={
              orderItemContextMenu
                ? [
                    ...(canReadWarehouse
                      ? [
                          {
                            label: "Складские документы",
                            icon: <ClipboardCheck size={17} />,
                            onSelect: () =>
                              navigate(
                                `/admin/warehouse/balances/${orderItemContextMenu.item.productId}/movements`,
                                { state: { returnTo: `/admin/orders/${id}` } },
                              ),
                          },
                        ]
                      : []),
                    ...(canUpdateProducts
                      ? [
                          {
                            label: "Редактировать товар",
                            icon: <Pencil size={17} />,
                            onSelect: () => editOrderProduct(orderItemContextMenu.item.productId),
                          },
                        ]
                      : []),
                  ]
                : []
            }
            onOpenChange={(open) => {
              if (!open) setOrderItemContextMenu(null);
            }}
          />

          <AppModal
            title={invoicePrintTemplate === "z2" ? "Накладная PDF" : "Накладная З-2"}
            description="Можно открыть оба варианта. Это окно останется открытым после выбора."
            open={invoicePrintOptionsOpen}
            onOpenChange={setInvoicePrintOptionsOpen}
            contentClassName="order-invoice-print-options-modal"
          >
            <div className="order-invoice-print-options__actions">
              <AppButton type="button" variant="secondary" onClick={() => openInvoice(false)}>
                Без комментария
              </AppButton>
              <AppButton type="button" variant="primary" onClick={() => openInvoice(true)}>
                <Printer size={17} />С комментарием
              </AppButton>
              <AppButton
                type="button"
                variant="ghost"
                className="order-invoice-print-options__close"
                onClick={() => setInvoicePrintOptionsOpen(false)}
              >
                Закрыть
              </AppButton>
            </div>
          </AppModal>

          <AppModal
            title="Принять оплату и завершить заказ?"
            description={
              order
                ? `Заказ № ${order.displayCode} на сумму ${formatMoney(order.total)} будет завершён после принятия оплаты.`
                : undefined
            }
            open={completionConfirmationOpen}
            onOpenChange={setCompletionConfirmationOpen}
          >
            <div className="order-payment-confirmation__actions">
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => setCompletionConfirmationOpen(false)}
              >
                Отмена
              </AppButton>
              <AppButton
                type="button"
                onClick={() => {
                  setCompletionConfirmationOpen(false);
                  setPaymentConfirmationOpen(true);
                }}
              >
                Продолжить
              </AppButton>
            </div>
          </AppModal>

          <AppModal
            title="Распечатать документы?"
            description="Заказ успешно завершён. Можно открыть накладную или счёт на оплату для печати."
            open={completionPrintPromptOpen}
            onOpenChange={setCompletionPrintPromptOpen}
          >
            <div className="order-payment-confirmation__actions">
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => setCompletionPrintPromptOpen(false)}
              >
                Не сейчас
              </AppButton>
              <AppSplitButton
                loading={invoiceOpening || paymentInvoiceOpening}
                loadingText="Открываем PDF..."
                menuLabel="Другие документы для печати"
                actions={[
                  {
                    label: "Накладная PDF",
                    icon: <Printer size={18} />,
                    onSelect: () => {
                      setCompletionPrintPromptOpen(false);
                      handleInvoiceClick("z2");
                    },
                  },
                  {
                    label: "Счёт на оплату PDF",
                    icon: <Printer size={18} />,
                    onSelect: handlePaymentInvoiceClick,
                  },
                ]}
                onClick={() => {
                  setCompletionPrintPromptOpen(false);
                  setInvoicePrintTemplate("standard");
                  setInvoicePrintOptionsOpen(true);
                }}
              >
                <Printer size={18} />
                Накладная З-2
              </AppSplitButton>
            </div>
          </AppModal>

          <AppModal
            title="Удалить заказ?"
            description={
              order
                ? `Заказ № ${order.displayCode} будет скрыт из рабочих списков. Данные заказа останутся в базе.`
                : undefined
            }
            open={deleteOrderOpen}
            onOpenChange={setDeleteOrderOpen}
          >
            <div className="order-item-delete-modal__actions">
              <AppButton
                type="button"
                variant="secondary"
                disabled={deleteOrder.isPending}
                onClick={() => setDeleteOrderOpen(false)}
              >
                Отменить
              </AppButton>
              <AppButton
                type="button"
                variant="danger"
                loading={deleteOrder.isPending}
                loadingText="Удаляем..."
                onClick={() => deleteOrder.mutate()}
              >
                Удалить заказ
              </AppButton>
            </div>
          </AppModal>

          <AppModal
            title={reservationIsActive ? "Изменить срок резерва" : "Зарезервировать товар"}
            description="По умолчанию резерв действует 24 часа. В указанное время товар автоматически вернётся в доступный остаток, а статус заказа не изменится."
            open={reservationModalOpen}
            onOpenChange={setReservationModalOpen}
          >
            <form className="order-reservation-form" onSubmit={submitReservation}>
              <AppDateTimePicker
                value={reservationExpiresAt}
                onValueChange={setReservationExpiresAt}
                label="Держать резерв до"
                hint="Время отображается по Алматы"
                required
                clearable={false}
                disabled={reserve.isPending}
              />
              <div className="order-reservation-form__actions">
                <AppButton
                  type="button"
                  variant="secondary"
                  disabled={reserve.isPending}
                  onClick={() => setReservationModalOpen(false)}
                >
                  Отмена
                </AppButton>
                <AppButton type="submit" loading={reserve.isPending} loadingText="Резервируем...">
                  <PackageCheck size={18} />В резерв
                </AppButton>
              </div>
            </form>
          </AppModal>

          <AppModal
            title="Удалить позицию?"
            description={
              deleteItemTarget
                ? `«${deleteItemTarget.nameRu}» будет удалена из заказа. Это действие нельзя отменить.`
                : undefined
            }
            open={Boolean(deleteItemTarget)}
            onOpenChange={(open) => {
              if (!open) setDeleteItemTarget(null);
            }}
          >
            <div className="order-item-delete-modal__actions">
              <AppButton
                type="button"
                variant="secondary"
                disabled={deleteItem.isPending}
                onClick={() => setDeleteItemTarget(null)}
              >
                Отменить
              </AppButton>
              <AppButton
                type="button"
                variant="danger"
                loading={deleteItem.isPending}
                loadingText="Удаляем..."
                onClick={() => {
                  if (deleteItemTarget) deleteItem.mutate(deleteItemTarget.id);
                }}
              >
                Удалить
              </AppButton>
            </div>
          </AppModal>

          <AppModal
            title="Актуализация цен"
            description="Выбранный тип цен применяется только к отмеченным позициям. Изменения сохраняются как черновик при уходе со страницы и восстанавливаются при повторном открытии."
            open={priceModalOpen}
            onOpenChange={changePriceModalOpen}
            contentClassName="admin-price-modal"
          >
            <form className="admin-price-review-form" onSubmit={submitPrices}>
              <div
                className="admin-price-review-form__scroll-content"
                style={
                  {
                    "--admin-price-review-controls-height": `${priceReviewControlsHeight}px`,
                  } as CSSProperties
                }
              >
                <div className="admin-price-review-form__toolbar">
                  <div>
                    <span>Заказ № {order.displayCode}</span>
                    <strong>{getOrderBuyerName(order) ?? "Без привязки к клиенту"}</strong>
                  </div>
                  <AppBadge tone={hasPriceChanges ? "orange" : "slate"}>
                    {hasPriceChanges ? "Есть изменения" : "Без изменений"}
                  </AppBadge>
                </div>

                {restoredPriceDraft && (
                  <AppAlert
                    title={
                      restoredPriceDraft.orderChanged
                        ? "Заказ изменился после сохранения черновика"
                        : "Восстановлены несохранённые цены"
                    }
                    tone={restoredPriceDraft.orderChanged ? "warning" : "info"}
                  >
                    {restoredPriceDraft.orderChanged
                      ? "Восстановлены изменённые цены для оставшихся позиций; остальные цены взяты из текущего заказа. Проверьте значения перед отправкой."
                      : `Черновик от ${formatDateTime(restoredPriceDraft.savedAt)}. Цены ещё не отправлены на подтверждение.`}
                  </AppAlert>
                )}

                {priceDraftStorageFailed && (
                  <AppAlert title="Не удалось сохранить черновик на устройстве" tone="warning">
                    Ввод сохранится при переходах в этой вкладке, но может потеряться при
                    перезагрузке. Завершите редактирование перед закрытием вкладки.
                  </AppAlert>
                )}

                {priceReviewOrderChanged && (
                  <div className="admin-price-review-form__conflict">
                    <AppAlert title="Заказ обновлён во время редактирования" tone="warning">
                      Отправка приостановлена. Сверьте цены: ваш ввод сохранится, а нетронутые
                      позиции получат текущие цены заказа.
                    </AppAlert>
                    <AppButton
                      type="button"
                      variant="secondary"
                      onClick={reconcilePriceReview}
                      disabled={
                        priceUpdate.isPending ||
                        priceDocumentUpdate.isPending ||
                        priceTierPreview.isPending
                      }
                    >
                      Сверить с текущим заказом
                    </AppButton>
                  </div>
                )}

                <div ref={priceReviewControlsRef} className="admin-price-review-form__controls">
                  <div className="admin-price-review-form__tier">
                    <div>
                      <strong>Подставить цены по типу</strong>
                      <span>Текущие цены заказа не изменятся, пока вы не выберете тип.</span>
                    </div>
                    <AppSelect
                      fieldClassName="admin-price-review-form__tier-select"
                      options={PRICE_TIER_ITEMS.map((item) => ({
                        ...item,
                        disabled:
                          !canUpdatePrices ||
                          priceReviewOrderChanged ||
                          priceUpdate.isPending ||
                          priceDocumentUpdate.isPending ||
                          priceTierPreview.isPending,
                      }))}
                      value={selectedPriceTier ?? ""}
                      ariaLabel="Тип цены заказа"
                      onValueChange={(value) => selectPriceTier(value as OrderPriceTier)}
                      placeholder="Оставить текущие цены"
                      clearable={false}
                    />
                  </div>

                  <div className="admin-price-review-form__document-source">
                    <div>
                      <strong>Актуализировать по документу установки цен</strong>
                      <span>
                        Будут взяты зафиксированные цены всех позиций из проведённого документа.
                      </span>
                    </div>
                    <AppSelect
                      fieldClassName="admin-price-review-form__document-select"
                      options={[
                        { value: "", label: "Выберите документ" },
                        ...(priceSettingDocumentsQuery.data ?? []).map((document) => ({
                          value: document.id,
                          label: `${document.documentNumber ?? "Документ"} · ${PRICE_DOCUMENT_TYPE_LABELS[document.priceType ?? ""] ?? "Цена"}`,
                        })),
                      ]}
                      value={selectedPriceDocumentId}
                      ariaLabel="Документ установки цен"
                      disabled={
                        !canUpdatePrices ||
                        priceDocumentUpdate.isPending ||
                        priceSettingDocumentsQuery.isLoading
                      }
                      clearable={false}
                      onValueChange={(value) => setSelectedPriceDocumentId(String(value))}
                    />
                    <AppButton
                      type="button"
                      variant="secondary"
                      disabled={
                        !canUpdatePrices ||
                        !selectedPriceDocumentId ||
                        priceReviewOrderChanged ||
                        priceUpdate.isPending ||
                        priceTierPreview.isPending ||
                        priceDocumentUpdate.isPending ||
                        priceSettingDocumentsQuery.isLoading
                      }
                      loading={priceDocumentUpdate.isPending}
                      loadingText="Применяем"
                      onClick={applyPriceDocument}
                    >
                      Применить документ
                    </AppButton>
                  </div>

                  <div className="admin-price-review-form__bulk-actions">
                    <div className="admin-price-review-form__bulk-selection">
                      <AppButton
                        type="button"
                        variant="secondary"
                        className="admin-price-review-form__bulk-icon"
                        aria-label="Выбрать все позиции"
                        title="Выбрать все позиции"
                        disabled={order.items.length === 0}
                        onClick={() => setSelectedPriceItemIds(order.items.map((item) => item.id))}
                      >
                        <CheckCheck size={18} />
                      </AppButton>
                      <AppButton
                        type="button"
                        variant="secondary"
                        className="admin-price-review-form__bulk-icon"
                        aria-label="Снять выделение со всех позиций"
                        title="Снять выделение со всех позиций"
                        disabled={selectedPriceItemIds.length === 0}
                        onClick={() => setSelectedPriceItemIds([])}
                      >
                        <ListX size={18} />
                      </AppButton>
                    </div>
                    <AppSelect
                      fieldClassName="admin-price-review-form__bulk-operation"
                      options={[
                        { value: "PERCENT", label: "Изменить на процент" },
                        { value: "ADD", label: "Добавить к цене" },
                      ]}
                      value={priceAdjustmentOperation}
                      ariaLabel="Вид массового изменения цены"
                      onValueChange={(value) =>
                        setPriceAdjustmentOperation(value as PriceAdjustmentOperation)
                      }
                      clearable={false}
                    />
                    <AppInput
                      fieldClassName="admin-price-review-form__bulk-value"
                      value={priceAdjustmentValue}
                      inputMode="decimal"
                      placeholder={
                        priceAdjustmentOperation === "PERCENT" ? "Например, -10" : "Сумма"
                      }
                      aria-label="Значение изменения цены"
                      onChange={(event) => setPriceAdjustmentValue(event.target.value)}
                    />
                    <AppButton
                      type="button"
                      variant="secondary"
                      disabled={selectedPriceItemIds.length === 0 || !hasValidPriceAdjustment}
                      onClick={applyPriceAdjustment}
                    >
                      <Play size={17} />
                      Выполнить
                    </AppButton>
                    <AppButton
                      type="button"
                      variant="ghost"
                      disabled={
                        (selectedPriceTier === null && !hasPriceChanges) ||
                        priceUpdate.isPending ||
                        priceTierPreview.isPending
                      }
                      title="Вернуть текущие цены из таблицы заказа"
                      onClick={resetPriceReview}
                    >
                      <RotateCcw size={17} />
                      Вернуть цены заказа
                    </AppButton>
                  </div>
                </div>

                {priceChangeSummary && (
                  <div className="admin-price-review-form__change-summary" role="status">
                    <div>
                      <span>Изменено позиций: {priceChangeSummary.count}</span>
                      <strong>
                        {priceChangeSummary.delta >= 0 ? "Добавлено" : "Отнято"}:{" "}
                        {formatMoney(Math.abs(priceChangeSummary.delta))}
                      </strong>
                    </div>
                    <span className="admin-price-review-form__change-totals">
                      {formatMoney(priceChangeSummary.previousTotal)}
                      <ArrowRight size={16} aria-hidden="true" />
                      <strong>{formatMoney(priceChangeSummary.nextTotal)}</strong>
                    </span>
                  </div>
                )}

                <AppTable
                  size="compact"
                  className="admin-price-review-form__table"
                  headers={[
                    "",
                    "Товар",
                    "Текущая цена",
                    "Цена за единицу",
                    "Изменение",
                    "Кол-во",
                    "Новая сумма",
                  ]}
                  rowKey={(_, index) => order.items[index].id}
                  rows={order.items.map((item) => {
                    const unitPrice = priceValues[item.id] ?? item.unitPrice;
                    const baselinePrice = priceBaselineValues[item.id] ?? item.unitPrice;
                    const priceDelta = unitPrice - baselinePrice;
                    const priceChanged = priceDelta !== 0;
                    const priceChangePercent =
                      baselinePrice > 0 ? (priceDelta / baselinePrice) * 100 : null;
                    return [
                      <AppCheckbox
                        label="Изменять цену"
                        checked={selectedPriceItemIdSet.has(item.id)}
                        disabled={
                          !canUpdatePrices || priceUpdate.isPending || priceTierPreview.isPending
                        }
                        onCheckedChange={(selected) =>
                          setPriceItemSelected(item.id, selected === true)
                        }
                      />,
                      <div className="admin-price-review-form__product">
                        <strong>{item.nameRu}</strong>
                        {item.madeToOrder && (
                          <AppBadge className="order-item-made-to-order" tone="orange">
                            Под заказ
                          </AppBadge>
                        )}
                        <span>Артикул: {item.sku}</span>
                      </div>,
                      formatMoney(baselinePrice),
                      <div
                        className={`admin-price-review-form__unit-price${priceChanged ? " is-changed" : ""}`}
                      >
                        <PriceReviewMoneyInput
                          value={unitPrice}
                          ariaLabel={`Цена за единицу: ${item.nameRu}`}
                          disabled={
                            !canUpdatePrices || priceUpdate.isPending || priceTierPreview.isPending
                          }
                          onValueChange={(value) => updatePriceValue(item, value)}
                        />
                      </div>,
                      priceChanged ? (
                        <div
                          className={`admin-price-review-form__change${priceDelta < 0 ? " is-decrease" : ""}`}
                        >
                          <strong>
                            {priceDelta >= 0 ? "+" : "−"}
                            {formatMoney(Math.abs(priceDelta))}
                          </strong>
                          {priceChangePercent !== null && (
                            <span>
                              {priceChangePercent >= 0 ? "+" : "−"}
                              {Math.abs(priceChangePercent).toFixed(1).replace(".", ",")}%
                            </span>
                          )}
                          <AppBadge tone="orange">
                            {priceChangeSourceLabel(priceChangeSourceByItemId[item.id])}
                          </AppBadge>
                        </div>
                      ) : (
                        <span className="admin-price-review-form__no-change">—</span>
                      ),
                      item.quantity,
                      <div
                        className={`admin-price-review-form__line-total${priceChanged ? " is-changed" : ""}`}
                      >
                        <PriceReviewMoneyInput
                          value={unitPrice * item.quantity}
                          ariaLabel={`Общая стоимость: ${item.nameRu}`}
                          disabled={
                            !canUpdatePrices || priceUpdate.isPending || priceTierPreview.isPending
                          }
                          onValueChange={(value) => updateLineTotal(item, value)}
                        />
                      </div>,
                    ];
                  })}
                />
              </div>

              <div className="admin-price-review-form__actions">
                <div className="admin-price-review-form__summary">
                  <div>
                    <span>Оплачено</span>
                    <strong>{formatMoney(order.paidTotal)}</strong>
                  </div>
                  <div>
                    <span>Новый итог</span>
                    <strong>{formatMoney(priceReviewTotal)}</strong>
                  </div>
                  <div>
                    <span>{priceReviewDelta >= 0 ? "К доплате" : "К возврату"}</span>
                    <strong>{formatMoney(Math.abs(priceReviewDelta))}</strong>
                  </div>
                </div>
                <div className="admin-price-review-form__action-buttons">
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={() => changePriceModalOpen(false)}
                    disabled={
                      priceUpdate.isPending ||
                      priceDocumentUpdate.isPending ||
                      priceTierPreview.isPending
                    }
                  >
                    Закрыть
                  </AppButton>
                  <AppButton
                    type="submit"
                    loading={priceUpdate.isPending}
                    disabled={
                      !canUpdatePrices ||
                      !user?.id ||
                      priceReviewOrderChanged ||
                      priceDocumentUpdate.isPending ||
                      hasInvalidPrices ||
                      !hasPriceChanges ||
                      priceTierPreview.isPending
                    }
                  >
                    Отправить на подтверждение
                  </AppButton>
                </div>
              </div>
            </form>
          </AppModal>

          <AppModal
            title="Отбросить изменения цен?"
            description="Введённые цены ещё не сохранены. При закрытии они будут потеряны."
            open={discardPriceChangesOpen}
            onOpenChange={setDiscardPriceChangesOpen}
          >
            <div className="order-item-delete-modal__actions">
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => setDiscardPriceChangesOpen(false)}
              >
                Продолжить редактирование
              </AppButton>
              <AppButton
                type="button"
                variant="danger"
                onClick={() => {
                  resetPriceReview();
                  setDiscardPriceChangesOpen(false);
                  setPriceModalOpen(false);
                }}
              >
                Отбросить изменения
              </AppButton>
            </div>
          </AppModal>

          <OrderCompletionFlow
            order={order}
            open={paidReleaseOpen}
            onOpenChange={setPaidReleaseOpen}
            onCompleted={(updatedOrder) => {
              queryClient.setQueryData(["orders", "admin", id], updatedOrder);
              queryClient.invalidateQueries({ queryKey: ["orders", "admin"] });
              invalidateIncomingPriceCheck();
              queryClient.invalidateQueries({ queryKey: notificationsQueryKey });
            }}
          />

          <AppModal
            title="Принять оплату и закрыть заказ"
            description={
              checkedItems === 0
                ? `В заказе пока проверено 0 из ${totalItems} позиций. Подтвердите, что все позиции проверены: система отметит сборку и проверку как ${totalItems} из ${totalItems}, примет оплату и закроет заказ.`
                : "Выберите способ, которым была получена оплата."
            }
            open={paymentConfirmationOpen}
            onOpenChange={setPaymentConfirmationOpen}
            contentClassName="order-payment-confirmation-modal"
          >
            <OrderItemUnitFields
              items={order.items}
              values={itemUnits}
              onChange={setItemUnits}
              disabled={completePayment.isPending}
            />
            <AppRadioGroup
              label="Способ оплаты"
              value={completedPaymentMethod}
              onValueChange={(value) => setCompletedPaymentMethod(value as AdminPaymentMethod)}
              options={[
                { value: "CASH", label: "Наличный расчёт" },
                { value: "CASHLESS", label: "Безналичный расчёт" },
                { value: "KASPI_STORE", label: "Kaspi Магазин" },
                { value: "MIXED", label: "Комбинированный расчёт" },
              ]}
            />
            {completedPaymentMethod === "CASHLESS" && (
              <AppRadioGroup
                label="Вид безналичного расчёта"
                value={cashlessPaymentType}
                onValueChange={(value) =>
                  setCashlessPaymentType(value as "TRANSFER" | "CARD" | "QR")
                }
                options={[
                  { value: "TRANSFER", label: "Перевод" },
                  { value: "CARD", label: "Картой" },
                  { value: "QR", label: "QR" },
                ]}
              />
            )}
            {completedPaymentMethod === "MIXED" && (
              <div className="order-payment-confirmation__amounts">
                <PaymentAmountInput
                  label="Наличный расчёт"
                  value={cashPaymentAmount}
                  onValueChange={setCashPaymentAmount}
                  onFillRemainder={() => fillPaymentRemainder("cash")}
                />
                <PaymentAmountInput
                  label="Перевод"
                  value={transferPaymentAmount}
                  onValueChange={setTransferPaymentAmount}
                  onFillRemainder={() => fillPaymentRemainder("transfer")}
                />
                <PaymentAmountInput
                  label="Картой"
                  value={cardPaymentAmount}
                  onValueChange={setCardPaymentAmount}
                  onFillRemainder={() => fillPaymentRemainder("card")}
                />
                <PaymentAmountInput
                  label="QR"
                  value={qrPaymentAmount}
                  onValueChange={setQrPaymentAmount}
                  onFillRemainder={() => fillPaymentRemainder("qr")}
                />
                <span>
                  Указано: {formatMoney(mixedPaymentTotal)} из {formatMoney(order.total)}
                </span>
                {!mixedPaymentMatchesOrder && (
                  <AppAlert title="Сумма не совпадает" tone="warning">
                    Сумма наличного, перевода, оплаты картой и QR должна быть равна итогу заказа.
                  </AppAlert>
                )}
              </div>
            )}
            <AppTextarea
              label="Комментарий к заказу"
              value={paymentComment}
              maxLength={2_000}
              rows={3}
              placeholder="Необязательно"
              onChange={(event) => setPaymentComment(event.target.value)}
            />
            <AppTextarea
              label="Комментарий для печати в накладной"
              value={paymentPrintComment}
              maxLength={2_000}
              rows={3}
              onChange={(event) => setPaymentPrintComment(event.target.value)}
            />
            <div className="order-payment-confirmation__actions">
              <AppButton
                type="button"
                variant="ghost"
                onClick={() => setPaymentConfirmationOpen(false)}
                disabled={completePayment.isPending}
              >
                Вернуться к проверке
              </AppButton>
              <div className="order-payment-confirmation__completion-actions">
                <AppButton
                  type="button"
                  loading={completePayment.isPending}
                  loadingText="Закрываем заказ..."
                  disabled={
                    completePayment.isPending ||
                    (completedPaymentMethod === "MIXED" && !mixedPaymentMatchesOrder)
                  }
                  onClick={() =>
                    completePayment.mutate({
                      paymentMethod: completedPaymentMethod,
                      cashAmount: completedPaymentMethod === "MIXED" ? cashPaymentAmount : null,
                      cashlessAmount: null,
                      cashlessPaymentType:
                        completedPaymentMethod === "CASHLESS" ? cashlessPaymentType : null,
                      transferAmount:
                        completedPaymentMethod === "MIXED" ? transferPaymentAmount : null,
                      cardAmount: completedPaymentMethod === "MIXED" ? cardPaymentAmount : null,
                      qrAmount: completedPaymentMethod === "MIXED" ? qrPaymentAmount : null,
                      comment: paymentComment,
                      printComment: paymentPrintComment,
                    })
                  }
                >
                  <CheckCircle2 size={18} />
                  Всё проверено — завершить
                </AppButton>
                {canReleaseWithStockShortage && (
                  <AppButton
                    type="button"
                    variant="danger"
                    disabled={
                      completePayment.isPending ||
                      (completedPaymentMethod === "MIXED" && !mixedPaymentMatchesOrder)
                    }
                    onClick={() => setStockShortageReleaseOpen(true)}
                  >
                    Отпустить с расхождением
                  </AppButton>
                )}
              </div>
            </div>
          </AppModal>

          <AppModal
            title="Изменить способ оплаты"
            description="Изменится только запись об оплате. Состав заказа, его итог, статус и складская операция останутся без изменений."
            open={paymentEditOpen}
            onOpenChange={setPaymentEditOpen}
            contentClassName="order-payment-confirmation-modal"
          >
            <AppRadioGroup
              label="Способ оплаты"
              value={completedPaymentMethod}
              onValueChange={(value) => setCompletedPaymentMethod(value as AdminPaymentMethod)}
              options={[
                { value: "CASH", label: "Наличный расчёт" },
                { value: "CASHLESS", label: "Безналичный расчёт" },
                { value: "KASPI_STORE", label: "Kaspi Магазин" },
                { value: "MIXED", label: "Комбинированный расчёт" },
              ]}
            />
            {completedPaymentMethod === "CASHLESS" && (
              <AppRadioGroup
                label="Вид безналичного расчёта"
                value={cashlessPaymentType}
                onValueChange={(value) =>
                  setCashlessPaymentType(value as "TRANSFER" | "CARD" | "QR")
                }
                options={[
                  { value: "TRANSFER", label: "Перевод" },
                  { value: "CARD", label: "Картой" },
                  { value: "QR", label: "QR" },
                ]}
              />
            )}
            {completedPaymentMethod === "MIXED" && (
              <div className="order-payment-confirmation__amounts">
                <PaymentAmountInput
                  label="Наличный расчёт"
                  value={cashPaymentAmount}
                  onValueChange={setCashPaymentAmount}
                  onFillRemainder={() => fillPaymentRemainder("cash")}
                />
                <PaymentAmountInput
                  label="Перевод"
                  value={transferPaymentAmount}
                  onValueChange={setTransferPaymentAmount}
                  onFillRemainder={() => fillPaymentRemainder("transfer")}
                />
                <PaymentAmountInput
                  label="Картой"
                  value={cardPaymentAmount}
                  onValueChange={setCardPaymentAmount}
                  onFillRemainder={() => fillPaymentRemainder("card")}
                />
                <PaymentAmountInput
                  label="QR"
                  value={qrPaymentAmount}
                  onValueChange={setQrPaymentAmount}
                  onFillRemainder={() => fillPaymentRemainder("qr")}
                />
                <span>
                  Указано: {formatMoney(mixedPaymentTotal)} из {formatMoney(order.paidTotal)}
                </span>
                {!mixedPaymentMatchesOrder && (
                  <AppAlert title="Сумма не совпадает" tone="warning">
                    Сумма наличного, перевода, оплаты картой и QR должна быть равна итогу заказа.
                  </AppAlert>
                )}
              </div>
            )}
            <div className="order-payment-confirmation__actions">
              <AppButton
                type="button"
                variant="ghost"
                onClick={() => setPaymentEditOpen(false)}
                disabled={updateCompletedPayment.isPending}
              >
                Отмена
              </AppButton>
              <AppButton
                type="button"
                loading={updateCompletedPayment.isPending}
                loadingText="Сохраняем..."
                disabled={
                  updateCompletedPayment.isPending ||
                  (completedPaymentMethod === "MIXED" && !mixedPaymentMatchesOrder)
                }
                onClick={() =>
                  updateCompletedPayment.mutate({
                    paymentMethod: completedPaymentMethod,
                    cashAmount: completedPaymentMethod === "MIXED" ? cashPaymentAmount : null,
                    cashlessAmount: null,
                    cashlessPaymentType:
                      completedPaymentMethod === "CASHLESS" ? cashlessPaymentType : null,
                    transferAmount:
                      completedPaymentMethod === "MIXED" ? transferPaymentAmount : null,
                    cardAmount: completedPaymentMethod === "MIXED" ? cardPaymentAmount : null,
                    qrAmount: completedPaymentMethod === "MIXED" ? qrPaymentAmount : null,
                  })
                }
              >
                Сохранить способ оплаты
              </AppButton>
            </div>
          </AppModal>

          <AppModal
            title="Отпустить с расхождением?"
            description="Система повторно проверит остатки и отметит только позиции, которых не хватает. Будут сохранены сотрудник и время отпуска."
            open={stockShortageReleaseOpen}
            onOpenChange={setStockShortageReleaseOpen}
          >
            <AppTextarea
              label="Комментарий к расхождению"
              value={stockShortageComment}
              maxLength={2_000}
              rows={3}
              placeholder="Необязательно"
              onChange={(event) => setStockShortageComment(event.target.value)}
            />
            <div className="order-payment-confirmation__actions">
              <AppButton
                type="button"
                variant="ghost"
                onClick={() => setStockShortageReleaseOpen(false)}
              >
                Отмена
              </AppButton>
              <AppButton
                type="button"
                variant="danger"
                loading={completePayment.isPending}
                disabled={completedPaymentMethod === "MIXED" && !mixedPaymentMatchesOrder}
                onClick={() =>
                  completePayment.mutate({
                    paymentMethod: completedPaymentMethod,
                    cashAmount: completedPaymentMethod === "MIXED" ? cashPaymentAmount : null,
                    cashlessAmount: null,
                    cashlessPaymentType:
                      completedPaymentMethod === "CASHLESS" ? cashlessPaymentType : null,
                    transferAmount:
                      completedPaymentMethod === "MIXED" ? transferPaymentAmount : null,
                    cardAmount: completedPaymentMethod === "MIXED" ? cardPaymentAmount : null,
                    qrAmount: completedPaymentMethod === "MIXED" ? qrPaymentAmount : null,
                    comment: paymentComment,
                    printComment: paymentPrintComment,
                    releaseWithStockShortage: true,
                    stockShortageComment,
                  })
                }
              >
                Подтвердить отпуск
              </AppButton>
            </div>
          </AppModal>

          <OrderProductPickerModal
            open={catalogItemOpen}
            onOpenChange={setCatalogItemOpen}
            priceTier={order.priceTier ?? "RETAIL"}
            addingProductId={addingCatalogProductId}
            showQuantityPicker
            showAvailability
            mobileAvailabilityOnly
            showStock={canReadWarehouse}
            stockByProductId={stockByProductId}
            stockLoading={warehouseBalancesQuery.isLoading}
            quantityInOrder={(product) =>
              order.items.find((item) => item.productId === product.id)?.quantity ?? 0
            }
            onAdd={(product, quantity = 1) => {
              if (!product.id) return false;
              setAddingCatalogProductId(product.id);
              return catalogItem.mutateAsync({ product, quantity });
            }}
            onEditProduct={
              canUpdateProducts ? (product) => editOrderProduct(product.id) : undefined
            }
          />

          <AppModal
            title="Добавить ручную позицию"
            open={manualItemOpen}
            onOpenChange={setManualItemOpen}
          >
            <form
              className="order-manual-item-form"
              onSubmit={(event) => {
                event.preventDefault();
                manualItem.mutate();
              }}
            >
              <AppInput
                label="Наименование"
                value={manualItemName}
                required
                onChange={(event) => setManualItemName(event.target.value)}
              />
              <AppMoneyInput
                label="Цена"
                value={manualItemPrice}
                required
                onValueChange={setManualItemPrice}
              />
              <AppInput
                label="Количество"
                inputMode="decimal"
                placeholder="Например, 1,5"
                value={manualItemQuantity}
                required
                onChange={(event) =>
                  setManualItemQuantity(
                    event.target.value.replace(",", ".").replace(/[^0-9.]/g, ""),
                  )
                }
              />
              <div className="order-payment-confirmation__actions">
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={() => setManualItemOpen(false)}
                >
                  Отмена
                </AppButton>
                <AppButton
                  type="submit"
                  loading={manualItem.isPending}
                  disabled={
                    !manualItemName.trim() ||
                    !manualItemPrice ||
                    normalizedQuantity(manualItemQuantity, 0) < MIN_ORDER_QUANTITY
                  }
                >
                  Добавить
                </AppButton>
              </div>
            </form>
          </AppModal>
        </>
      )}
    </AdminPage>
  );
}
