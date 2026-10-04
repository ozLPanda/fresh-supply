import { api, API_URL } from "@/shared/api/http";
import type { ApiResponse } from "@/shared/types/models";

export type WarehouseDocumentType =
  | "OPENING_BALANCE"
  | "RECEIPT"
  | "PURCHASE_ORDER"
  | "PRICE_SETTING"
  | "CUSTOMER_RETURN"
  | "INVENTORY"
  | "SALE";

export type WarehouseDocumentStatus = "DRAFT" | "POSTED" | "CANCELLED";
export type WarehousePriceType =
  | "RETAIL"
  | "WHOLESALE"
  | "BULK_WHOLESALE"
  | "SKO"
  | "GSKO"
  | "INCOMING";

export type WarehousePriceSettingSourceType = "CLEAN_INCOMING" | "PRICE_TYPE" | "GROUP_DOCUMENT";

export type WarehousePriceSettingOperation = "COPY" | "PERCENT" | "AMOUNT" | "MANUAL";

export type WarehouseBalance = {
  productId: number;
  sku: string;
  productName: string;
  onHand: number;
  reserved: number;
  available: number;
  inventoryCost?: number | null;
};

export type WarehouseBalancesStockFilter =
  | "ALL"
  | "ZERO"
  | "BELOW_ZERO"
  | "IN_STOCK"
  | "BELOW_10"
  | "BELOW_100";

export type WarehouseBalancesPdfMode = "STANDARD" | "INVENTORY";

export type WarehouseReservationOrder = {
  reservationId: string;
  orderId: string;
  orderCode: string;
  orderStatus: string;
  quantity: number;
  reservedAt: string;
};

export type WarehouseProductReservations = {
  productId: number;
  sku: string;
  productName: string;
  orders: WarehouseReservationOrder[];
};

export type WarehouseProductMovement = {
  id: string;
  documentId: string;
  documentNumber?: string | null;
  documentType: WarehouseDocumentType;
  documentStatus: WarehouseDocumentStatus;
  sourceOrderId?: string | null;
  reference?: string | null;
  movementType: string;
  quantity: number;
  balanceAfter: number;
  occurredAt: string;
};

export type WarehouseProductMovements = {
  productId: number;
  sku: string;
  productName: string;
  movements: WarehouseProductMovement[];
};

export type WarehouseRecalculationPreview = {
  warehouseId: number;
  productId: number;
  issues: string[];
  movements: Array<{
    documentId: string;
    movementId: string;
    beforeQuantity: number;
    afterQuantity: number;
    beforeUnitCost: number | null;
    afterUnitCost: number | null;
  }>;
  layers: Array<{
    movementId: string | null;
    layerId: string | null;
    beforeRemaining: number;
    afterRemaining: number;
    unitCost: number | null;
  }>;
  beforeBalance: number;
  afterBalance: number;
  beforeStockValue: number;
  afterStockValue: number;
  beforeStockValueComplete: boolean;
  afterStockValueComplete: boolean;
};

export type WarehouseCleanIncomingPriceHistoryPoint = {
  occurredAt: string;
  unitCost: number | null;
  documentId: string;
  documentNumber?: string | null;
};

export type WarehouseStockShortageRelease = {
  orderItemId: number;
  productId?: number | null;
  sku: string;
  productName: string;
  shortageQuantity: number;
  orderId: string;
  orderCode: string;
  orderStatus: string;
  releasedByUserId?: number | null;
  releasedByUserName?: string | null;
  releasedAt?: string | null;
  comment?: string | null;
};

export type WarehouseProductLookup = {
  id: number;
  sku: string;
  nameRu: string;
  active: boolean;
};

