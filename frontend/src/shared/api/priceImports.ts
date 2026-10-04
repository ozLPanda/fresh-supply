import { API_URL, api } from "@/shared/api/http";
import type { ApiResponse } from "@/shared/types/models";

export type PriceImportRowStatus =
  | "CHANGED"
  | "UNCHANGED"
  | "TO_CREATE"
  | "PRICE_SETTING"
  | "NOT_FOUND"
  | "INVALID"
  | "DUPLICATE";

export type PriceImportSummary = {
  totalRows: number;
  changed: number;
  unchanged: number;
  toCreate: number;
  priceSetting: number;
  notFound: number;
  invalid: number;
  duplicate: number;
};

export type PriceImportRow = {
  id: string;
  rowNumber: number;
  sourceSheet: string | null;
  status: PriceImportRowStatus;
  sku: string | null;
  productId: number | null;
  productName: string | null;
  oldProductName: string | null;
  newProductName: string | null;
  oldPrice: number | null;
  newPrice: number | null;
  oldWholesalePrice: number | null;
  newWholesalePrice: number | null;
  oldBulkWholesalePrice: number | null;
  newBulkWholesalePrice: number | null;
  oldSkoPrice: number | null;
  newSkoPrice: number | null;
  oldIncomingPrice: number | null;
  newIncomingPrice: number | null;
  missingRetailPrice: boolean;
  excludedByName: boolean;
  madeToOrder: boolean;
  pricesLockedByPriceSetting: boolean;
  oldActive: boolean | null;
  oldMadeToOrder: boolean | null;
  newActive: boolean | null;
  newMadeToOrder: boolean | null;
  errors: string[];
};

export type PriceImportSourceFile = {
  fileName: string;
  priceType: "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO" | "INCOMING";
  totalRows: number;
};

export type PriceImportAnalysis = {
  id: string;
  fileName: string;
  status: string;
  summary: PriceImportSummary;
  rows: PriceImportRow[];
  message: string | null;
  createMissingProducts: boolean;
  sourceFiles: PriceImportSourceFile[];
};

export type PriceImportCommitResult = {
  id: string;
  status: string;
  updatedProducts: number | null;
  createdProducts: number | null;
  skippedRows: number | null;
  message: string | null;
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function count(...values: unknown[]) {
  for (const value of values) {
    const parsed = number(value);
    if (parsed !== null) return Math.max(0, Math.trunc(parsed));
  }
  return 0;
}

function status(value: unknown): PriceImportRowStatus {
  const normalized = text(value)?.toUpperCase();
  if (
    normalized === "CHANGED" ||
    normalized === "UNCHANGED" ||
    normalized === "TO_CREATE" ||
    normalized === "PRICE_SETTING" ||
    normalized === "NOT_FOUND" ||
    normalized === "INVALID" ||
    normalized === "DUPLICATE"
  ) {
    return normalized;
  }
  return "INVALID";
}

function errors(value: unknown, fallback?: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(text).filter((item): item is string => Boolean(item));
  }
  const single = text(value) ?? text(fallback);
  return single ? [single] : [];
}

