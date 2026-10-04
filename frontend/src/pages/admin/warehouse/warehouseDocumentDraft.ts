import type {
  PurchaseAllocation,
  WarehouseDocumentLine,
  WarehouseDocumentType,
  WarehousePriceSettingOperation,
  WarehousePriceSettingSourceType,
  WarehousePriceType,
} from "@/shared/api/warehouse";

export type WarehouseDocumentLocalDraft = {
  type: Exclude<WarehouseDocumentType, "SALE">;
  reference: string;
  counterpartyId: string;
  receiptBasisMode: "ORDER" | "TEXT";
  receiptPurchaseOrderId: string;
  purchaseAllocations: PurchaseAllocation[];
  comment: string;
  priceRuleComment: string;
  priceType: WarehousePriceType;
  priceSettingGroupId: string;
  priceSourceType: WarehousePriceSettingSourceType | "";
  priceSourcePriceType: WarehousePriceType;
  priceOperation: WarehousePriceSettingOperation;
  priceOperationValue: string;
  effectiveAt: string;
  effectiveAtModified: boolean;
  lines: Array<
    WarehouseDocumentLine & {
      localId: string;
      originalUnitPrice?: number | null;
      receiptAmount?: number | null;
      receiptAmountDriven?: boolean;
    }
  >;
  selectedPriceLineIds: string[];
  priceAdjustmentStepsByLineId: Record<
    string,
    Array<{ operation: "PERCENT" | "AMOUNT"; value: number }>
  >;
};

const PREFIX = "company_shop_warehouse_unsaved_document_v1";
const PRICE_TYPES = new Set<WarehousePriceType>([
  "RETAIL",
  "WHOLESALE",
  "BULK_WHOLESALE",
  "SKO",
  "GSKO",
  "INCOMING",
]);
const SOURCE_TYPES = new Set<WarehousePriceSettingSourceType | "">([
  "",
  "CLEAN_INCOMING",
  "PRICE_TYPE",
  "GROUP_DOCUMENT",
]);
const OPERATIONS = new Set<WarehousePriceSettingOperation>(["COPY", "PERCENT", "AMOUNT", "MANUAL"]);

export function warehouseDocumentDraftKey(
  userId: number | undefined,
  type: WarehouseDocumentLocalDraft["type"],
  sourceOrderId?: string | null,
  initialPriceSettingGroupId?: string | null,
) {
  if (!userId) return null;
  return [PREFIX, userId, type, sourceOrderId ?? "", initialPriceSettingGroupId ?? ""].join(":");
}

export function readWarehouseDocumentDraft(key: string, type: WarehouseDocumentLocalDraft["type"]) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return null;
    const draft = value as WarehouseDocumentLocalDraft & { version?: number };
    if (
      draft.version !== 1 ||
      draft.type !== type ||
      typeof draft.reference !== "string" ||
      typeof draft.counterpartyId !== "string" ||
      (draft.receiptBasisMode !== "ORDER" && draft.receiptBasisMode !== "TEXT") ||
      typeof draft.receiptPurchaseOrderId !== "string" ||
      typeof draft.comment !== "string" ||
      typeof draft.priceRuleComment !== "string" ||
      typeof draft.priceSettingGroupId !== "string" ||
      !PRICE_TYPES.has(draft.priceType) ||
      !SOURCE_TYPES.has(draft.priceSourceType) ||
      !PRICE_TYPES.has(draft.priceSourcePriceType) ||
      !OPERATIONS.has(draft.priceOperation) ||
      typeof draft.priceOperationValue !== "string" ||
      typeof draft.effectiveAt !== "string" ||
      typeof draft.effectiveAtModified !== "boolean" ||
      !Number.isFinite(new Date(draft.effectiveAt).getTime()) ||
      !Array.isArray(draft.lines) ||
      !draft.lines.every(
        (line) =>
          typeof line.localId === "string" &&
          typeof line.productId === "number" &&
          Number.isFinite(line.productId) &&
          typeof line.quantity === "number" &&
          Number.isFinite(line.quantity) &&
          typeof line.sku === "string" &&
          typeof line.productName === "string",
      ) ||
      !Array.isArray(draft.purchaseAllocations) ||
      !draft.purchaseAllocations.every(
        (allocation) =>
          typeof allocation.sourceDocumentId === "string" &&
          typeof allocation.productId === "number" &&
          Number.isFinite(allocation.productId) &&
          typeof allocation.quantity === "number" &&
          Number.isFinite(allocation.quantity),
      ) ||
      !Array.isArray(draft.selectedPriceLineIds) ||
      !draft.selectedPriceLineIds.every((id) => typeof id === "string") ||
      !draft.priceAdjustmentStepsByLineId ||
      typeof draft.priceAdjustmentStepsByLineId !== "object" ||
      !Object.values(draft.priceAdjustmentStepsByLineId).every(
        (steps) =>
          Array.isArray(steps) &&
          steps.every(
            (step) =>
              (step.operation === "PERCENT" || step.operation === "AMOUNT") &&
              typeof step.value === "number" &&
              Number.isFinite(step.value),
          ),
      )
    ) {
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function writeWarehouseDocumentDraft(key: string, draft: WarehouseDocumentLocalDraft) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...draft, version: 1 }));
  } catch {
    // The form remains usable if browser storage is unavailable or full.
  }
}

export function clearWarehouseDocumentDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Browser storage may be unavailable in private sessions.
  }
}