export type WarehouseCounterparty = {
  id: string;
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  comment?: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WarehouseCounterpartyInput = {
  name: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  comment?: string | null;
  archived?: boolean;
};

export type WarehouseDocumentLine = {
  id?: number;
  productId: number;
  sku: string;
  productName: string;
  quantity: number;
  unitCost?: number | null;
  suggestedUnitCost?: number | null;
  sourceOrderItemId?: number | null;
  sourceDocumentId?: string | null;
  unitPrice?: number | null;
  comment?: string | null;
  sourcePrice?: number | null;
  sourceDescription?: string | null;
  priceOperation?: WarehousePriceSettingOperation | null;
  priceOperationValue?: number | null;
  manualPrice?: boolean;
  productGroupName?: string | null;
};

export type WarehouseDocument = {
  purchaseAllocations?: PurchaseAllocation[];
  purchaseOrderId?: string | null;
  id: string;
  documentNumber?: string | null;
  type: WarehouseDocumentType;
  status: WarehouseDocumentStatus;
  priceType?: WarehousePriceType | null;
  priceSettingGroupId?: string | null;
  priceSettingGroupName?: string | null;
  priceSettingCommonRules?: string | null;
  priceSettingGroupComment?: string | null;
  priceSourceType?: WarehousePriceSettingSourceType | null;
  priceSourcePriceType?: WarehousePriceType | null;
  priceSourceDocumentId?: string | null;
  priceOperation?: WarehousePriceSettingOperation | null;
  priceOperationValue?: number | null;
  warehouseId: number;
  sourceOrderId?: string | null;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  reference?: string | null;
  comment?: string | null;
  priceRuleComment?: string | null;
  effectiveDate?: string | null;
  effectiveTime?: string | null;
  createdByUserId?: number | null;
  createdAt: string;
  postedAt?: string | null;
  cancelledAt?: string | null;
  deletedAt?: string | null;
  lines?: WarehouseDocumentLine[];
};

export type WarehouseDocumentSummary = Pick<
  WarehouseDocument,
  | "id"
  | "documentNumber"
  | "type"
  | "status"
  | "priceType"
  | "reference"
  | "counterpartyId"
  | "counterpartyName"
  | "effectiveDate"
  | "effectiveTime"
  | "createdAt"
  | "postedAt"
  | "priceSettingGroupId"
  | "priceSettingGroupName"
  | "priceSourceType"
  | "priceSourcePriceType"
  | "priceSourceDocumentId"
  | "priceOperation"
  | "priceOperationValue"
>;

export type WarehouseDocumentVersionSnapshot = {
  type: WarehouseDocumentType;
  status: WarehouseDocumentStatus;
  priceType?: WarehousePriceType | null;
  priceSettingGroupId?: string | null;
  priceSettingGroupName?: string | null;
  priceSettingCommonRules?: string | null;
  priceSettingGroupComment?: string | null;
  priceSourceType?: WarehousePriceSettingSourceType | null;
  priceSourcePriceType?: WarehousePriceType | null;
  priceSourceDocumentId?: string | null;
  priceOperation?: WarehousePriceSettingOperation | null;
  priceOperationValue?: number | null;
  warehouseId: number;
  counterpartyId?: string | null;
  counterpartyName?: string | null;
  reference?: string | null;
  comment?: string | null;
  priceRuleComment?: string | null;
  effectiveDate?: string | null;
  effectiveTime?: string | null;
  lines: WarehouseDocumentLine[];
};

export type WarehouseDocumentVersion = {
  id: number;
  versionNumber: number;
  action: "CREATE" | "UPDATE" | "POST" | "CANCEL" | "DELETE" | string;
  changeSummary: string;
  changedByUserId?: number | null;
  changedByUserName?: string | null;
  createdAt: string;
  snapshot: WarehouseDocumentVersionSnapshot;
};

export type WarehouseDocumentInput = {
  purchaseAllocations?: PurchaseAllocation[];
  type: Exclude<WarehouseDocumentType, "SALE">;
  priceType?: WarehousePriceType | null;
  priceSettingGroupId?: string | null;
  priceSourceType?: WarehousePriceSettingSourceType | null;
  priceSourcePriceType?: WarehousePriceType | null;
  priceSourceDocumentId?: string | null;
  priceOperation?: WarehousePriceSettingOperation | null;
  priceOperationValue?: number | null;
  warehouseId?: number | null;
  sourceOrderId?: string | null;
  counterpartyId?: string | null;
  purchaseOrderId?: string | null;
  reference?: string | null;
  comment?: string | null;
  priceRuleComment?: string | null;
  effectiveDate?: string | null;
  effectiveTime?: string | null;
  lines: Array<{
    productId: number;
    quantity: number;
    unitCost?: number | null;
    suggestedUnitCost?: number | null;
    sourceOrderItemId?: number | null;
    sourceDocumentId?: string | null;
    unitPrice?: number | null;
    comment?: string | null;
    manualPrice?: boolean;
    productGroupName?: string | null;
  }>;
};

export type WarehousePriceSettingGroup = {
  id: string;
  name: string;
  commonRules?: string | null;
  comment?: string | null;
  createdByUserId?: number | null;
  createdAt: string;
  updatedAt: string;
  documents: WarehouseDocumentSummary[];
};

export type WarehousePriceSettingGroupInput = {
  name: string;
  commonRules?: string | null;
  comment?: string | null;
};

export type WarehousePriceSettingPreviewLine = {
  productId: number;
  unitPrice: number;
  sourcePrice?: number | null;
  sourceDescription?: string | null;
  priceOperation?: WarehousePriceSettingOperation | null;
  priceOperationValue?: number | null;
};

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const value = query.toString();
  return value ? `?${value}` : "";
}