function normalizeRow(value: unknown, index: number): PriceImportRow {
  const row = record(value);
  const rowNumber = count(row.rowNumber, row.lineNumber, row.sourceRow, index + 2);
  const rowStatus = status(row.status);
  const sku = text(row.sku);

  return {
    id:
      text(row.id) ?? `${text(row.sourceSheet) ?? "sheet"}:${rowNumber}:${sku ?? "none"}:${index}`,
    rowNumber,
    sourceSheet: text(row.sourceSheet),
    status: rowStatus,
    sku,
    productId: number(row.productId),
    productName: text(row.productName) ?? text(row.nameRu) ?? text(row.name),
    oldProductName: text(row.oldProductName) ?? text(row.productName) ?? text(row.nameRu),
    newProductName: text(row.newProductName) ?? text(row.productName) ?? text(row.name),
    oldPrice: number(row.oldPrice ?? row.currentPrice),
    newPrice: number(row.newPrice ?? row.price),
    oldWholesalePrice: number(row.oldWholesalePrice ?? row.currentWholesalePrice),
    newWholesalePrice: number(row.newWholesalePrice ?? row.wholesalePrice),
    oldBulkWholesalePrice: number(row.oldBulkWholesalePrice ?? row.currentBulkWholesalePrice),
    newBulkWholesalePrice: number(row.newBulkWholesalePrice ?? row.bulkWholesalePrice),
    oldSkoPrice: number(row.oldSkoPrice ?? row.currentSkoPrice),
    newSkoPrice: number(row.newSkoPrice ?? row.skoPrice),
    oldIncomingPrice: number(row.oldIncomingPrice ?? row.currentIncomingPrice),
    newIncomingPrice: number(row.newIncomingPrice ?? row.incomingPrice),
    missingRetailPrice: row.missingRetailPrice === true,
    excludedByName: row.excludedByName === true,
    madeToOrder: row.madeToOrder === true,
    pricesLockedByPriceSetting: row.pricesLockedByPriceSetting === true,
    oldActive: typeof row.oldActive === "boolean" ? row.oldActive : null,
    oldMadeToOrder: typeof row.oldMadeToOrder === "boolean" ? row.oldMadeToOrder : null,
    newActive: typeof row.newActive === "boolean" ? row.newActive : null,
    newMadeToOrder: typeof row.newMadeToOrder === "boolean" ? row.newMadeToOrder : null,
    errors: errors(row.errors, row.error ?? row.errorMessage),
  };
}

function rowsFrom(value: UnknownRecord): PriceImportRow[] {
  const candidate = value.rows ?? value.items ?? record(value.preview).rows;
  return Array.isArray(candidate) ? candidate.map(normalizeRow) : [];
}

function sourceFilesFrom(value: UnknownRecord): PriceImportSourceFile[] {
  const files = value.sourceFiles ?? value.files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((value) => {
    const file = record(value);
    const fileName = text(file.fileName);
    const priceType = text(file.priceType)?.toUpperCase();
    if (
      !fileName ||
      (priceType !== "RETAIL" &&
        priceType !== "WHOLESALE" &&
        priceType !== "BULK_WHOLESALE" &&
        priceType !== "SKO" &&
        priceType !== "INCOMING")
    ) {
      return [];
    }
    return [{ fileName, priceType, totalRows: count(file.totalRows, file.rows) }];
  });
}

export function normalizePriceImportAnalysis(value: unknown): PriceImportAnalysis {
  const source = record(value);
  const summarySource = record(source.summary ?? source.stats);
  const rows = rowsFrom(source);
  const calculated = rows.reduce<PriceImportSummary>(
    (result, row) => {
      result.totalRows += 1;
      if (row.status === "CHANGED") result.changed += 1;
      if (row.status === "UNCHANGED") result.unchanged += 1;
      if (row.status === "TO_CREATE") result.toCreate += 1;
      if (row.status === "PRICE_SETTING") result.priceSetting += 1;
      if (row.status === "NOT_FOUND") result.notFound += 1;
      if (row.status === "INVALID") result.invalid += 1;
      if (row.status === "DUPLICATE") result.duplicate += 1;
      return result;
    },
    {
      totalRows: 0,
      changed: 0,
      unchanged: 0,
      toCreate: 0,
      priceSetting: 0,
      notFound: 0,
      invalid: 0,
      duplicate: 0,
    },
  );

  return {
    id: text(source.id) ?? text(source.importId) ?? text(source.jobId) ?? "",
    fileName: text(source.fileName) ?? text(source.originalFileName) ?? "Прайс-лист",
    status: text(source.status)?.toUpperCase() ?? "ANALYZED",
    summary: {
      totalRows: count(summarySource.totalRows, source.totalRows, calculated.totalRows),
      changed: count(
        summarySource.changed,
        summarySource.changedRows,
        source.changedRows,
        calculated.changed,
      ),
      unchanged: count(
        summarySource.unchanged,
        summarySource.unchangedRows,
        source.unchangedRows,
        calculated.unchanged,
      ),
      toCreate: count(
        summarySource.toCreate,
        summarySource.toCreateRows,
        source.toCreateRows,
        calculated.toCreate,
      ),
      priceSetting: count(
        summarySource.priceSetting,
        summarySource.priceSettingRows,
        source.priceSettingRows,
        calculated.priceSetting,
      ),
      notFound: count(
        summarySource.notFound,
        summarySource.notFoundRows,
        source.notFoundRows,
        calculated.notFound,
      ),
      invalid: count(
        summarySource.invalid,
        summarySource.invalidRows,
        source.invalidRows,
        calculated.invalid,
      ),
      duplicate: count(
        summarySource.duplicate,
        summarySource.duplicateRows,
        source.duplicateRows,
        calculated.duplicate,
      ),
    },
    rows,
    message: text(source.message),
    createMissingProducts: Boolean(source.createMissingProducts),
    sourceFiles: sourceFilesFrom(source),
  };
}

