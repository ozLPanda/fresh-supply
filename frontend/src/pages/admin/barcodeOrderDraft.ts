import type { BarcodeOrderPriceTier, BarcodeOrderProduct } from "@/shared/api/barcodeOrders";
import { normalizeOrderQuantity } from "@/features/orders/OrderQuantityInput";

export type OrderCreateMode = "barcode" | "selection";
export type PriceAdjustmentOperation = "PERCENT" | "ADD";
export type PriceAdjustmentHistoryEntry = {
  operation: PriceAdjustmentOperation;
  value: number;
};
export type PendingCustomerBinding = {
  email: string | null;
  phone: string | null;
  label: string;
};
export type BarcodeOrderLine = BarcodeOrderProduct & {
  quantity: number;
  unitPrice: number | null;
};

export type BarcodeOrderDraft = {
  /** Missing in drafts written before save timestamps were introduced. */
  savedAt?: string;
  lines: BarcodeOrderLine[];
  priceTier: BarcodeOrderPriceTier;
  orderDate: string;
  selectedPriceLineIds: number[];
  priceAdjustmentOperation: PriceAdjustmentOperation;
  priceAdjustmentValue: string;
  priceAdjustmentOriginalPrices: Record<number, number>;
  priceAdjustmentHistoryByLine: Record<number, PriceAdjustmentHistoryEntry[]>;
  comment: string;
  selectedCustomerId: number | null;
  regularBuyerId: string | null;
  selectedPendingBinding: PendingCustomerBinding | null;
};

type StoredBarcodeOrderDraft = BarcodeOrderDraft & {
  version: 1;
  mode: OrderCreateMode;
};

const DRAFT_PREFIX = "company_shop_admin_order_draft";
const PRICE_TIERS = new Set<BarcodeOrderPriceTier>([
  "RETAIL",
  "WHOLESALE",
  "BULK_WHOLESALE",
  "SKO",
]);
const PRICE_ADJUSTMENT_OPERATIONS = new Set<PriceAdjustmentOperation>(["PERCENT", "ADD"]);

