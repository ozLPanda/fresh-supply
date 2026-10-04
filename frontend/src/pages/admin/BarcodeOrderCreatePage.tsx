import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Barcode,
  Check,
  CheckCheck,
  ImageOff,
  GripVertical,
  ListX,
  Minus,
  PackagePlus,
  Plus,
  Play,
  Search,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { BarcodeScannerModal } from "@/features/barcodeScanner/BarcodeScannerModal";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { adminMatchesSearch } from "@/shared/lib/adminSearch";
import { AdminPage } from "@/layouts/AdminPage";
import {
  createBarcodeOrder,
  findBarcodeOrderProduct,
  getBarcodeOrderCustomers,
  type BarcodeOrderPriceTier,
  type BarcodeOrderProduct,
} from "@/shared/api/barcodeOrders";
import { API_URL } from "@/shared/api/http";
import { fetchRegularBuyers } from "@/shared/api/regularBuyers";
import { fetchWarehouseBalances, WarehouseBalance } from "@/shared/api/warehouse";
import { MeasurementUnit, Product } from "@/shared/types/models";
import { measurementUnitOptions } from "@/shared/lib/measurementUnit";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert, AppModal, AppSkeleton } from "@/shared/ui/AppFeedback";
import {
  AppInput,
  AppMoneyInput,
  AppSearchInput,
  AppSelect,
  AppTextarea,
} from "@/shared/ui/AppField";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import { OrderProductPickerModal } from "@/features/orders/OrderProductPickerModal";
import { RegularBuyerSelect } from "@/features/orders/RegularBuyerSelect";
import { OrderProductAvailability } from "@/features/orders/OrderProductAvailability";
import {
  MAX_ORDER_QUANTITY,
  MIN_ORDER_QUANTITY,
  normalizeOrderQuantity,
  OrderQuantityInput,
} from "@/features/orders/OrderQuantityInput";
import { Checkbox } from "@/components/ui/checkbox";
import {
  clearBarcodeOrderDraft,
  readBarcodeOrderDraft,
  type BarcodeOrderLine,
  type OrderCreateMode,
  type PendingCustomerBinding,
  type PriceAdjustmentHistoryEntry,
  type PriceAdjustmentOperation,
  writeBarcodeOrderDraft,
} from "./barcodeOrderDraft";
import "./BarcodeOrderCreatePage.css";
import "./OrderWorkspace.css";

const PRICE_TIER_ITEMS = [
  { value: "RETAIL", label: "Розница" },
  { value: "WHOLESALE", label: "Опт" },
  { value: "BULK_WHOLESALE", label: "Крупный опт" },
  { value: "SKO", label: "СКО" },
];

function localDateInputValue(date = new Date()) {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
}

function orderCreateReturnPath(state: unknown, currentPath: string) {
  const returnTo = (state as { returnTo?: unknown } | null)?.returnTo;
  if (
    typeof returnTo !== "string" ||
    !returnTo.startsWith("/admin/") ||
    /[\\\u0000-\u001f]|%2f|%5c/i.test(returnTo)
  )
    return "/admin/orders";
  try {
    const target = new URL(returnTo, window.location.origin);
    return target.origin === window.location.origin &&
      target.pathname.startsWith("/admin/") &&
      target.pathname !== currentPath
      ? `${target.pathname}${target.search}${target.hash}`
      : "/admin/orders";
  } catch {
    return "/admin/orders";
  }
}

function normalizedQuantity(value: number) {
  return normalizeOrderQuantity(value);
}

function getTierPrice(product: BarcodeOrderProduct, tier: BarcodeOrderPriceTier) {
  if (tier === "WHOLESALE") return product.wholesalePrice;
  if (tier === "BULK_WHOLESALE") return product.bulkWholesalePrice;
  if (tier === "SKO") return product.skoPrice;
  return product.retailPrice;
}

function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Цена не указана";
  return `${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value)} ₸`;
}