export type AnalyzePriceImportOptions = {
  createMissingProducts?: boolean;
  updateAvailabilityAndMadeToOrder?: boolean;
  oneCPriceTier?: "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO" | "INCOMING";
  onUploadProgress?: (progress: PriceImportUploadProgress) => void;
  onProcessing?: () => void;
};

export type PriceImportUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

function uploadPriceImport<T>(
  path: string,
  body: FormData,
  options: AnalyzePriceImportOptions,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}${path}`);
    request.withCredentials = true;

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      options.onUploadProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.min(100, (event.loaded / event.total) * 100),
      });
    });
    request.upload.addEventListener("load", () => options.onProcessing?.());

    request.addEventListener("load", () => {
      let response: ApiResponse<T> | null = null;
      try {
        response = JSON.parse(request.responseText) as ApiResponse<T>;
      } catch {
        reject(new Error("Ошибка API"));
        return;
      }

      if (request.status < 200 || request.status >= 300 || !response.success) {
        reject(new Error(response.message || "Ошибка API"));
        return;
      }
      resolve(response.data);
    });
    request.addEventListener("error", () => reject(new Error("Не удалось загрузить файл")));
    request.addEventListener("abort", () => reject(new Error("Загрузка файла отменена")));
    request.send(body);
  });
}

export async function analyzePriceImport(file: File, options: AnalyzePriceImportOptions = {}) {
  const body = new FormData();
  body.append("file", file);
  body.append("createMissingProducts", String(options.createMissingProducts ?? false));
  body.append(
    "updateAvailabilityAndMadeToOrder",
    String(options.updateAvailabilityAndMadeToOrder ?? true),
  );
  if (options.oneCPriceTier) body.append("oneCPriceTier", options.oneCPriceTier);
  const result = await uploadPriceImport<unknown>(
    "/api/admin/product-price-imports/analyze",
    body,
    options,
  );
  return normalizePriceImportAnalysis(result);
}

export async function analyzePriceImportBatch(
  files: File[],
  options: Omit<AnalyzePriceImportOptions, "oneCPriceTier"> = {},
) {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  body.append("createMissingProducts", String(options.createMissingProducts ?? true));
  body.append(
    "updateAvailabilityAndMadeToOrder",
    String(options.updateAvailabilityAndMadeToOrder ?? true),
  );
  const result = await uploadPriceImport<unknown>(
    "/api/admin/product-price-imports/analyze-batch",
    body,
    options,
  );
  return normalizePriceImportAnalysis(result);
}

export async function fetchPriceImport(id: string) {
  const result = await api<unknown>(`/api/admin/product-price-imports/${encodeURIComponent(id)}`);
  return normalizePriceImportAnalysis(result);
}

export async function commitPriceImport(
  id: string,
  selectedRowIndexes?: number[],
): Promise<PriceImportCommitResult> {
  const result = record(
    await api<unknown>(`/api/admin/product-price-imports/${encodeURIComponent(id)}/commit`, {
      method: "POST",
      ...(selectedRowIndexes ? { body: JSON.stringify({ selectedRowIndexes }) } : {}),
    }),
  );

  return {
    id: text(result.id) ?? text(result.importId) ?? text(result.jobId) ?? id,
    status: text(result.status)?.toUpperCase() ?? "COMPLETED",
    updatedProducts: number(
      result.updatedProducts ?? result.updated ?? result.changed ?? result.changedRows,
    ),
    createdProducts: number(
      result.createdProducts ?? result.created ?? result.createdCount ?? result.newProducts,
    ),
    skippedRows: number(result.skippedRows ?? result.skipped ?? result.errorRows),
    message: text(result.message),
  };
}