function storageKey(userId: number, mode: OrderCreateMode) {
  return `${DRAFT_PREFIX}_v1_${userId}_${mode}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return finiteNumber(value) ?? undefined;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseLine(value: unknown): BarcodeOrderLine | null {
  if (!isRecord(value)) return null;
  const id = finiteNumber(value.id);
  const sku = nonEmptyString(value.sku);
  const name = nonEmptyString(value.name);
  const retailPrice = finiteNumber(value.retailPrice);
  const wholesalePrice = nullableFiniteNumber(value.wholesalePrice);
  const bulkWholesalePrice = nullableFiniteNumber(value.bulkWholesalePrice);
  const skoPrice = nullableFiniteNumber(value.skoPrice);
  const quantity = finiteNumber(value.quantity);
  const unitPrice = nullableFiniteNumber(value.unitPrice);

  if (
    !id ||
    !sku ||
    !name ||
    retailPrice === null ||
    wholesalePrice === undefined ||
    bulkWholesalePrice === undefined ||
    skoPrice === undefined ||
    !quantity ||
    unitPrice === undefined ||
    typeof value.madeToOrder !== "boolean" ||
    (value.mainImageUrl !== null && typeof value.mainImageUrl !== "string")
  ) {
    return null;
  }

  return {
    id,
    sku,
    name,
    mainImageUrl: value.mainImageUrl,
    madeToOrder: value.madeToOrder,
    measurementUnit: value.measurementUnit === "KG" ? "KG" : "PIECE",
    retailPrice,
    wholesalePrice,
    bulkWholesalePrice,
    skoPrice,
    quantity: normalizeOrderQuantity(quantity),
    unitPrice: unitPrice === null ? null : Math.max(0, unitPrice),
  };
}

function parseNumberRecord(value: unknown, lineIds: Set<number>) {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<number, number>>((result, [key, candidate]) => {
    const id = Number(key);
    const price = finiteNumber(candidate);
    if (Number.isInteger(id) && lineIds.has(id) && price !== null) result[id] = price;
    return result;
  }, {});
}

function parseAdjustmentHistory(value: unknown, lineIds: Set<number>) {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<Record<number, PriceAdjustmentHistoryEntry[]>>(
    (result, [key, candidate]) => {
      const id = Number(key);
      if (!Number.isInteger(id) || !lineIds.has(id) || !Array.isArray(candidate)) return result;
      const history = candidate.flatMap((item) => {
        if (
          !isRecord(item) ||
          !PRICE_ADJUSTMENT_OPERATIONS.has(item.operation as PriceAdjustmentOperation)
        ) {
          return [];
        }
        const adjustment = finiteNumber(item.value);
        return adjustment === null
          ? []
          : [{ operation: item.operation as PriceAdjustmentOperation, value: adjustment }];
      });
      if (history.length) result[id] = history;
      return result;
    },
    {},
  );
}

function parsePendingBinding(value: unknown): PendingCustomerBinding | null {
  if (!isRecord(value) || typeof value.label !== "string") return null;
  const email = value.email;
  const phone = value.phone;
  if (
    (email !== null && typeof email !== "string") ||
    (phone !== null && typeof phone !== "string")
  ) {
    return null;
  }
  return { email, phone, label: value.label };
}

function parseDraft(value: unknown, mode: OrderCreateMode): BarcodeOrderDraft | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.mode !== mode ||
    !Array.isArray(value.lines)
  ) {
    return null;
  }
  if (!PRICE_TIERS.has(value.priceTier as BarcodeOrderPriceTier)) return null;
  if (
    !PRICE_ADJUSTMENT_OPERATIONS.has(value.priceAdjustmentOperation as PriceAdjustmentOperation)
  ) {
    return null;
  }
  if (typeof value.orderDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.orderDate)) {
    return null;
  }
  if (typeof value.comment !== "string" || typeof value.priceAdjustmentValue !== "string") {
    return null;
  }

  const lines = value.lines.flatMap((line) => {
    const parsedLine = parseLine(line);
    return parsedLine ? [parsedLine] : [];
  });
  const lineIds = new Set(lines.map((line) => line.id));
  const selectedCustomerId = value.selectedCustomerId;

  return {
    lines,
    savedAt:
      typeof value.savedAt === "string" && Number.isFinite(Date.parse(value.savedAt))
        ? value.savedAt
        : undefined,
    priceTier: value.priceTier as BarcodeOrderPriceTier,
    orderDate: value.orderDate,
    selectedPriceLineIds: Array.isArray(value.selectedPriceLineIds)
      ? [
          ...new Set(
            value.selectedPriceLineIds.filter((id) => Number.isInteger(id) && lineIds.has(id)),
          ),
        ]
      : [],
    priceAdjustmentOperation: value.priceAdjustmentOperation as PriceAdjustmentOperation,
    priceAdjustmentValue: value.priceAdjustmentValue.slice(0, 128),
    priceAdjustmentOriginalPrices: parseNumberRecord(value.priceAdjustmentOriginalPrices, lineIds),
    priceAdjustmentHistoryByLine: parseAdjustmentHistory(
      value.priceAdjustmentHistoryByLine,
      lineIds,
    ),
    comment: value.comment.slice(0, 1_000),
    selectedCustomerId:
      typeof selectedCustomerId === "number" &&
      Number.isInteger(selectedCustomerId) &&
      selectedCustomerId > 0
        ? selectedCustomerId
        : null,
    regularBuyerId:
      typeof value.regularBuyerId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.regularBuyerId)
        ? value.regularBuyerId
        : null,
    selectedPendingBinding: parsePendingBinding(value.selectedPendingBinding),
  };
}

export function readBarcodeOrderDraft(userId: number, mode: OrderCreateMode) {
  try {
    return parseDraft(JSON.parse(localStorage.getItem(storageKey(userId, mode)) ?? "null"), mode);
  } catch {
    return null;
  }
}

export function writeBarcodeOrderDraft(
  userId: number,
  mode: OrderCreateMode,
  draft: BarcodeOrderDraft,
) {
  const storedDraft: StoredBarcodeOrderDraft = {
    ...draft,
    savedAt: new Date().toISOString(),
    version: 1,
    mode,
  };
  try {
    localStorage.setItem(storageKey(userId, mode), JSON.stringify(storedDraft));
  } catch {
    // Local persistence is an additional safeguard and must never block order creation.
  }
}

export function clearBarcodeOrderDraft(userId: number, mode: OrderCreateMode) {
  try {
    localStorage.removeItem(storageKey(userId, mode));
  } catch {
    // Local storage may be unavailable in private or restricted browser sessions.
  }
}
