import type { Order } from "@/shared/types/models";

export type OrderPriceTier = "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO";
export type PriceAdjustmentOperation = "PERCENT" | "ADD";
export type PriceChangeSource =
  | { type: "TIER"; tier: OrderPriceTier }
  | { type: "PERCENT" | "ADD"; value: number }
  | { type: "MANUAL" };

export type OrderPriceReviewDraft = {
  version: 1;
  savedAt: string;
  orderSignature: string;
  priceValues: Record<number, number | null>;
  baselineValues: Record<number, number>;
  selectedTier: OrderPriceTier | null;
  tierValues: Record<number, number>;
  selectedItemIds: number[];
  adjustmentOperation: PriceAdjustmentOperation;
  adjustmentValue: string;
  changeSources: Record<number, PriceChangeSource>;
  documentId: string;
};

// Also retain a tab-local copy when browser storage is unavailable.
const tabDrafts = new Map<string, OrderPriceReviewDraft>();
const priceTiers = new Set<string>(["RETAIL", "WHOLESALE", "BULK_WHOLESALE", "SKO"]);

function isPriceTier(value: unknown): value is OrderPriceTier {
  return typeof value === "string" && priceTiers.has(value);
}

function storageKey(userId: number, orderId: string) {
  return `company_shop_order_price_review_v1_${userId}_${orderId}`;
}

export function orderPriceReviewSignature(order: Order) {
  return JSON.stringify([
    order.priceTier ?? "RETAIL",
    order.items.map((item) => [item.id, item.unitPrice, item.quantity]).sort((a, b) => a[0] - b[0]),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isItemId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePrices(value: unknown, nullable: true): Record<number, number | null>;
function parsePrices(value: unknown, nullable?: false): Record<number, number>;
function parsePrices(value: unknown, nullable = false) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, price]) =>
        /^\d+$/.test(key) &&
        isItemId(Number(key)) &&
        (isPrice(price) || (nullable && price === null)),
    ),
  );
}

function parseSources(value: unknown): Record<number, PriceChangeSource> {
  const sources: Record<number, PriceChangeSource> = {};
  if (!isRecord(value)) return sources;
  for (const [key, source] of Object.entries(value)) {
    const itemId = Number(key);
    if (!/^\d+$/.test(key) || !isItemId(itemId) || !isRecord(source)) continue;
    if (source.type === "MANUAL") {
      sources[itemId] = { type: "MANUAL" };
    } else if (source.type === "TIER" && isPriceTier(source.tier)) {
      sources[itemId] = { type: "TIER", tier: source.tier };
    } else if (
      (source.type === "PERCENT" || source.type === "ADD") &&
      typeof source.value === "number" &&
      Number.isFinite(source.value)
    ) {
      sources[itemId] = { type: source.type, value: source.value };
    }
  }
  return sources;
}

function parseDraft(value: unknown): OrderPriceReviewDraft | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.savedAt !== "string" ||
    !Number.isFinite(Date.parse(value.savedAt)) ||
    typeof value.orderSignature !== "string" ||
    !isRecord(value.priceValues) ||
    !isRecord(value.baselineValues) ||
    !isRecord(value.tierValues) ||
    !isRecord(value.changeSources) ||
    !Array.isArray(value.selectedItemIds) ||
    (value.selectedTier !== null &&
      (typeof value.selectedTier !== "string" || !priceTiers.has(value.selectedTier))) ||
    (value.adjustmentOperation !== "PERCENT" && value.adjustmentOperation !== "ADD") ||
    typeof value.adjustmentValue !== "string" ||
    typeof value.documentId !== "string"
  )
    return null;
  return {
    version: 1,
    savedAt: value.savedAt,
    orderSignature: value.orderSignature,
    priceValues: parsePrices(value.priceValues, true),
    baselineValues: parsePrices(value.baselineValues),
    selectedTier: value.selectedTier as OrderPriceTier | null,
    tierValues: parsePrices(value.tierValues),
    selectedItemIds: [...new Set(value.selectedItemIds.filter(isItemId))],
    adjustmentOperation: value.adjustmentOperation,
    adjustmentValue: value.adjustmentValue.slice(0, 128),
    changeSources: parseSources(value.changeSources),
    documentId: value.documentId.slice(0, 128),
  };
}

export function readOrderPriceReviewDraft(userId: number, orderId: string) {
  const key = storageKey(userId, orderId);
  try {
    return tabDrafts.get(key) ?? parseDraft(JSON.parse(sessionStorage.getItem(key) ?? "null"));
  } catch {
    return tabDrafts.get(key) ?? null;
  }
}

export function writeOrderPriceReviewDraft(
  userId: number,
  orderId: string,
  draft: OrderPriceReviewDraft,
) {
  const key = storageKey(userId, orderId);
  tabDrafts.set(key, draft);
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearOrderPriceReviewDraft(userId: number, orderId: string) {
  const key = storageKey(userId, orderId);
  tabDrafts.delete(key);
  try {
    sessionStorage.removeItem(key);
  } catch {
    // The in-memory draft is still cleared when session storage is restricted.
  }
}
