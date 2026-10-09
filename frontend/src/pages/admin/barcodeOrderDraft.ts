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

export type AssistantDraftReview = {
  sessionId: string;
  revision: number;
  unresolved: Array<{
    source: string;
    name: string;
    quantity: number | null;
    unit: string | null;
    reason: string;
  }>;
  questions: string[];
  reviewed: boolean;
};

export type BarcodeOrderDraft = {
  assistantImport?: AssistantDraftReview;
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

export type OrderDraftEntry = {
  id: string;
  title: string;
  assistantSessionId?: string;
  data: BarcodeOrderDraft;
};

export type OrderDraftWorkspace = {
  version: 2;
  activeId: string | null;
  drafts: OrderDraftEntry[];
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

function storageKey(userId: number, mode: OrderCreateMode, assistantSessionId?: string) {
  return `${DRAFT_PREFIX}_v1_${userId}_${mode}${assistantSessionId ? `_assistant_${assistantSessionId}` : ""}`;
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

function parseAssistantImport(value: unknown): AssistantDraftReview | undefined {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Array.isArray(value.unresolved) ||
    !Array.isArray(value.questions)
  )
    return undefined;
  const unresolved = value.unresolved.flatMap((item) =>
    isRecord(item) &&
    typeof item.source === "string" &&
    typeof item.name === "string" &&
    typeof item.reason === "string"
      ? [
          {
            source: item.source,
            name: item.name,
            quantity: finiteNumber(item.quantity),
            unit: typeof item.unit === "string" ? item.unit : null,
            reason: item.reason,
          },
        ]
      : [],
  );
  return {
    sessionId: value.sessionId,
    revision: Number(value.revision),
    unresolved,
    questions: value.questions.filter(
      (question): question is string => typeof question === "string",
    ),
    reviewed: value.reviewed === true,
  };
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
    assistantImport: parseAssistantImport(value.assistantImport),
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
    comment: value.comment.slice(0, 2_000),
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

export function readBarcodeOrderDraft(
  userId: number,
  mode: OrderCreateMode,
  assistantSessionId?: string,
) {
  try {
    return parseDraft(
      JSON.parse(localStorage.getItem(storageKey(userId, mode, assistantSessionId)) ?? "null"),
      mode,
    );
  } catch {
    return null;
  }
}

export function writeBarcodeOrderDraft(
  userId: number,
  mode: OrderCreateMode,
  draft: BarcodeOrderDraft,
  assistantSessionId?: string,
) {
  const storedDraft: StoredBarcodeOrderDraft = {
    ...draft,
    savedAt: new Date().toISOString(),
    version: 1,
    mode,
  };
  try {
    localStorage.setItem(storageKey(userId, mode, assistantSessionId), JSON.stringify(storedDraft));
  } catch {
    // Local persistence is an additional safeguard and must never block order creation.
  }
}

export function clearBarcodeOrderDraft(
  userId: number,
  mode: OrderCreateMode,
  assistantSessionId?: string,
) {
  try {
    localStorage.removeItem(storageKey(userId, mode, assistantSessionId));
  } catch {
    // Local storage may be unavailable in private or restricted browser sessions.
  }
}

function workspaceKey(userId: number, mode: OrderCreateMode) {
  return `${DRAFT_PREFIX}_v2_${userId}_${mode}`;
}

function emptyWorkspace(): OrderDraftWorkspace {
  return { version: 2, activeId: null, drafts: [] };
}

function parseEntry(value: unknown, mode: OrderCreateMode): OrderDraftEntry | null {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.title) ||
    (value.assistantSessionId !== undefined && !nonEmptyString(value.assistantSessionId)) ||
    !isRecord(value.data)
  ) {
    return null;
  }
  const data = parseDraft({ ...value.data, version: 1, mode }, mode);
  return data
    ? {
        id: value.id as string,
        title: value.title as string,
        ...(value.assistantSessionId
          ? { assistantSessionId: value.assistantSessionId as string }
          : {}),
        data,
      }
    : null;
}

function parseWorkspace(value: unknown, mode: OrderCreateMode): OrderDraftWorkspace {
  if (!isRecord(value) || value.version !== 2 || !Array.isArray(value.drafts)) {
    return emptyWorkspace();
  }
  const seen = new Set<string>();
  const drafts = value.drafts.flatMap((candidate) => {
    const entry = parseEntry(candidate, mode);
    if (!entry || seen.has(entry.id)) return [];
    seen.add(entry.id);
    return [entry];
  });
  return {
    version: 2,
    drafts,
    activeId:
      typeof value.activeId === "string" && seen.has(value.activeId)
        ? value.activeId
        : (drafts[0]?.id ?? null),
  };
}

function parseStoredJson(serialized: string | null): unknown {
  try {
    return JSON.parse(serialized ?? "null");
  } catch {
    return null;
  }
}

/** Read fresh storage before each mutation so another draft's changes are retained. */
function loadWorkspace(userId: number, mode: OrderCreateMode) {
  const stored = parseStoredJson(localStorage.getItem(workspaceKey(userId, mode)));
  const workspace = parseWorkspace(stored, mode);
  const legacyBase = storageKey(userId, mode);
  const legacyAssistantPrefix = `${legacyBase}_assistant_`;
  const importedLegacyKeys =
    isRecord(stored) && stored.version === 2 && Array.isArray(stored.importedLegacyKeys)
      ? stored.importedLegacyKeys.filter(
          (key): key is string =>
            typeof key === "string" &&
            (key === legacyBase || key.startsWith(legacyAssistantPrefix)),
        )
      : [];
  const legacyKeys: string[] = [];
  // Snapshot keys before cleanup; removing items changes localStorage indices.
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key === legacyBase || key?.startsWith(legacyAssistantPrefix)) legacyKeys.push(key);
  }
  legacyKeys.sort((a, b) => (a === legacyBase ? -1 : b === legacyBase ? 1 : a.localeCompare(b)));
  const migratedKeys: string[] = [];
  for (const key of legacyKeys) {
    if (importedLegacyKeys.includes(key)) {
      migratedKeys.push(key);
      continue;
    }
    const data = parseDraft(parseStoredJson(localStorage.getItem(key)), mode);
    if (!data) continue;
    const assistantSessionId =
      key === legacyBase ? undefined : key.slice(legacyAssistantPrefix.length);
    if (assistantSessionId === "") continue;
    const id = assistantSessionId ? `legacy-assistant-${assistantSessionId}` : "legacy-default";
    if (!workspace.drafts.some((draft) => draft.id === id)) {
      workspace.drafts.push({
        id,
        title: assistantSessionId ? "Заказ из ассистента" : "Заказ",
        ...(assistantSessionId ? { assistantSessionId } : {}),
        data,
      });
    }
    migratedKeys.push(key);
  }
  workspace.activeId ??= workspace.drafts[0]?.id ?? null;
  return { workspace, migratedKeys, importedLegacyKeys };
}