export function fetchWarehouseBalances() {
  return api<WarehouseBalance[]>("/api/admin/warehouse/balances");
}

export async function downloadWarehouseBalancesPdf({
  mode,
  search,
  stockFilter,
}: {
  mode: WarehouseBalancesPdfMode;
  search?: string;
  stockFilter?: WarehouseBalancesStockFilter;
}): Promise<Blob> {
  const query = queryString({ mode, search, stockFilter });
  const response = await fetch(`${API_URL}/api/admin/warehouse/balances/export.pdf${query}`, {
    credentials: "include",
  });

  if (!response.ok) {
    let message = "Не удалось сформировать PDF-таблицу остатков";
    try {
      const error = (await response.json()) as ApiResponse<unknown>;
      if (error.message) message = error.message;
    } catch {
      // An intermediary can respond with HTML instead of the API error envelope.
    }
    throw new Error(message);
  }

  return response.blob();
}

export function fetchWarehouseStockShortages() {
  return api<WarehouseStockShortageRelease[]>("/api/admin/warehouse/stock-shortages");
}

export function fetchWarehouseProductReservations(productId: number) {
  return api<WarehouseProductReservations>(
    `/api/admin/warehouse/balances/${productId}/reservations`,
  );
}

export function fetchWarehouseProductMovements(productId: number) {
  return api<WarehouseProductMovements>(`/api/admin/warehouse/balances/${productId}/movements`);
}

export function fetchWarehouseRecalculationPreview(productId: number) {
  return api<WarehouseRecalculationPreview>(
    `/api/admin/warehouse/balances/${productId}/recalculation-preview`,
  );
}

export function fetchWarehouseDocuments() {
  return api<WarehouseDocumentSummary[]>("/api/admin/warehouse/documents");
}

export function fetchWarehouseCounterparties(includeArchived = false) {
  return api<WarehouseCounterparty[]>(
    `/api/admin/warehouse/counterparties${includeArchived ? "?includeArchived=true" : ""}`,
  );
}