function formatSignedValue(value: number, suffix = "") {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(
    Math.abs(value),
  )}${suffix}`;
}

function summarizePriceAdjustmentHistory(history: PriceAdjustmentHistoryEntry[]) {
  const hasPercentAdjustment = history.some((item) => item.operation === "PERCENT");
  const hasAmountAdjustment = history.some((item) => item.operation === "ADD");
  const percentAdjustment = history
    .filter((item) => item.operation === "PERCENT")
    .reduce((sum, item) => sum + item.value, 0);
  const amountAdjustment = history
    .filter((item) => item.operation === "ADD")
    .reduce((sum, item) => sum + item.value, 0);

  return {
    operations: history.map((item) =>
      item.operation === "PERCENT"
        ? formatSignedValue(item.value, "%")
        : `${formatSignedValue(item.value)} ₸`,
    ),
    totals: [
      hasPercentAdjustment
        ? `Итого по процентам: ${formatSignedValue(percentAdjustment, "%")}`
        : null,
      hasAmountAdjustment ? `Итого по сумме: ${formatSignedValue(amountAdjustment)} ₸` : null,
    ].filter((item): item is string => item !== null),
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить операцию";
}

function isStockShortageError(error: unknown) {
  return getErrorMessage(error).startsWith("Недостаточно товара на складе:");
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 3 }).format(value);
}

type OrderSubmission = {
  customerId: number | null;
  regularBuyerId: string | null;
  action: "self" | "skip" | "selected";
  pendingBinding?: PendingCustomerBinding | null;
  allowStockShortage?: boolean;
};

type OrderStockShortage = {
  line: BarcodeOrderLine;
  available: number;
  shortage: number;
};

type RemovedOrderLine = {
  line: BarcodeOrderLine;
  index: number;
  selected: boolean;
  originalPrice: number | undefined;
  history: PriceAdjustmentHistoryEntry[] | undefined;
};

function calculateStockShortages(
  lines: BarcodeOrderLine[],
  balances: WarehouseBalance[] | undefined,
): OrderStockShortage[] {
  const balanceByProductId = new Map(
    (balances ?? []).map((balance) => [balance.productId, balance]),
  );
  return lines.flatMap((line) => {
    const balance = balanceByProductId.get(line.id);
    // Products without a warehouse ledger are intentionally not stock-controlled.
    if (!balance) return [];
    const available = Math.max(0, balance.available);
    const shortage = Math.max(0, line.quantity - available);
    return shortage > 0 ? [{ line, available, shortage }] : [];
  });
}

function getImageUrl(path: string | null) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function pendingCustomerBinding(value: string): PendingCustomerBinding | null {
  const contact = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    return { email: contact.toLowerCase(), phone: null, label: contact.toLowerCase() };
  }
  const phone = contact.replace(/\D/g, "");
  return phone.length >= 7 ? { email: null, phone, label: contact } : null;
}

function productToOrderProduct(product: Product): BarcodeOrderProduct | null {
  if (!product.id || product.price === null) return null;
  return {
    id: product.id,
    sku: product.sku,
    name: product.nameRu,
    mainImageUrl: product.images?.find((image) => image.mainImage)?.filePath ?? null,
    madeToOrder: Boolean(product.madeToOrder),
    measurementUnit: product.measurementUnit ?? "PIECE",
    retailPrice: product.price,
    wholesalePrice: product.wholesalePrice ?? null,
    bulkWholesalePrice: product.bulkWholesalePrice ?? null,
    skoPrice: product.skoPrice ?? null,
  };
}

export function BarcodeOrderCreatePage() {
  return <OrderCreatePage mode="barcode" />;
}

export function ProductSelectionOrderCreatePage() {
  return <OrderCreatePage mode="selection" />;
}

function OrderCreatePage({ mode }: { mode: OrderCreateMode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const returnPath = orderCreateReturnPath(location.state, location.pathname);
  const returnState = (location.state as { returnState?: unknown } | null)?.returnState;
  const { user: activeUser } = useCommerce();
  const [lines, setLines] = useState<BarcodeOrderLine[]>([]);
  const [priceTier, setPriceTier] = useState<BarcodeOrderPriceTier>("RETAIL");
  const [orderDate, setOrderDate] = useState(localDateInputValue);
  const [selectedPriceLineIds, setSelectedPriceLineIds] = useState<number[]>([]);
  const [priceAdjustmentOperation, setPriceAdjustmentOperation] =
    useState<PriceAdjustmentOperation>("PERCENT");
  const [priceAdjustmentValue, setPriceAdjustmentValue] = useState("");
  const [priceAdjustmentOriginalPrices, setPriceAdjustmentOriginalPrices] = useState<
    Record<number, number>
  >({});
  const [priceAdjustmentHistoryByLine, setPriceAdjustmentHistoryByLine] = useState<
    Record<number, PriceAdjustmentHistoryEntry[]>
  >({});
  const [clearTableOpen, setClearTableOpen] = useState(false);
  const [draggedLineId, setDraggedLineId] = useState<number | null>(null);
  const [dragOverLineId, setDragOverLineId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [regularBuyerId, setRegularBuyerId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [detectedCode, setDetectedCode] = useState("");
  const [detectedProduct, setDetectedProduct] = useState<BarcodeOrderProduct | null>(null);
  const [detectedQuantity, setDetectedQuantity] = useState(1);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [regularBuyerSearch, setRegularBuyerSearch] = useState("");
  const [customerBindingMode, setCustomerBindingMode] = useState("regular-buyer");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [selectedPendingBinding, setSelectedPendingBinding] =
    useState<PendingCustomerBinding | null>(null);
  const [submittingAction, setSubmittingAction] = useState<OrderSubmission["action"] | null>(null);
  const [checkingStock, setCheckingStock] = useState(false);
  const [stockShortageOpen, setStockShortageOpen] = useState(false);
  const [pendingStockShortageSubmission, setPendingStockShortageSubmission] =
    useState<OrderSubmission | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [restoredDraftScope, setRestoredDraftScope] = useState<string | null>(null);
  const [restoredDraftInfo, setRestoredDraftInfo] = useState<{
    orderDate: string;
    savedAt?: string;
    continued: boolean;
  } | null>(null);
  const [draftDateChoice, setDraftDateChoice] = useState("");
  const [newDraftOpen, setNewDraftOpen] = useState(false);
  const [removedLine, setRemovedLine] = useState<RemovedOrderLine | null>(null);
  const removedLineRef = useRef<RemovedOrderLine | null>(null);
  const activeUserId = activeUser?.id ?? null;
  const canReadWarehouse = activeUser?.permissions?.includes("warehouse.read") ?? false;
  const canReleaseWithStockShortage =
    activeUser?.permissions?.includes("warehouse.negative_stock") ?? false;
  const canUpdateProducts = activeUser?.permissions?.includes("products.update") ?? false;
  const draftScope = activeUserId ? `${activeUserId}:${mode}` : null;

  useEffect(() => {
    removedLineRef.current = null;
    setRemovedLine(null);
    if (!activeUserId || !draftScope) {
      setRestoredDraftScope(null);
      setRestoredDraftInfo(null);
      return;
    }

    const draft = readBarcodeOrderDraft(activeUserId, mode);
    setLines(draft?.lines ?? []);
    setPriceTier(draft?.priceTier ?? "RETAIL");
    setOrderDate(draft?.orderDate ?? localDateInputValue());
    setSelectedPriceLineIds(draft?.selectedPriceLineIds ?? []);
    setPriceAdjustmentOperation(draft?.priceAdjustmentOperation ?? "PERCENT");
    setPriceAdjustmentValue(draft?.priceAdjustmentValue ?? "");
    setPriceAdjustmentOriginalPrices(draft?.priceAdjustmentOriginalPrices ?? {});
    setPriceAdjustmentHistoryByLine(draft?.priceAdjustmentHistoryByLine ?? {});
    setComment(draft?.comment ?? "");
    setRegularBuyerId(draft?.regularBuyerId ?? null);
    setSelectedCustomerId(draft?.selectedCustomerId ?? null);
    setSelectedPendingBinding(draft?.selectedPendingBinding ?? null);
    setRestoredDraftScope(draftScope);
    const hasDraft = Boolean(draft && (draft.lines.length || draft.comment.trim()));
    setRestoredDraftInfo(
      draft && hasDraft
        ? { orderDate: draft.orderDate, savedAt: draft.savedAt, continued: false }
        : null,
    );
    setDraftDateChoice("");

    if (draft?.lines.length) {
      appToast.info("Восстановлен незавершённый заказ на этом устройстве");
    }
  }, [activeUserId, draftScope, mode]);

  useEffect(
    () => () => {
      removedLineRef.current = null;
      appToast.dismiss(`order-line-removal-${draftScope}`);
    },
    [draftScope],
  );

  useEffect(() => {
    if (!activeUserId || restoredDraftScope !== draftScope) return;
    writeBarcodeOrderDraft(activeUserId, mode, {
      lines,
      priceTier,
      orderDate,
      selectedPriceLineIds,
      priceAdjustmentOperation,
      priceAdjustmentValue,
      priceAdjustmentOriginalPrices,
      priceAdjustmentHistoryByLine,
      comment,
      regularBuyerId,
      selectedCustomerId,
      selectedPendingBinding,
    });
  }, [
    activeUserId,
    comment,
    regularBuyerId,
    draftScope,
    lines,
    mode,
    orderDate,
    priceAdjustmentHistoryByLine,
    priceAdjustmentOperation,
    priceAdjustmentOriginalPrices,
    priceAdjustmentValue,
    priceTier,
    restoredDraftScope,
    selectedCustomerId,
    selectedPendingBinding,
    selectedPriceLineIds,
  ]);

  const warehouseBalancesQuery = useQuery({
    queryKey: ["warehouse-balances"],
    queryFn: fetchWarehouseBalances,
    enabled: canReadWarehouse,
    staleTime: 30_000,
  });
  const stockByProductId = useMemo<ReadonlyMap<number, WarehouseBalance>>(
    () =>
      new Map((warehouseBalancesQuery.data ?? []).map((balance) => [balance.productId, balance])),
    [warehouseBalancesQuery.data],
  );
  const stockShortages = useMemo(
    () => calculateStockShortages(lines, warehouseBalancesQuery.data),
    [lines, warehouseBalancesQuery.data],
  );

  const productLookup = useMutation({
    mutationFn: (code: string) => findBarcodeOrderProduct(code, priceTier, orderDate),
    onSuccess: (product) => {
      setDetectedProduct(product);
      setDetectedQuantity(1);
    },
  });

  const usersQuery = useQuery({
    queryKey: ["users", "barcode-order-customer"],
    queryFn: getBarcodeOrderCustomers,
    enabled: customerModalOpen && customerBindingMode === "user",
  });

  const regularBuyersQuery = useQuery({
    queryKey: ["regular-buyers", regularBuyerId ? "all" : "active"],
    queryFn: () => fetchRegularBuyers(Boolean(regularBuyerId)),
    enabled: customerModalOpen && customerBindingMode === "regular-buyer",
  });

  const createOrder = useMutation({
    mutationFn: ({
      customerId,
      regularBuyerId,
      pendingBinding,
      allowStockShortage = false,
    }: OrderSubmission) =>
      createBarcodeOrder({
        customerId,
        regularBuyerId,
        pendingCustomerEmail: pendingBinding?.email ?? null,
        pendingCustomerPhone: pendingBinding?.phone ?? null,
        priceTier,
        orderDate,
        items: lines.map((line) => ({
          productId: line.id,
          quantity: line.quantity,
          unitPrice: line.unitPrice ?? 0,
          measurementUnit: line.measurementUnit ?? "PIECE",
        })),
        comment: comment.trim() || null,
        allowStockShortage,
      }),
    onSuccess: (order) => {
      if (activeUserId) clearBarcodeOrderDraft(activeUserId, mode);
      appToast.success(`Заказ № ${order.displayCode} создан и передан в работу`);
      navigate(`/admin/orders/${order.id}`, { state: { returnTo: returnPath, returnState } });
    },
    onError: async (error, submission) => {
      if (!submission.allowStockShortage && canReadWarehouse && isStockShortageError(error)) {
        const refreshed = await warehouseBalancesQuery.refetch();
        const shortages = calculateStockShortages(lines, refreshed.data);
        if (shortages.length > 0) {
          setPendingStockShortageSubmission(submission);
          setCustomerModalOpen(false);
          setStockShortageOpen(true);
          return;
        }
      }
      appToast.error(getErrorMessage(error));
    },
    onSettled: () => setSubmittingAction(null),
  });

  function startLookup(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    setScannerOpen(false);
    setManualOpen(false);
    setManualError(null);
    setDetectedCode(code);
    setDetectedProduct(null);
    setDetectedQuantity(1);
    productLookup.reset();
    setProductModalOpen(true);
    productLookup.mutate(code);
  }

  function openManualEntry() {
    setScannerOpen(false);
    setManualCode("");
    setManualError(null);
    setManualOpen(true);
  }

  function submitManualCode(event: FormEvent) {
    event.preventDefault();
    const code = manualCode.trim();
    if (!code) {
      setManualError("Введите штрихкод или артикул");
      return;
    }
    if (code.length > 128) {
      setManualError("Код не должен быть длиннее 128 символов");
      return;
    }
    startLookup(code);
  }

  function repeatScan() {
    setProductModalOpen(false);
    setDetectedProduct(null);
    productLookup.reset();
    setScannerOpen(true);
  }

  function confirmDetectedProduct() {
    if (!detectedProduct || getTierPrice(detectedProduct, priceTier) === null) return;
    addProduct(detectedProduct, detectedQuantity);
    setProductModalOpen(false);
    setDetectedProduct(null);
    appToast.success("Товар добавлен в заказ");
  }

  function addProduct(product: BarcodeOrderProduct, quantity = 1) {
    const tierPrice = getTierPrice(product, priceTier);
    if (tierPrice === null) return false;
    setSelectedPriceLineIds((current) =>
      current.includes(product.id) ? current : [...current, product.id],
    );
    setLines((current) => {
      const existing = current.find((line) => line.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.id === product.id
            ? { ...line, quantity: normalizedQuantity(line.quantity + quantity) }
            : line,
        );
      }
      return [
        ...current,
        { ...product, quantity: normalizedQuantity(quantity), unitPrice: tierPrice },
      ];
    });
    return true;
  }

  function addProductFromPicker(product: Product, quantity = 1) {
    const orderProduct = productToOrderProduct(product);
    if (!orderProduct || getTierPrice(orderProduct, priceTier) === null) return false;
    const added = addProduct(orderProduct, quantity);
    if (added) appToast.success("Товар добавлен в заказ");
    return added;
  }

  function updateQuantity(productId: number, quantity: number) {
    const normalized = normalizedQuantity(quantity);
    setLines((current) =>
      current.map((line) => (line.id === productId ? { ...line, quantity: normalized } : line)),
    );
  }

  function updateMeasurementUnit(productId: number, measurementUnit: MeasurementUnit) {
    setLines((current) =>
      current.map((line) => (line.id === productId ? { ...line, measurementUnit } : line)),
    );
  }

  function updateUnitPrice(productId: number, unitPrice: number | null) {
    setLines((current) =>
      current.map((line) =>
        line.id === productId
          ? { ...line, unitPrice: unitPrice === null ? null : Math.max(0, unitPrice) }
          : line,
      ),
    );
  }

  function moveLine(productId: number, direction: -1 | 1) {
    setLines((current) => {
      const currentIndex = current.findIndex((line) => line.id === productId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
      return next;
    });
  }

  function moveLineBefore(productId: number, targetProductId: number) {
    if (productId === targetProductId) return;
    setLines((current) => {
      const movingLine = current.find((line) => line.id === productId);
      const targetIndex = current.findIndex((line) => line.id === targetProductId);
      if (!movingLine || targetIndex < 0) return current;
      const next = current.filter((line) => line.id !== productId);
      next.splice(
        next.findIndex((line) => line.id === targetProductId),
        0,
        movingLine,
      );
      return next;
    });
  }

  function changePriceTier(nextTier: BarcodeOrderPriceTier) {
    removedLineRef.current = null;
    setRemovedLine(null);
    appToast.dismiss(`order-line-removal-${draftScope}`);
    setPriceTier(nextTier);
    setSelectedPriceLineIds([]);
    setPriceAdjustmentOriginalPrices({});
    setPriceAdjustmentHistoryByLine({});
    setLines((current) =>
      current.map((line) => ({ ...line, unitPrice: getTierPrice(line, nextTier) })),
    );
  }

  function setPriceLineSelected(productId: number, selected: boolean) {
    setSelectedPriceLineIds((current) =>
      selected
        ? current.includes(productId)
          ? current
          : [...current, productId]
        : current.filter((id) => id !== productId),
    );
  }

  function applyPriceAdjustment() {
    if (selectedPriceLineIds.length === 0 || !hasValidPriceAdjustment) return;
    const originalPrices: Record<number, number> = {};
    const adjustedLines = lines.map((line) => {
      if (!selectedPriceLineIdSet.has(line.id) || line.unitPrice === null) return line;
      const adjustedPrice =
        priceAdjustmentOperation === "PERCENT"
          ? line.unitPrice * (1 + parsedPriceAdjustmentValue / 100)
          : line.unitPrice + parsedPriceAdjustmentValue;
      const nextUnitPrice = Math.max(0, Math.round(adjustedPrice));
      if (nextUnitPrice === line.unitPrice) return line;
      originalPrices[line.id] = line.unitPrice;
      return {
        ...line,
        unitPrice: nextUnitPrice,
      };
    });

    if (Object.keys(originalPrices).length === 0) return;
    setLines(adjustedLines);
    setPriceAdjustmentOriginalPrices((current) => ({ ...originalPrices, ...current }));
    setPriceAdjustmentHistoryByLine((current) => {
      const next = { ...current };
      Object.keys(originalPrices).forEach((productId) => {
        const id = Number(productId);
        next[id] = [
          ...(next[id] ?? []),
          { operation: priceAdjustmentOperation, value: parsedPriceAdjustmentValue },
        ];
      });
      return next;
    });
  }

  function resetAdjustedPrices() {
    setLines((current) =>
      current.map((line) => {
        const originalPrice = priceAdjustmentOriginalPrices[line.id];
        return originalPrice === undefined ? line : { ...line, unitPrice: originalPrice };
      }),
    );
    setPriceAdjustmentOriginalPrices({});
    setPriceAdjustmentHistoryByLine({});
    setPriceAdjustmentValue("");
    appToast.info("Начальные цены восстановлены");
  }

  function resetAdjustedPrice(productId: number) {
    const originalPrice = priceAdjustmentOriginalPrices[productId];
    if (originalPrice === undefined) return;
    setLines((current) =>
      current.map((line) => (line.id === productId ? { ...line, unitPrice: originalPrice } : line)),
    );
    setPriceAdjustmentOriginalPrices((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    setPriceAdjustmentHistoryByLine((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    appToast.info("Начальная цена товара восстановлена");
  }

  function clearOrderLines() {
    removedLineRef.current = null;
    setRemovedLine(null);
    appToast.dismiss(`order-line-removal-${draftScope}`);
    setLines([]);
    setSelectedPriceLineIds([]);
    setPriceAdjustmentOriginalPrices({});
    setPriceAdjustmentHistoryByLine({});
    setPriceAdjustmentValue("");
    setClearTableOpen(false);
    appToast.info("Таблица заказа очищена");
  }

  function undoRemovedLine() {
    const removed = removedLineRef.current;
    if (!removed) return;
    removedLineRef.current = null;
    setRemovedLine(null);
    appToast.dismiss(`order-line-removal-${draftScope}`);
    setLines((current) => {
      // A product added again keeps its new price; restore the deleted quantity.
      const existing = current.find((line) => line.id === removed.line.id);
      if (existing) {
        return current.map((line) =>
          line.id === removed.line.id
            ? { ...line, quantity: normalizedQuantity(line.quantity + removed.line.quantity) }
            : line,
        );
      }
      const next = [...current];
      next.splice(Math.min(removed.index, next.length), 0, removed.line);
      return next;
    });
    if (removed.selected) {
      setSelectedPriceLineIds((current) => [...new Set([...current, removed.line.id])]);
    }
    if (removed.originalPrice !== undefined) {
      setPriceAdjustmentOriginalPrices((current) =>
        current[removed.line.id] === undefined
          ? { ...current, [removed.line.id]: removed.originalPrice! }
          : current,
      );
    }
    if (removed.history) {
      setPriceAdjustmentHistoryByLine((current) =>
        current[removed.line.id] === undefined
          ? { ...current, [removed.line.id]: removed.history! }
          : current,
      );
    }
    appToast.success("Позиция восстановлена");
  }

  function removeLine(line: BarcodeOrderLine) {
    const removed: RemovedOrderLine = {
      line,
      index: lines.findIndex((item) => item.id === line.id),
      selected: selectedPriceLineIds.includes(line.id),
      originalPrice: priceAdjustmentOriginalPrices[line.id],
      history: priceAdjustmentHistoryByLine[line.id],
    };
    removedLineRef.current = removed;
    setRemovedLine(removed);
    setLines((current) => current.filter((item) => item.id !== line.id));
    setSelectedPriceLineIds((current) => current.filter((id) => id !== line.id));
    setPriceAdjustmentOriginalPrices((current) => {
      const next = { ...current };
      delete next[line.id];
      return next;
    });
    setPriceAdjustmentHistoryByLine((current) => {
      const next = { ...current };
      delete next[line.id];
      return next;
    });
    appToast.info("Позиция удалена", {
      id: `order-line-removal-${draftScope}`,
      duration: 8_000,
      action: { label: "Отменить", onClick: undoRemovedLine },
    });
  }

  function startNewDraft() {
    if (activeUserId) clearBarcodeOrderDraft(activeUserId, mode);
    removedLineRef.current = null;
    setRemovedLine(null);
    appToast.dismiss(`order-line-removal-${draftScope}`);
    setLines([]);
    setPriceTier("RETAIL");
    setOrderDate(localDateInputValue());
    setSelectedPriceLineIds([]);
    setPriceAdjustmentOperation("PERCENT");
    setPriceAdjustmentValue("");
    setPriceAdjustmentOriginalPrices({});
    setPriceAdjustmentHistoryByLine({});
    setComment("");
    setRegularBuyerId(null);
    setSelectedCustomerId(null);
    setSelectedPendingBinding(null);
    setRestoredDraftInfo(null);
    setDraftDateChoice("");
    setNewDraftOpen(false);
    appToast.info("Начат новый заказ с сегодняшней датой");
  }

  const selectedPriceLineIdSet = useMemo(
    () => new Set(selectedPriceLineIds),
    [selectedPriceLineIds],
  );
  const parsedPriceAdjustmentValue = Number(priceAdjustmentValue.replace(",", "."));
  const hasValidPriceAdjustment =
    priceAdjustmentValue.trim() !== "" && Number.isFinite(parsedPriceAdjustmentValue);
  const missingPriceLines = lines.filter((line) => line.unitPrice === null);
  const priceAdjustmentSummary = useMemo(() => {
    const changedLines = lines.flatMap((line) => {
      const originalPrice = priceAdjustmentOriginalPrices[line.id];
      if (
        originalPrice === undefined ||
        line.unitPrice === null ||
        line.unitPrice === originalPrice
      ) {
        return [];
      }
      return [{ line, originalPrice }];
    });
    if (!changedLines.length) return null;

    const previousTotal = changedLines.reduce(
      (sum, { line, originalPrice }) => sum + originalPrice * line.quantity,
      0,
    );
    const nextTotal = changedLines.reduce(
      (sum, { line }) => sum + (line.unitPrice ?? 0) * line.quantity,
      0,
    );
    return {
      count: changedLines.length,
      previousTotal,
      nextTotal,
      delta: nextTotal - previousTotal,
    };
  }, [lines, priceAdjustmentOriginalPrices]);
  const total = lines.reduce((sum, line) => {
    const price = line.unitPrice;
    return sum + (price === null ? 0 : price * line.quantity);
  }, 0);
  const canContinue =
    lines.length > 0 &&
    missingPriceLines.length === 0 &&
    (!restoredDraftInfo || restoredDraftInfo.continued);
  const orderSubmissionPending = createOrder.isPending || checkingStock;

  const columns = useMemo<AppDataTableColumn<BarcodeOrderLine>[]>(
    () => [
      {
        id: "selection",
        header: "",
        searchable: false,
        sortable: false,
        filterable: false,
        hideable: false,
        align: "center",
        width: 54,
        cell: (line) => (
          <Checkbox
            aria-label={`Выбрать «${line.name}»`}
            checked={selectedPriceLineIdSet.has(line.id)}
            onCheckedChange={(selected) => setPriceLineSelected(line.id, selected === true)}
          />
        ),
      },
      {
        id: "product",
        header: "Товар",
        value: (line) => `${line.sku} ${line.name}`,
        cell: (line) => {
          const imageUrl = getImageUrl(line.mainImageUrl);
          return (
            <div className="barcode-order-product">
              <div className="barcode-order-product__image">
                {imageUrl ? (
                  <img src={imageUrl} alt="" loading="lazy" />
                ) : (
                  <ImageOff size={18} aria-hidden="true" />
                )}
              </div>
              <div className="barcode-order-product__main">
                <strong>{line.name}</strong>
                <span>Артикул: {line.sku}</span>
                <OrderProductAvailability
                  madeToOrder={line.madeToOrder}
                  balance={stockByProductId.get(line.id)}
                  showStock={canReadWarehouse}
                  stockLoading={warehouseBalancesQuery.isLoading}
                />
              </div>
            </div>
          );
        },
      },
      {
        id: "order",
        header: "Порядок",
        searchable: false,
        sortable: false,
        filterable: false,
        hideable: false,
        align: "center",
        width: 118,
        cell: (line) => {
          const index = lines.findIndex((item) => item.id === line.id);
          return (
            <div className="barcode-order-line-order">
              <span
                className="barcode-order-line-order__drag-handle"
                draggable
                role="img"
                aria-label={`Перетащить «${line.name}»`}
                title="Перетащите, чтобы изменить порядок"
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(line.id));
                  setDraggedLineId(line.id);
                }}
                onDragEnd={() => {
                  setDraggedLineId(null);
                  setDragOverLineId(null);
                }}
              >
                <GripVertical size={17} />
              </span>
              <AppButton
                type="button"
                variant="ghost"
                className="barcode-order-line-order__button"
                aria-label={`Переместить «${line.name}» выше`}
                title="Переместить выше"
                disabled={index === 0}
                onClick={() => moveLine(line.id, -1)}
              >
                <ArrowUp size={16} />
              </AppButton>
              <AppButton
                type="button"
                variant="ghost"
                className="barcode-order-line-order__button"
                aria-label={`Переместить «${line.name}» ниже`}
                title="Переместить ниже"
                disabled={index === lines.length - 1}
                onClick={() => moveLine(line.id, 1)}
              >
                <ArrowDown size={16} />
              </AppButton>
            </div>
          );
        },
      },
      {
        id: "unitPrice",
        header: "Цена",
        value: (line) => line.unitPrice ?? -1,
        searchable: false,
        align: "right",
        width: 160,
        cell: (line) =>
          line.unitPrice === null ? (
            <AppBadge tone="red">Не указана</AppBadge>
          ) : (
            <div className="barcode-order-unit-price">
              <AppMoneyInput
                value={line.unitPrice}
                min={0}
                step={0.01}
                aria-label={`Цена товара ${line.name}`}
                onValueChange={(value) => updateUnitPrice(line.id, value)}
              />
              {priceAdjustmentOriginalPrices[line.id] !== undefined &&
              priceAdjustmentOriginalPrices[line.id] !== line.unitPrice ? (
                <span className="barcode-order-unit-price__change">
                  {formatMoney(priceAdjustmentOriginalPrices[line.id])}
                  <ArrowRight size={13} aria-hidden="true" />
                  <strong>{formatMoney(line.unitPrice)}</strong>
                </span>
              ) : null}
              {(priceAdjustmentHistoryByLine[line.id]?.length ?? 0) > 0 ? (
                <span className="barcode-order-unit-price__actions">
                  {(() => {
                    const adjustment = summarizePriceAdjustmentHistory(
                      priceAdjustmentHistoryByLine[line.id],
                    );
                    return (
                      <>
                        <span>Действия: {adjustment.operations.join(" · ")}</span>
                        <strong>{adjustment.totals.join(" · ")}</strong>
                      </>
                    );
                  })()}
                </span>
              ) : null}
            </div>
          ),
      },
      {
        id: "quantity",
        header: "Количество / ед.",
        value: (line) => line.quantity,
        searchable: false,
        align: "center",
        width: 260,
        cell: (line) => (
          <div className="barcode-order-quantity">
            <AppButton
              type="button"
              variant="ghost"
              aria-label={`Уменьшить количество товара ${line.name}`}
              disabled={line.quantity <= MIN_ORDER_QUANTITY}
              onClick={() =>
                updateQuantity(line.id, line.quantity - (line.quantity <= 1 ? 0.1 : 1))
              }
            >
              <Minus size={16} />
            </AppButton>
            <OrderQuantityInput
              value={line.quantity}
              aria-label={`Количество товара ${line.name}`}
              onValueChange={(value) => updateQuantity(line.id, value)}
            />
            <AppButton
              type="button"
              variant="ghost"
              aria-label={`Увеличить количество товара ${line.name}`}
              disabled={line.quantity >= MAX_ORDER_QUANTITY}
              onClick={() => updateQuantity(line.id, line.quantity + (line.quantity < 1 ? 0.1 : 1))}
            >
              <Plus size={16} />
            </AppButton>
            <AppSelect
              fieldClassName="barcode-order-measurement-unit"
              aria-label={`Единица измерения товара ${line.name}`}
              value={line.measurementUnit ?? "PIECE"}
              onChange={(event) =>
                updateMeasurementUnit(line.id, event.target.value as MeasurementUnit)
              }
            >
              {measurementUnitOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </AppSelect>
          </div>
        ),
      },
      {
        id: "lineTotal",
        header: "Сумма",
        value: (line) => (line.unitPrice ?? 0) * line.quantity,
        searchable: false,
        align: "right",
        width: 170,
        cell: (line) => (
          <strong>
            {line.unitPrice === null ? "—" : formatMoney(line.unitPrice * line.quantity)}
          </strong>
        ),
      },
      {
        id: "actions",
        header: "",
        hideable: false,
        align: "right",
        width: 108,
        cell: (line) => (
          <div className="barcode-order-row-actions">
            {priceAdjustmentOriginalPrices[line.id] !== undefined ? (
              <AppButton
                type="button"
                variant="ghost"
                className="barcode-order-reset-price"
                aria-label={`Вернуть начальную цену товара ${line.name}`}
                title="Вернуть начальную цену"
                onClick={() => resetAdjustedPrice(line.id)}
              >
                <RotateCcw size={17} />
              </AppButton>
            ) : null}
            <AppButton
              type="button"
              variant="ghost"
              className="barcode-order-delete"
              aria-label={`Удалить товар ${line.name}`}
              onClick={() => removeLine(line)}
            >
              <Trash2 size={18} />
            </AppButton>
          </div>
        ),
      },
    ],
    [
      canReadWarehouse,
      draftScope,
      lines,
      priceAdjustmentHistoryByLine,
      priceAdjustmentOriginalPrices,
      selectedPriceLineIdSet,
      stockByProductId,
      warehouseBalancesQuery.isLoading,
    ],
  );

  const customers = (usersQuery.data ?? []).filter((user) => {
    if (!customerSearch.trim()) return true;
    return [user.name, user.email, user.phone]
      .filter(Boolean)
      .some((value) => adminMatchesSearch(value!, customerSearch));
  });
  const selectedCustomer = (usersQuery.data ?? []).find((user) => user.id === selectedCustomerId);
  const isRegularBuyerBinding = customerBindingMode === "regular-buyer";
  const bindingQuery = isRegularBuyerBinding ? regularBuyersQuery : usersQuery;
  const selectedRegularBuyer = (regularBuyersQuery.data ?? []).find(
    (buyer) => buyer.id === regularBuyerId && !buyer.archived,
  );
  const bindingCandidates = isRegularBuyerBinding
    ? (regularBuyersQuery.data ?? [])
        .filter((buyer) => !buyer.archived)
        .filter((buyer) =>
          [buyer.name, buyer.contactName, buyer.email, buyer.phone].some(
            (value) => value && adminMatchesSearch(value, regularBuyerSearch),
          ),
        )
        .map((buyer) => ({
          id: buyer.id,
          name: buyer.name,
          details: [buyer.contactName, buyer.email, buyer.phone].filter(Boolean).join(" · "),
        }))
    : customers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        details: [customer.email, customer.phone].filter(Boolean).join(" · "),
      }));
  const futureBinding =
    !isRegularBuyerBinding && customers.length === 0
      ? pendingCustomerBinding(customerSearch)
      : null;

  async function submitOrder(
    customerId: number | null,
    pendingBinding: PendingCustomerBinding | null = null,
    action: OrderSubmission["action"] = "selected",
  ) {
    if (!canContinue || createOrder.isPending || checkingStock) return;
    setSubmittingAction(action);
    const submission = { customerId, pendingBinding, regularBuyerId, action };

    if (canReadWarehouse) {
      setCheckingStock(true);
      const refreshed = await warehouseBalancesQuery.refetch();
      setCheckingStock(false);
      const shortages = calculateStockShortages(lines, refreshed.data);
      if (shortages.length > 0) {
        setPendingStockShortageSubmission(submission);
        setSubmittingAction(null);
        setCustomerModalOpen(false);
        setStockShortageOpen(true);
        return;
      }
    }

    createOrder.mutate(submission);
  }

  return (
    <AdminPage
      className="order-workspace"
      eyebrow="Продажи"
      title={mode === "barcode" ? "Новый заказ по штрихкодам" : "Новый заказ"}
      backAction={
        <AppButton
          type="button"
          variant="ghost"
          aria-label="Назад к заказам"
          onClick={() => navigate(returnPath, { replace: true, state: returnState })}
        >
          <ArrowLeft size={18} />
        </AppButton>
      }
    >
      <AppAlert title={mode === "barcode" ? "Быстрое формирование заказа" : "Заказ через подбор"}>
        {mode === "barcode"
          ? "Сканируйте штрихкод камерой телефона или введите код вручную. Цена и итог заказа рассчитываются для выбранного типа продажи."
          : "Подберите товары из каталога, укажите количество, единицу измерения и тип цены. Заказ будет создан с тем же процессом оплаты и сборки."}
      </AppAlert>

      {restoredDraftInfo && (
        <section className="barcode-order-draft" aria-label="Восстановленный черновик">
          <div className="barcode-order-draft__info">
            <strong>
              Черновик от{" "}
              {new Date(`${restoredDraftInfo.orderDate}T00:00:00`).toLocaleDateString("ru-KZ")}
            </strong>
            <span>
              {restoredDraftInfo.continued
                ? `Продолжаете черновик. Дата заказа: ${new Date(`${orderDate}T00:00:00`).toLocaleDateString("ru-KZ")}.`
                : "Выберите дату заказа перед продолжением."}
              {restoredDraftInfo.savedAt &&
                ` Сохранён ${new Date(restoredDraftInfo.savedAt).toLocaleString("ru-KZ")}.`}
            </span>
          </div>
          {!restoredDraftInfo.continued && (
            <>
              <AppSelect
                fieldClassName="barcode-order-draft__date"
                ariaLabel="Дата для продолжения черновика"
                value={draftDateChoice}
                placeholder="Выберите дату заказа"
                clearable={false}
                options={[
                  { value: "today", label: "Сегодняшняя дата" },
                  {
                    value: "original",
                    label: `Оставить ${new Date(`${restoredDraftInfo.orderDate}T00:00:00`).toLocaleDateString("ru-KZ")}`,
                  },
                ]}
                onValueChange={(value) =>
                  setDraftDateChoice(typeof value === "string" ? value : (value[0] ?? ""))
                }
              />
              <AppButton
                type="button"
                disabled={!draftDateChoice}
                onClick={() => {
                  setOrderDate(
                    draftDateChoice === "today"
                      ? localDateInputValue()
                      : restoredDraftInfo.orderDate,
                  );
                  setRestoredDraftInfo({ ...restoredDraftInfo, continued: true });
                }}
              >
                Продолжить
              </AppButton>
            </>
          )}
          <AppButton type="button" variant="secondary" onClick={() => setNewDraftOpen(true)}>
            Начать новый
          </AppButton>
        </section>
      )}

      <DataPanel title="Состав заказа" className="barcode-order-panel">
        <div className="barcode-order-tier">
          <div>
            <strong>Тип продажи</strong>
            <span>При смене типа цены всех позиций пересчитаются автоматически.</span>
          </div>
          <AppSelect
            fieldClassName="barcode-order-tier__select"
            options={PRICE_TIER_ITEMS}
            value={priceTier}
            ariaLabel="Тип цены заказа"
            onValueChange={(value) => changePriceTier(value as BarcodeOrderPriceTier)}
            clearable={false}
          />
          <AppInput
            fieldClassName="barcode-order-tier__date"
            type="date"
            value={orderDate}
            max={localDateInputValue()}
            onChange={(event) => setOrderDate(event.target.value)}
            aria-label="Дата создания заказа"
          />
        </div>

        <div className="barcode-order-bulk-actions">
          <div className="barcode-order-bulk-selection">
            <AppButton
              type="button"
              variant="secondary"
              className="barcode-order-bulk-icon"
              aria-label="Выбрать все позиции"
              title="Выбрать все позиции"
              disabled={lines.length === 0}
              onClick={() => setSelectedPriceLineIds(lines.map((line) => line.id))}
            >
              <CheckCheck size={18} />
            </AppButton>
            <AppButton
              type="button"
              variant="secondary"
              className="barcode-order-bulk-icon"
              aria-label="Снять выделение со всех позиций"
              title="Снять выделение со всех позиций"
              disabled={selectedPriceLineIds.length === 0}
              onClick={() => setSelectedPriceLineIds([])}
            >
              <ListX size={18} />
            </AppButton>
          </div>
          <AppSelect
            fieldClassName="barcode-order-bulk-operation"
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
            fieldClassName="barcode-order-bulk-value"
            value={priceAdjustmentValue}
            inputMode="decimal"
            placeholder={priceAdjustmentOperation === "PERCENT" ? "Например, -10" : "Сумма"}
            aria-label="Значение изменения цены"
            onChange={(event) => setPriceAdjustmentValue(event.target.value)}
          />
          <AppButton
            type="button"
            variant="secondary"
            disabled={selectedPriceLineIds.length === 0 || !hasValidPriceAdjustment}
            onClick={applyPriceAdjustment}
          >
            <Play size={17} />
            Выполнить
          </AppButton>
          {priceAdjustmentSummary ? (
            <AppButton type="button" variant="ghost" onClick={resetAdjustedPrices}>
              <RotateCcw size={17} />
              Вернуть начальные цены
            </AppButton>
          ) : null}
          <AppButton
            type="button"
            variant="danger"
            disabled={lines.length === 0}
            onClick={() => setClearTableOpen(true)}
          >
            <Trash2 size={17} />
            Очистить таблицу
          </AppButton>
          <AppButton
            type="button"
            className="barcode-order-bulk-add-product"
            disabled={productLookup.isPending || createOrder.isPending}
            onClick={() => {
              if (mode === "barcode") {
                setScannerOpen(true);
                return;
              }
              setProductPickerOpen(true);
            }}
          >
            <Plus size={18} />
            {mode === "barcode" ? "Добавить товар" : "Подобрать товар"}
          </AppButton>
        </div>

        {removedLine && (
          <div className="barcode-order-undo" role="status">
            <span>Позиция удалена: {removedLine.line.name}</span>
            <AppButton type="button" variant="secondary" onClick={undoRemovedLine}>
              <RotateCcw size={17} /> Отменить
            </AppButton>
          </div>
        )}

        <AppDataTable
          className="barcode-order-table"
          data={lines}
          columns={columns}
          rowId={(line) => String(line.id)}
          rowProps={(line) => ({
            className:
              draggedLineId !== null && draggedLineId !== line.id && dragOverLineId === line.id
                ? "barcode-order-table__drop-target"
                : undefined,
            onDragOver: (event) => {
              if (draggedLineId === null || draggedLineId === line.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverLineId(line.id);
            },
            onDrop: (event) => {
              event.preventDefault();
              if (draggedLineId !== null) moveLineBefore(draggedLineId, line.id);
              setDraggedLineId(null);
              setDragOverLineId(null);
            },
          })}
          searchable={lines.length > 0}
          selectable={false}
          pagination={false}
          emptyTitle="В заказе пока нет товаров"
          emptyDescription={
            mode === "barcode"
              ? "Нажмите «Добавить товар», отсканируйте штрихкод и подтвердите позицию."
              : "Нажмите «Подобрать товар» и добавьте позиции из каталога."
          }
        />

        {priceAdjustmentSummary ? (
          <div className="barcode-order-price-adjustment" role="status">
            <div>
              <span>Изменено позиций: {priceAdjustmentSummary.count}</span>
              <strong>
                {priceAdjustmentSummary.delta >= 0 ? "Добавлено" : "Отнято"}:{" "}
                {formatMoney(Math.abs(priceAdjustmentSummary.delta))}
              </strong>
            </div>
            <span className="barcode-order-price-adjustment__totals">
              {formatMoney(priceAdjustmentSummary.previousTotal)}
              <ArrowRight size={16} aria-hidden="true" />
              <strong>{formatMoney(priceAdjustmentSummary.nextTotal)}</strong>
            </span>
          </div>
        ) : null}

        {missingPriceLines.length > 0 && (
          <AppAlert title="Не для всех товаров указана цена" tone="danger">
            Для выбранного типа продажи отсутствует цена у {missingPriceLines.length} позиций:{" "}
            {missingPriceLines.map((line) => line.sku).join(", ")}. Выберите другой тип цены или
            удалите эти позиции.
          </AppAlert>
        )}

        <div className="barcode-order-buyer">
          <RegularBuyerSelect
            value={regularBuyerId}
            onChange={setRegularBuyerId}
            disabled={createOrder.isPending || checkingStock}
          />
        </div>

        <div className="barcode-order-footer">
          <AppTextarea
            label="Комментарий к заказу"
            value={comment}
            maxLength={1_000}
            placeholder="Необязательно"
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="barcode-order-summary">
            <span>
              Позиций: <b>{lines.length}</b>
            </span>
            <span>
              Товаров: <b>{lines.reduce((sum, line) => sum + line.quantity, 0)}</b>
            </span>
            <strong className="barcode-order-summary__total">
              Итого: {missingPriceLines.length ? "—" : formatMoney(total)}
            </strong>
            <AppButton
              type="button"
              disabled={!canContinue}
              onClick={() => {
                setSelectedCustomerId(null);
                setSelectedPendingBinding(null);
                setCustomerBindingMode("regular-buyer");
                setCustomerModalOpen(true);
              }}
            >
              <Check size={18} />
              Подтвердить заказ
            </AppButton>
          </div>
        </div>
      </DataPanel>

      <AppModal
        title="Начать новый заказ?"
        description="Восстановленный черновик будет удалён. Новый заказ начнётся с сегодняшней датой."
        open={newDraftOpen}
        onOpenChange={setNewDraftOpen}
        contentClassName="barcode-order-modal"
      >
        <div className="barcode-order-modal__actions">
          <AppButton type="button" variant="ghost" onClick={() => setNewDraftOpen(false)}>
            Отмена
          </AppButton>
          <AppButton type="button" onClick={startNewDraft}>
            Начать новый
          </AppButton>
        </div>
      </AppModal>

      <AppModal
        title="Очистить таблицу?"
        description={`Будет удалено позиций: ${lines.length}. Это действие нельзя отменить.`}
        open={clearTableOpen}
        onOpenChange={setClearTableOpen}
        contentClassName="barcode-order-modal"
      >
        <div className="barcode-order-modal__actions">
          <AppButton type="button" variant="ghost" onClick={() => setClearTableOpen(false)}>
            Отмена
          </AppButton>
          <AppButton type="button" variant="danger" onClick={clearOrderLines}>
            <Trash2 size={17} />
            Очистить
          </AppButton>
        </div>
      </AppModal>

      {mode === "selection" && (
        <OrderProductPickerModal
          open={productPickerOpen}
          onOpenChange={setProductPickerOpen}
          priceTier={priceTier}
          onAdd={addProductFromPicker}
          showQuantityPicker
          quantityInOrder={(product) => lines.find((line) => line.id === product.id)?.quantity ?? 0}
          showAvailability
          showStock={canReadWarehouse}
          stockByProductId={stockByProductId}
          stockLoading={warehouseBalancesQuery.isLoading}
          onEditProduct={
            canUpdateProducts
              ? (product) => {
                  if (!product.id) return;
                  const returnTo = `${location.pathname}${location.search}`;
                  navigate(
                    `/admin/products/${product.id}?returnTo=${encodeURIComponent(returnTo)}`,
                    {
                      state: { returnTo },
                    },
                  );
                }
              : undefined
          }
        />
      )}

      {mode === "barcode" && (
        <>
          <BarcodeScannerModal
            open={scannerOpen}
            onOpenChange={setScannerOpen}
            onDetected={startLookup}
            onManualEntry={openManualEntry}
          />

          <AppModal
            title="Ввести код вручную"
            description="Введите значение со штрихкода или артикул товара."
            open={manualOpen}
            onOpenChange={setManualOpen}
            contentClassName="barcode-order-modal"
          >
            <form className="barcode-order-manual" onSubmit={submitManualCode}>
              <AppInput
                label="Штрихкод или артикул"
                value={manualCode}
                maxLength={128}
                autoFocus
                autoComplete="off"
                inputMode="text"
                error={manualError ?? undefined}
                onChange={(event) => {
                  setManualCode(event.target.value);
                  setManualError(null);
                }}
              />
              <div className="barcode-order-modal__actions">
                <AppButton type="button" variant="ghost" onClick={() => setManualOpen(false)}>
                  Отмена
                </AppButton>
                <AppButton type="submit">
                  <Search size={17} />
                  Найти товар
                </AppButton>
              </div>
            </form>
          </AppModal>

          <AppModal
            title="Подтверждение товара"
            description={detectedCode ? `Распознанный код: ${detectedCode}` : undefined}
            open={productModalOpen}
            onOpenChange={(open) => {
              setProductModalOpen(open);
              if (!open) setDetectedProduct(null);
            }}
            contentClassName="barcode-order-product-modal"
          >
            {productLookup.isPending && <AppSkeleton />}

            {productLookup.isError && (
              <AppAlert
                title="Товар не найден"
                tone="danger"
                onRetry={() => productLookup.mutate(detectedCode)}
              >
                {getErrorMessage(productLookup.error)}
              </AppAlert>
            )}

            {detectedProduct && (
              <div className="barcode-order-confirmation">
                <div className="barcode-order-confirmation__product">
                  <div className="barcode-order-confirmation__image">
                    {getImageUrl(detectedProduct.mainImageUrl) ? (
                      <img
                        src={getImageUrl(detectedProduct.mainImageUrl)!}
                        alt={detectedProduct.name}
                      />
                    ) : (
                      <ImageOff size={32} aria-hidden="true" />
                    )}
                  </div>
                  <div>
                    <span>Артикул: {detectedProduct.sku}</span>
                    <strong>{detectedProduct.name}</strong>
                    <OrderProductAvailability
                      madeToOrder={detectedProduct.madeToOrder}
                      balance={stockByProductId.get(detectedProduct.id)}
                      showStock={canReadWarehouse}
                      stockLoading={warehouseBalancesQuery.isLoading}
                    />
                    <b>{formatMoney(getTierPrice(detectedProduct, priceTier))}</b>
                  </div>
                </div>

                {getTierPrice(detectedProduct, priceTier) === null && (
                  <AppAlert title="Цена не указана" tone="danger">
                    Для типа «{PRICE_TIER_ITEMS.find((item) => item.value === priceTier)?.label}» у
                    товара нет цены. Выберите другой тип продажи перед добавлением.
                  </AppAlert>
                )}

                <div className="barcode-order-confirmation__tier">
                  <strong>Тип продажи</strong>
                  <AppSelect
                    fieldClassName="barcode-order-confirmation__tier-select"
                    options={PRICE_TIER_ITEMS}
                    value={priceTier}
                    ariaLabel="Тип цены добавляемого товара"
                    onValueChange={(value) => changePriceTier(value as BarcodeOrderPriceTier)}
                    clearable={false}
                  />
                </div>

                <OrderQuantityInput
                  label="Количество"
                  value={detectedQuantity}
                  onValueChange={setDetectedQuantity}
                />
              </div>
            )}

            <div className="barcode-order-modal__actions">
              <AppButton
                type="button"
                variant="secondary"
                disabled={productLookup.isPending}
                onClick={repeatScan}
              >
                <Barcode size={17} />
                Повторить
              </AppButton>
              {productLookup.isError && (
                <AppButton
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setProductModalOpen(false);
                    openManualEntry();
                  }}
                >
                  Ввести вручную
                </AppButton>
              )}
              <AppButton
                type="button"
                disabled={
                  !detectedProduct ||
                  productLookup.isPending ||
                  (detectedProduct ? getTierPrice(detectedProduct, priceTier) === null : true)
                }
                onClick={confirmDetectedProduct}
              >
                <PackagePlus size={17} />
                Подтвердить
              </AppButton>
            </div>
          </AppModal>
        </>
      )}

      <AppModal
        title="Недостаточно товара на складе"
        description="Проверьте позиции с расхождением перед созданием заказа."
        open={stockShortageOpen}
        onOpenChange={(open) => {
          setStockShortageOpen(open);
          if (!open && !createOrder.isPending) setPendingStockShortageSubmission(null);
        }}
        contentClassName="barcode-order-shortage-modal"
      >
        <div className="barcode-order-shortage-list" role="list">
          {stockShortages.map(({ line, available, shortage }) => (
            <div className="barcode-order-shortage" role="listitem" key={line.id}>
              <div className="barcode-order-shortage__product">
                <strong>{line.name}</strong>
                <span>Артикул: {line.sku}</span>
              </div>
              <dl>
                <div>
                  <dt>Нужно</dt>
                  <dd>{formatQuantity(line.quantity)}</dd>
                </div>
                <div>
                  <dt>Доступно</dt>
                  <dd>{formatQuantity(available)}</dd>
                </div>
                <div className="barcode-order-shortage__missing">
                  <dt>Не хватает</dt>
                  <dd>{formatQuantity(shortage)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        {!canReleaseWithStockShortage && (
          <AppAlert title="Недостаточно прав" tone="danger">
            Для создания такого заказа требуется право «Отпуск с расхождением по остаткам».
          </AppAlert>
        )}

        <div className="barcode-order-modal__actions">
          <AppButton
            type="button"
            variant="ghost"
            disabled={createOrder.isPending}
            onClick={() => {
              setStockShortageOpen(false);
              setPendingStockShortageSubmission(null);
              setCustomerModalOpen(true);
            }}
          >
            Назад
          </AppButton>
          {canReleaseWithStockShortage && (
            <AppButton
              type="button"
              variant="danger"
              loading={createOrder.isPending}
              loadingText="Создаём заказ..."
              disabled={!pendingStockShortageSubmission || stockShortages.length === 0}
              onClick={() => {
                if (!pendingStockShortageSubmission) return;
                setSubmittingAction(pendingStockShortageSubmission.action);
                createOrder.mutate({
                  ...pendingStockShortageSubmission,
                  allowStockShortage: true,
                });
              }}
            >
              Создать заказ с расхождением
            </AppButton>
          )}
        </div>
      </AppModal>

      <AppModal
        title="Привязать заказ к клиенту"
        description={
          customerBindingMode === "regular-buyer"
            ? "Выберите покупателя из справочника. Заказ будет привязан к нему без аккаунта пользователя."
            : "Выберите пользователя для его личного кабинета или переключитесь на постоянного покупателя."
        }
        open={customerModalOpen}
        onOpenChange={(open) => {
          if (!orderSubmissionPending) setCustomerModalOpen(open);
        }}
        contentClassName="barcode-order-customer-modal"
      >
        <SegmentedControl
          ariaLabel="К кому привязать заказ"
          className="barcode-order-customer-modal__binding-mode"
          value={customerBindingMode}
          items={[
            { value: "user", label: "Пользователь", disabled: orderSubmissionPending },
            {
              value: "regular-buyer",
              label: "Постоянный покупатель",
              disabled: orderSubmissionPending,
            },
          ]}
          onValueChange={setCustomerBindingMode}
        />

        <AppSearchInput
          label={isRegularBuyerBinding ? "Поиск постоянного покупателя" : "Поиск клиента"}
          value={isRegularBuyerBinding ? regularBuyerSearch : customerSearch}
          placeholder={
            isRegularBuyerBinding
              ? "Наименование, контакт, email или телефон"
              : "Имя, email или телефон"
          }
          disabled={orderSubmissionPending}
          onChange={(event) => {
            if (isRegularBuyerBinding) setRegularBuyerSearch(event.target.value);
            else setCustomerSearch(event.target.value);
          }}
        />

        <div className="barcode-order-customers" aria-busy={bindingQuery.isLoading}>
          {bindingQuery.isLoading && <AppSkeleton />}
          {bindingQuery.isError && (
            <AppAlert
              title={
                isRegularBuyerBinding
                  ? "Не удалось загрузить покупателей"
                  : "Не удалось загрузить клиентов"
              }
              tone="danger"
              onRetry={() => void bindingQuery.refetch()}
            >
              {getErrorMessage(bindingQuery.error)}
            </AppAlert>
          )}
          {!bindingQuery.isLoading &&
            !bindingQuery.isError &&
            bindingCandidates.length === 0 &&
            !futureBinding && (
              <div className="barcode-order-customers__empty">
                <UserRound size={28} />
                <strong>
                  {isRegularBuyerBinding
                    ? "Постоянные покупатели не найдены"
                    : "Клиенты не найдены"}
                </strong>
                <span>Измените поисковый запрос или пропустите этот этап.</span>
              </div>
            )}
          {futureBinding && (
            <button
              type="button"
              className={`barcode-order-customer barcode-order-customer--pending${selectedPendingBinding ? " is-selected" : ""}`}
              aria-pressed={Boolean(selectedPendingBinding)}
              disabled={orderSubmissionPending}
              onClick={() => {
                setSelectedCustomerId(null);
                setSelectedPendingBinding(futureBinding);
              }}
            >
              <span className="barcode-order-customer__icon">
                {selectedPendingBinding ? <Check size={18} /> : <UserRound size={18} />}
              </span>
              <span>
                <strong>Привязать после регистрации</strong>
                <small>Заказ будет привязан к аккаунту с контактом: {futureBinding.label}</small>
              </span>
            </button>
          )}
          {bindingCandidates.map((candidate) => {
            const selected =
              candidate.id === (isRegularBuyerBinding ? regularBuyerId : selectedCustomerId);
            return (
              <button
                key={candidate.id}
                type="button"
                className={`barcode-order-customer ${selected ? "is-selected" : ""}`}
                aria-pressed={selected}
                disabled={orderSubmissionPending}
                onClick={() => {
                  if (typeof candidate.id === "string") setRegularBuyerId(candidate.id);
                  else {
                    setSelectedPendingBinding(null);
                    setSelectedCustomerId(candidate.id);
                  }
                }}
              >
                <span className="barcode-order-customer__icon">
                  {selected ? <Check size={18} /> : <UserRound size={18} />}
                </span>
                <span>
                  <strong>{candidate.name}</strong>
                  {candidate.details && <small>{candidate.details}</small>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="barcode-order-modal__actions barcode-order-customer-modal__actions">
          {!isRegularBuyerBinding && (
            <AppButton
              type="button"
              variant="secondary"
              disabled={!activeUser || orderSubmissionPending}
              loading={orderSubmissionPending && submittingAction === "self"}
              loadingText={checkingStock ? "Проверяем склад..." : "Оформляем отпуск..."}
              onClick={() => activeUser && void submitOrder(activeUser.id, null, "self")}
            >
              <UserRound size={17} />
              На себя
            </AppButton>
          )}
          <AppButton
            type="button"
            variant="ghost"
            disabled={orderSubmissionPending}
            loading={orderSubmissionPending && submittingAction === "skip"}
            loadingText={checkingStock ? "Проверяем склад..." : "Создаём заказ..."}
            onClick={() => void submitOrder(null, null, "skip")}
          >
            Пропустить
          </AppButton>
          <AppButton
            type="button"
            disabled={
              (customerBindingMode === "regular-buyer"
                ? !selectedRegularBuyer
                : !selectedCustomerId && !selectedPendingBinding) || orderSubmissionPending
            }
            loading={orderSubmissionPending && submittingAction === "selected"}
            loadingText={checkingStock ? "Проверяем склад..." : "Создаём заказ..."}
            onClick={() => {
              if (customerBindingMode === "regular-buyer") void submitOrder(null);
              else void submitOrder(selectedCustomerId, selectedPendingBinding);
            }}
          >
            <Check size={17} />
            {customerBindingMode === "regular-buyer"
              ? "Привязать к покупателю"
              : selectedCustomer
                ? `Привязать к ${selectedCustomer.name}`
                : selectedPendingBinding
                  ? "Создать ожидающую привязку"
                  : "Выбрать клиента"}
          </AppButton>
        </div>
      </AppModal>
    </AdminPage>
  );
}