function persistWorkspace(
  userId: number,
  mode: OrderCreateMode,
  workspace: OrderDraftWorkspace,
  migratedKeys: string[],
  importedLegacyKeys: string[],
) {
  localStorage.setItem(
    workspaceKey(userId, mode),
    JSON.stringify({
      ...workspace,
      importedLegacyKeys: [...new Set([...importedLegacyKeys, ...migratedKeys])],
    }),
  );
  // Migration is committed before removing its sources. Failed cleanup is safe to retry.
  for (const key of migratedKeys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // The v2 copy exists; deterministic IDs prevent duplicate imports next time.
    }
  }
}

export function readOrderDraftWorkspace(
  userId: number,
  mode: OrderCreateMode,
): OrderDraftWorkspace {
  try {
    const { workspace, migratedKeys, importedLegacyKeys } = loadWorkspace(userId, mode);
    if (migratedKeys.length) {
      try {
        persistWorkspace(userId, mode, workspace, migratedKeys, importedLegacyKeys);
      } catch {
        // Return recoverable legacy data without deleting it when storage is full.
      }
    }
    return workspace;
  } catch {
    return emptyWorkspace();
  }
}

export function writeOrderDraftEntry(
  userId: number,
  mode: OrderCreateMode,
  entry: OrderDraftEntry,
): boolean {
  try {
    const parsed = parseEntry(entry, mode);
    if (!parsed) return false;
    parsed.data.savedAt = new Date().toISOString();
    const { workspace, migratedKeys, importedLegacyKeys } = loadWorkspace(userId, mode);
    const index = workspace.drafts.findIndex((draft) => draft.id === parsed.id);
    if (index === -1) workspace.drafts.push(parsed);
    else workspace.drafts[index] = parsed;
    workspace.activeId ??= parsed.id;
    persistWorkspace(userId, mode, workspace, migratedKeys, importedLegacyKeys);
    return true;
  } catch {
    return false;
  }
}

export function removeOrderDraftEntry(userId: number, mode: OrderCreateMode, id: string): boolean {
  try {
    const { workspace, migratedKeys, importedLegacyKeys } = loadWorkspace(userId, mode);
    const index = workspace.drafts.findIndex((draft) => draft.id === id);
    // Removal is idempotent: an unsaved entry or another tab may already have removed it.
    if (index !== -1) workspace.drafts.splice(index, 1);
    if (workspace.activeId === id) {
      workspace.activeId =
        workspace.drafts[Math.min(index, workspace.drafts.length - 1)]?.id ?? null;
    }
    persistWorkspace(userId, mode, workspace, migratedKeys, importedLegacyKeys);
    return true;
  } catch {
    return false;
  }
}

export function activateOrderDraftEntry(
  userId: number,
  mode: OrderCreateMode,
  id: string,
): boolean {
  try {
    const { workspace, migratedKeys, importedLegacyKeys } = loadWorkspace(userId, mode);
    if (!workspace.drafts.some((draft) => draft.id === id)) return false;
    workspace.activeId = id;
    persistWorkspace(userId, mode, workspace, migratedKeys, importedLegacyKeys);
    return true;
  } catch {
    return false;
  }
}