export function createWarehouseCounterparty(input: WarehouseCounterpartyInput) {
  return api<WarehouseCounterparty>("/api/admin/warehouse/counterparties", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWarehouseCounterparty(id: string, input: WarehouseCounterpartyInput) {
  return api<WarehouseCounterparty>(`/api/admin/warehouse/counterparties/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function fetchWarehousePriceSettingGroups() {
  return api<WarehousePriceSettingGroup[]>("/api/admin/warehouse/price-setting-groups");
}

export function createWarehousePriceSettingGroup(input: WarehousePriceSettingGroupInput) {
  return api<WarehousePriceSettingGroup>("/api/admin/warehouse/price-setting-groups", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWarehousePriceSettingGroup(
  groupId: string,
  input: WarehousePriceSettingGroupInput,
) {
  return api<WarehousePriceSettingGroup>(`/api/admin/warehouse/price-setting-groups/${groupId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function postWarehousePriceSettingGroupDocuments(groupId: string) {
  return api<number>(`/api/admin/warehouse/price-setting-groups/${groupId}/post`, {
    method: "POST",
  });
}

export function cancelWarehousePriceSettingGroupDocuments(groupId: string) {
  return api<number>(`/api/admin/warehouse/price-setting-groups/${groupId}/cancel`, {
    method: "POST",
  });
}

export function deleteWarehousePriceSettingGroupDocuments(groupId: string) {
  return api<number>(`/api/admin/warehouse/price-setting-groups/${groupId}/documents`, {
    method: "DELETE",
  });
}

export async function downloadWarehousePriceSettingGroupPdf(groupId: string): Promise<Blob> {
  const response = await fetch(
    `${API_URL}/api/admin/warehouse/price-setting-groups/${groupId}/export.pdf`,
    { credentials: "include" },
  );

  if (!response.ok) {
    let message = "Не удалось сформировать PDF-таблицу";
    try {
      const error = (await response.json()) as ApiResponse<unknown>;
      if (error.message) message = error.message;
    } catch {
      // An intermediary can respond with HTML instead of the API error envelope.
    }
    throw new Error(message);
  }

  return response.blob();
}

export function previewWarehousePriceSetting(input: WarehouseDocumentInput) {
  return api<WarehousePriceSettingPreviewLine[]>("/api/admin/warehouse/price-setting-preview", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchWarehouseDocument(documentId: string) {
  return api<WarehouseDocument>(`/api/admin/warehouse/documents/${documentId}`);
}

export async function downloadWarehouseDocumentPdf(documentId: string): Promise<Blob> {
  const response = await fetch(
    `${API_URL}/api/admin/warehouse/documents/${encodeURIComponent(documentId)}/export.pdf`,
    { credentials: "include" },
  );

  if (!response.ok) {
    let message = "Не удалось выгрузить PDF документа";
    try {
      const error = (await response.json()) as ApiResponse<unknown>;
      if (error.message) message = error.message;
    } catch {
      // An intermediary can respond with HTML instead of the API error envelope.
    }
    throw new Error(message);
  }

  return response.blob();
}

export function fetchWarehouseCleanIncomingPriceHistory(productId: number) {
  return api<WarehouseCleanIncomingPriceHistoryPoint[]>(
    `/api/admin/warehouse/products/${productId}/clean-incoming-price-history`,
  );
}

export type PurchaseOrderProgressLine = {
  transferred: number;
  available: number;
  productId: number;
  sku: string;
  productName: string;
  ordered: number;
  received: number;
  remaining: number;
};

export type PurchaseAllocation = { sourceDocumentId: string; productId: number; quantity: number };
export type PurchaseOrderRemainder = {
  document: WarehouseDocumentSummary;
  lines: Array<{
    productId: number;
    sku: string;
    productName: string;
    quantity: number;
    unitCost: number | null;
  }>;
};

export function fetchPurchaseOrderRemainders(excludeDocumentId?: string) {
  return api<PurchaseOrderRemainder[]>(
    `/api/admin/warehouse/purchase-order-remainders${
      excludeDocumentId ? `?excludeDocumentId=${encodeURIComponent(excludeDocumentId)}` : ""
    }`,
  );
}

export function fetchPurchaseOrderProgress(id: string) {
  return api<{
    hasReceipts: boolean;
    receipts: WarehouseDocumentSummary[];
    lines: PurchaseOrderProgressLine[];
  }>(`/api/admin/warehouse/documents/${id}/purchase-order-progress`);
}

export function createReceiptFromPurchaseOrder(id: string) {
  return api<WarehouseDocument>(`/api/admin/warehouse/documents/${id}/receipt`, { method: "POST" });
}

export function createPurchaseOrderFromRemaining(id: string, counterpartyId: string) {
  return api<WarehouseDocument>(`/api/admin/warehouse/documents/${id}/order-from-remaining`, {
    method: "POST",
    body: JSON.stringify({ counterpartyId }),
  });
}

export function fetchWarehouseDocumentHistory(documentId: string) {
  return api<WarehouseDocumentVersion[]>(`/api/admin/warehouse/documents/${documentId}/history`);
}

export function createWarehouseDocument(input: WarehouseDocumentInput) {
  return api<WarehouseDocument>("/api/admin/warehouse/documents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWarehouseDocument(documentId: string, input: WarehouseDocumentInput) {
  return api<WarehouseDocument>(`/api/admin/warehouse/documents/${documentId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function saveAndPostWarehouseDocument(documentId: string, input: WarehouseDocumentInput) {
  return api<WarehouseDocument>(`/api/admin/warehouse/documents/${documentId}/save-and-post`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function postWarehouseDocument(documentId: string) {
  return api<WarehouseDocument>(`/api/admin/warehouse/documents/${documentId}/post`, {
    method: "POST",
  });
}

export function cancelWarehouseDocument(documentId: string) {
  return api<WarehouseDocument>(`/api/admin/warehouse/documents/${documentId}/cancel`, {
    method: "POST",
  });
}

export function deleteWarehouseDocument(documentId: string) {
  return api<void>(`/api/admin/warehouse/documents/${documentId}`, { method: "DELETE" });
}

export function fetchWarehouseProductLookup(search: string) {
  return api<WarehouseProductLookup[]>(
    `/api/admin/warehouse/products${queryString({ search: search.trim() })}`,
  );
}
