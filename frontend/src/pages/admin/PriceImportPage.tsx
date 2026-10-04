import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RowSelectionState } from "@tanstack/react-table";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CheckCheck,
  Files,
  FileSpreadsheet,
  PackagePlus,
  RefreshCw,
  Rows3,
  SearchX,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import {
  analyzePriceImport,
  analyzePriceImportBatch,
  commitPriceImport,
  fetchPriceImport,
  type PriceImportCommitResult,
  type PriceImportRow,
  type PriceImportRowStatus,
  type PriceImportSourceFile,
} from "@/shared/api/priceImports";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCheckbox, AppFileUpload, AppRadioGroup, AppSwitch } from "@/shared/ui/AppControls";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { MetricCard } from "@/shared/ui/MetricCard";
import "./PriceImportPage.css";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const EXCEL_FILE_NAME = /\.(xlsx|xlsm)$/i;

const moneyFormat = new Intl.NumberFormat("ru-KZ", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const statusMeta: Record<
  PriceImportRowStatus,
  { label: string; tone: "green" | "slate" | "orange" | "red" | "blue" }
> = {
  CHANGED: { label: "Изменение", tone: "orange" },
  UNCHANGED: { label: "Без изменений", tone: "slate" },
  TO_CREATE: { label: "Будет создан", tone: "green" },
  PRICE_SETTING: { label: "Цена задана документом", tone: "blue" },
  NOT_FOUND: { label: "Артикул не найден", tone: "blue" },
  INVALID: { label: "Ошибка", tone: "red" },
  DUPLICATE: { label: "Дубликат", tone: "red" },
};

function formatMoney(value: number | null) {
  return value === null ? "—" : `${moneyFormat.format(value)} ₸`;
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} КБ`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".0", "")} МБ`;
}

const priceTypeMeta: Record<PriceImportSourceFile["priceType"], string> = {
  RETAIL: "Розничная",
  WHOLESALE: "Оптовая",
  BULK_WHOLESALE: "Крупнооптовая",
  SKO: "СКО",
  INCOMING: "Приходная",
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить операцию";
}

function PriceDiff({
  oldValue,
  newValue,
  cleared = false,
}: {
  oldValue: number | null;
  newValue: number | null;
  cleared?: boolean;
}) {
  if ((!cleared && newValue === null) || oldValue === newValue)
    return <span className="price-import-diff is-same">{formatMoney(oldValue)}</span>;

  return (
    <span className="price-import-diff">
      <span>{formatMoney(oldValue)}</span>
      <b aria-hidden="true">→</b>
      <strong>{cleared ? "Цена очищена" : formatMoney(newValue)}</strong>
    </span>
  );
}

function ProductNameDiff({
  oldValue,
  newValue,
}: {
  oldValue: string | null;
  newValue: string | null;
}) {
  if (!newValue || oldValue === newValue)
    return <strong>{oldValue ?? newValue ?? "Не сопоставлен"}</strong>;

  return (
    <span className="price-import-name-diff">
      {oldValue && <span>{oldValue}</span>}
      <strong>{newValue}</strong>
    </span>
  );
}

function willHideProduct(row: PriceImportRow) {
  return row.status === "CHANGED" && (row.missingRetailPrice || row.excludedByName);
}

function isImportableRow(row: PriceImportRow) {
  return row.status === "CHANGED" || row.status === "TO_CREATE" || row.status === "PRICE_SETTING";
}

function availabilityLabel(active: boolean, madeToOrder: boolean) {
  if (!active) return "Скрыт";
  return madeToOrder ? "Под заказ" : "В наличии";
}

function availabilityTone(active: boolean, madeToOrder: boolean): "green" | "orange" | "slate" {
  if (!active) return "slate";
  return madeToOrder ? "orange" : "green";
}

function ProductAvailabilityDiff({ row }: { row: PriceImportRow }) {
  if (row.oldActive === null || row.oldMadeToOrder === null) return <span>Новый товар</span>;
  const newActive = row.newActive ?? row.oldActive;
  const newMadeToOrder = row.newMadeToOrder ?? row.oldMadeToOrder;
  const oldLabel = availabilityLabel(row.oldActive, row.oldMadeToOrder);
  const newLabel = availabilityLabel(newActive, newMadeToOrder);

  if (oldLabel === newLabel) {
    return <AppBadge tone={availabilityTone(newActive, newMadeToOrder)}>{newLabel}</AppBadge>;
  }

  return (
    <span className="price-import-availability-diff">
      <AppBadge tone={availabilityTone(row.oldActive, row.oldMadeToOrder)}>{oldLabel}</AppBadge>
      <b aria-hidden="true">→</b>
      <AppBadge tone={availabilityTone(newActive, newMadeToOrder)}>{newLabel}</AppBadge>
    </span>
  );
}

function rowErrors(row: PriceImportRow) {
  if (row.pricesLockedByPriceSetting || row.status === "PRICE_SETTING") {
    return "Цена задана документом установки цен: значение из файла не будет применено";
  }
  if (row.errors.length > 0) return row.errors.join("; ");
  if (row.missingRetailPrice && row.excludedByName) {
    return "Розничная цена не указана, есть служебная подпись: товар будет скрыт";
  }
  if (row.missingRetailPrice && willHideProduct(row)) {
    return "Розничная цена не указана: товар будет скрыт";
  }
  if (row.excludedByName && willHideProduct(row)) {
    return "Есть служебная подпись: товар будет скрыт";
  }
  if (row.madeToOrder && row.status === "CHANGED") {
    return "Есть пометка «нет в наличии»: товар будет доступен под заказ";
  }
  if (row.missingRetailPrice) return "Розничная цена не указана: новая карточка не будет создана";
  if (row.status === "NOT_FOUND") return "Товар с таким артикулом не найден";
  if (row.status === "DUPLICATE") return "Артикул повторяется в прайс-листе";
  if (row.status === "INVALID") return "Проверьте значения цен в исходной строке";
  return "—";
}

const columns: AppDataTableColumn<PriceImportRow>[] = [
  {
    id: "rowNumber",
    header: "Строка",
    accessor: "rowNumber",
    sortable: true,
    width: 82,
    cell: (row) => <code>{row.rowNumber}</code>,
  },
  {
    id: "status",
    header: "Статус",
    accessor: "status",
    sortable: true,
    filterable: true,
    filterOptions: Object.entries(statusMeta).map(([value, item]) => ({
      value,
      label: item.label,
    })),
    width: 148,
    cell: (row) => {
      const meta = statusMeta[row.status];
      return <AppBadge tone={meta.tone}>{meta.label}</AppBadge>;
    },
  },
  {
    id: "missingRetailPrice",
    header: "Скрытие",
    value: (row) => (willHideProduct(row) ? "will-hide" : ""),
    searchable: false,
    filterable: true,
    filterOptions: [{ value: "will-hide", label: "Будут скрыты" }],
    initialHidden: true,
  },
  {
    id: "sku",
    header: "Артикул",
    value: (row) => row.sku ?? "",
    sortable: true,
    width: 128,
    cell: (row) => <code>{row.sku ?? "—"}</code>,
  },
  {
    id: "productName",
    header: "Товар",
    value: (row) => `${row.oldProductName ?? ""} ${row.newProductName ?? row.productName ?? ""}`,
    sortable: true,
    cell: (row) => <ProductNameDiff oldValue={row.oldProductName} newValue={row.newProductName} />,
  },
  {
    id: "availability",
    header: "Витрина",
    value: (row) =>
      row.oldActive === null || row.oldMadeToOrder === null
        ? "new"
        : `${availabilityLabel(row.oldActive, row.oldMadeToOrder)}:${availabilityLabel(
            row.newActive ?? row.oldActive,
            row.newMadeToOrder ?? row.oldMadeToOrder,
          )}`,
    sortable: true,
    filterable: true,
    filterOptions: [
      { value: "Скрыт:В наличии", label: "Будут показаны" },
      { value: "В наличии:Скрыт", label: "Будут скрыты" },
      { value: "Под заказ:В наличии", label: "Снимется «Под заказ»" },
      { value: "В наличии:Под заказ", label: "Станут «Под заказ»" },
    ],
    width: 218,
    cell: (row) => <ProductAvailabilityDiff row={row} />,
  },
  {
    id: "price",
    header: "Розничная",
    value: (row) => `${row.oldPrice ?? ""} ${row.newPrice ?? ""}`,
    align: "right",
    cell: (row) => (
      <PriceDiff oldValue={row.oldPrice} newValue={row.newPrice} cleared={row.missingRetailPrice} />
    ),
  },
  {
    id: "wholesalePrice",
    header: "Оптовая",
    value: (row) => `${row.oldWholesalePrice ?? ""} ${row.newWholesalePrice ?? ""}`,
    align: "right",
    cell: (row) => <PriceDiff oldValue={row.oldWholesalePrice} newValue={row.newWholesalePrice} />,
  },
  {
    id: "bulkWholesalePrice",
    header: "Крупный опт",
    value: (row) => `${row.oldBulkWholesalePrice ?? ""} ${row.newBulkWholesalePrice ?? ""}`,
    align: "right",
    cell: (row) => (
      <PriceDiff oldValue={row.oldBulkWholesalePrice} newValue={row.newBulkWholesalePrice} />
    ),
  },
  {
    id: "skoPrice",
    header: "СКО",
    value: (row) => `${row.oldSkoPrice ?? ""} ${row.newSkoPrice ?? ""}`,
    align: "right",
    cell: (row) => <PriceDiff oldValue={row.oldSkoPrice} newValue={row.newSkoPrice} />,
  },
  {
    id: "incomingPrice",
    header: "Приходная",
    value: (row) => `${row.oldIncomingPrice ?? ""} ${row.newIncomingPrice ?? ""}`,
    align: "right",
    cell: (row) => <PriceDiff oldValue={row.oldIncomingPrice} newValue={row.newIncomingPrice} />,
  },
  {
    id: "errors",
    header: "Комментарий",
    value: rowErrors,
    cell: (row) => (
      <span
        className={row.errors.length > 0 || row.status === "INVALID" ? "price-import-error" : ""}
      >
        {rowErrors(row)}
      </span>
    ),
  },
];

export function PriceImportPage() {
  const queryClient = useQueryClient();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{
    stage: "uploading" | "processing";
    percent: number;
  } | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [createMissingProducts, setCreateMissingProducts] = useState(false);
  const [updateAvailabilityAndMadeToOrder, setUpdateAvailabilityAndMadeToOrder] = useState(true);
  const [oneCMode, setOneCMode] = useState(false);
  const [oneCPriceTier, setOneCPriceTier] = useState<
    "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO" | "INCOMING"
  >("RETAIL");
  const [commitResult, setCommitResult] = useState<PriceImportCommitResult | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const selectedFile = selectedFiles[0] ?? null;
  const isOneCBatch = oneCMode && selectedFiles.length > 1;

  const analysisQuery = useQuery({
    queryKey: ["price-import", importId],
    queryFn: () => fetchPriceImport(importId!),
    enabled: Boolean(importId),
    retry: false,
  });

  const analyzeMutation = useMutation({
    mutationFn: async ({
      files,
      createMissing,
      updateAvailability,
    }: {
      files: File[];
      createMissing: boolean;
      updateAvailability: boolean;
    }) => {
      const [file] = files;
      if (!file) throw new Error("Выберите хотя бы один файл");
      const options = {
        createMissingProducts: createMissing,
        updateAvailabilityAndMadeToOrder: updateAvailability,
        onUploadProgress: ({ percent }: { percent: number }) =>
          setAnalysisProgress({ stage: "uploading", percent }),
        onProcessing: () => setAnalysisProgress({ stage: "processing", percent: 100 }),
      };
      const analysis =
        oneCMode && files.length > 1
          ? await analyzePriceImportBatch(files, options)
          : await analyzePriceImport(file, {
              ...options,
              oneCPriceTier: oneCMode ? oneCPriceTier : undefined,
            });
      if (!analysis.id) throw new Error("API не вернул идентификатор импорта");
      return analysis;
    },
    onMutate: () => setAnalysisProgress({ stage: "uploading", percent: 0 }),
    onSuccess: (analysis) => {
      setAnalysisProgress(null);
      setImportId(analysis.id);
      setCommitResult(null);
      setFileError(null);
      queryClient.setQueryData(["price-import", analysis.id], analysis);
      setRowSelection(
        Object.fromEntries(analysis.rows.filter(isImportableRow).map((row) => [row.id, true])),
      );
    },
    onError: (error) => {
      setAnalysisProgress(null);
      appToast.error(getErrorMessage(error));
    },
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      if (!importId) throw new Error("Сначала проанализируйте файл");
      return commitPriceImport(importId, selectedRowIndexes);
    },
    onSuccess: (result) => {
      setCommitResult(result);
      setConfirmOpen(false);
      setConfirmed(false);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["price-statistics"] });
      void analysisQuery.refetch();
      appToast.success(result.message ?? "Цены товаров обновлены");
    },
    onError: (error) => appToast.error(getErrorMessage(error)),
  });

  const analysis = analysisQuery.data ?? analyzeMutation.data;
  const selectedRowIndexes = useMemo(
    () =>
      (analysis?.rows ?? []).flatMap((row, index) =>
        rowSelection[row.id] && isImportableRow(row) ? [index] : [],
      ),
    [analysis?.rows, rowSelection],
  );
  const selectedRows = useMemo(
    () => (analysis?.rows ?? []).filter((row) => rowSelection[row.id] && isImportableRow(row)),
    [analysis?.rows, rowSelection],
  );
  const selectedToCreateCount = selectedRows.filter((row) => row.status === "TO_CREATE").length;
  const summary = analysis?.summary;
  const issueCount = summary ? summary.notFound + summary.invalid + summary.duplicate : 0;
  const skippedCount = issueCount;
  const actionableCount = selectedRowIndexes.length;
  const completed =
    Boolean(commitResult) || ["COMPLETED", "COMMITTED", "APPLIED"].includes(analysis?.status ?? "");

  const importStatus = useMemo(() => {
    if (completed) return { label: "Импорт завершён", tone: "green" as const };
    if (analysisQuery.isFetching) return { label: "Обновление", tone: "blue" as const };
    if (analysis) return { label: "Готов к импорту", tone: "orange" as const };
    return { label: "Файл не загружен", tone: "slate" as const };
  }, [analysis, analysisQuery.isFetching, completed]);

  function startAnalysis(updateAvailability = updateAvailabilityAndMadeToOrder) {
    if (selectedFiles.length === 0) return;
    analyzeMutation.mutate({
      files: selectedFiles,
      createMissing: createMissingProducts,
      updateAvailability,
    });
  }

  function handleAvailabilityUpdateChange(nextValue: boolean) {
    if (nextValue === updateAvailabilityAndMadeToOrder) return;
    setUpdateAvailabilityAndMadeToOrder(nextValue);
    if (!analysis || selectedFiles.length === 0) return;

    setImportId(null);
    setCommitResult(null);
    setConfirmed(false);
    setRowSelection({});
    analyzeMutation.reset();
    startAnalysis(nextValue);
  }

  function selectFiles(files: File[]) {
    if (analyzeMutation.isPending || commitMutation.isPending) return;
    const selected = oneCMode ? files : files.slice(0, 1);
    if (selected.length === 0) return;
    if (selected.some((file) => !(oneCMode ? /\.mxl$/i : EXCEL_FILE_NAME).test(file.name))) {
      setSelectedFiles([]);
      setFileError(
        oneCMode
          ? "Для пакетного импорта 1С выберите файлы .mxl"
          : "Поддерживаются только файлы .xlsx и .xlsm",
      );
      return;
    }
    if (selected.length > 5) {
      setSelectedFiles([]);
      setFileError("В одном пакете можно загрузить не больше пяти файлов цен");
      return;
    }
    if (selected.some((file) => file.size > MAX_FILE_SIZE)) {
      setSelectedFiles([]);
      setFileError("Размер каждого файла не должен превышать 2 ГБ");
      return;
    }

    setSelectedFiles(selected);
    setAnalysisProgress(null);
    setFileError(null);
    setImportId(null);
    setCommitResult(null);
    setRowSelection({});
    analyzeMutation.reset();
    commitMutation.reset();
  }

  function resetImport() {
    setSelectedFiles([]);
    setAnalysisProgress(null);
    setFileError(null);
    setImportId(null);
    setCommitResult(null);
    setConfirmed(false);
    setCreateMissingProducts(false);
    setUpdateAvailabilityAndMadeToOrder(true);
    setRowSelection({});
    analyzeMutation.reset();
    commitMutation.reset();
  }

  const persistentError =
    fileError ??
    (analyzeMutation.isError ? getErrorMessage(analyzeMutation.error) : null) ??
    (analysisQuery.isError ? getErrorMessage(analysisQuery.error) : null) ??
    (commitMutation.isError ? getErrorMessage(commitMutation.error) : null);

  return (
    <AdminPage
      eyebrow="Товары и услуги"
      title="Импорт цен и названий"
      backAction={
        <AppButton asChild variant="ghost">
          <Link to="/admin/products" aria-label="Вернуться к товарам">
            <ArrowLeft size={20} />
          </Link>
        </AppButton>
      }
      actions={<AppBadge tone={importStatus.tone}>{importStatus.label}</AppBadge>}
    >
      {persistentError && (
        <AppAlert
          title="Не удалось обработать прайс-лист"
          tone="danger"
          onRetry={
            selectedFiles.length > 0 && analyzeMutation.isError
              ? () =>
                  analyzeMutation.mutate({
                    files: selectedFiles,
                    createMissing: createMissingProducts,
                    updateAvailability: updateAvailabilityAndMadeToOrder,
                  })
              : undefined
          }
        >
          {persistentError}
        </AppAlert>
      )}

      {completed && summary && (
        <AppAlert title="Импорт цен завершён" tone="success">
          {commitResult?.message ??
            `Обновлено товаров: ${commitResult?.updatedProducts ?? summary.changed}. Создано черновиков: ${commitResult?.createdProducts ?? summary.toCreate}. Данные каталога и статистика цен обновляются.`}
        </AppAlert>
      )}

      <DataPanel
        title="Прайс-лист"
        actions={
          selectedFiles.length > 0 ? (
            <AppButton
              type="button"
              variant="secondary"
              onClick={resetImport}
              disabled={analyzeMutation.isPending || commitMutation.isPending}
            >
              Выбрать другой файл
            </AppButton>
          ) : undefined
        }
      >
        <div className="price-import-upload">
          <AppFileUpload
            label="Выбрать прайс-лист"
            accept={
              oneCMode
                ? ".mxl"
                : ".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
            }
            multiple={oneCMode}
            onChange={selectFiles}
          />
          <div className="price-import-upload__details">
            {selectedFiles.length > 0 ? (
              <div className="price-import-files">
                {selectedFiles.map((file) => (
                  <div className="price-import-file" key={`${file.name}-${file.lastModified}`}>
                    <span className="price-import-file__icon">
                      <FileSpreadsheet size={24} />
                    </span>
                    <div>
                      <strong>{file.name}</strong>
                      <span>{formatFileSize(file.size)}</span>
                    </div>
                    <AppBadge tone={analysis ? "green" : "slate"}>
                      {analysis ? "Распознан" : "Выбран"}
                    </AppBadge>
                  </div>
                ))}
              </div>
            ) : (
              <AppAlert title="Формат файла">
                {oneCMode
                  ? "Загрузите файлы выгрузки 1С .mxl одной пачкой. Тип цены будет определён по имени файла: розница, оптовая, крупно_оптовая, ско или приходная."
                  : "Загрузите один файл .xlsx или .xlsm размером до 2 ГБ. Из прайс-листа обновляются названия товаров, розничная, оптовая, крупно-оптовая, СКО и приходная цены."}
              </AppAlert>
            )}
            <AppRadioGroup
              label="Режим импорта"
              value={oneCMode ? "ONE_C" : "EXCEL"}
              onValueChange={(value) => {
                const isOneC = value === "ONE_C";
                setOneCMode(isOneC);
                setCreateMissingProducts(isOneC);
                setSelectedFiles([]);
                setFileError(null);
              }}
              options={[
                { value: "EXCEL", label: "Excel (.xlsx, .xlsm)" },
                { value: "ONE_C", label: "Выгрузка 1С (.mxl)" },
              ]}
            />
            {oneCMode && !isOneCBatch && (
              <AppRadioGroup
                label="Тип цены в одном файле 1С"
                value={oneCPriceTier}
                onValueChange={(value) =>
                  setOneCPriceTier(
                    value as "RETAIL" | "WHOLESALE" | "BULK_WHOLESALE" | "SKO" | "INCOMING",
                  )
                }
                options={[
                  { value: "RETAIL", label: "Розничная" },
                  { value: "WHOLESALE", label: "Оптовая" },
                  { value: "BULK_WHOLESALE", label: "Крупно-оптовая" },
                  { value: "SKO", label: "СКО" },
                  { value: "INCOMING", label: "Приходная" },
                ]}
              />
            )}
            {analysis?.sourceFiles && analysis.sourceFiles.length > 0 && (
              <div className="price-import-recognition" aria-live="polite">
                <div className="price-import-recognition__header">
                  <span className="price-import-file__icon">
                    <Files size={19} />
                  </span>
                  <div>
                    <strong>Файлы распознаны</strong>
                    <span>Проверьте соответствие перед применением изменений.</span>
                  </div>
                </div>
                <div className="price-import-recognition__items">
                  {analysis.sourceFiles.map((file) => (
                    <div key={`${file.fileName}-${file.priceType}`}>
                      <span>{file.fileName}</span>
                      <AppBadge tone="blue">{priceTypeMeta[file.priceType]}</AppBadge>
                      <small>{file.totalRows} строк</small>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {analyzeMutation.isPending && analysisProgress && (
              <div className="price-import-progress" aria-live="polite">
                <div className="price-import-progress__header">
                  <strong>
                    {analysisProgress.stage === "uploading"
                      ? "Загрузка файла"
                      : "Обработка прайс-листа"}
                  </strong>
                  <span>
                    {analysisProgress.stage === "uploading"
                      ? `${Math.round(analysisProgress.percent)}%`
                      : "Анализируем листы и цены"}
                  </span>
                </div>
                <div
                  className={`price-import-progress__track is-${analysisProgress.stage}`}
                  role="progressbar"
                  aria-label={
                    analysisProgress.stage === "uploading"
                      ? "Загрузка файла"
                      : "Обработка прайс-листа"
                  }
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    analysisProgress.stage === "uploading"
                      ? Math.round(analysisProgress.percent)
                      : undefined
                  }
                >
                  <span
                    className="price-import-progress__bar"
                    style={
                      analysisProgress.stage === "uploading"
                        ? { width: `${analysisProgress.percent}%` }
                        : undefined
                    }
                  />
                </div>
              </div>
            )}
            <div className="price-import-create-products">
              <AppSwitch
                label={
                  oneCMode
                    ? "Создавать новые товары из выгрузки 1С"
                    : "Создавать товары для новых числовых артикулов"
                }
                description={
                  oneCMode
                    ? "Обязательная процедура для 1С: если артикул из выгрузки отсутствует в каталоге, после подтверждения импорта будет создан неактивный черновик товара для проверки."
                    : "Не найденные товары с числовым артикулом будут созданы как неактивные черновики. Артикулы с буквами считаются невалидными и не создаются."
                }
                checked={createMissingProducts}
                onCheckedChange={setCreateMissingProducts}
                disabled={
                  oneCMode ||
                  Boolean(analysis) ||
                  analyzeMutation.isPending ||
                  commitMutation.isPending
                }
              />
            </div>
            <div className="price-import-create-products">
              <AppSwitch
                label="Обновлять видимость и статус «Под заказ»"
                description={
                  analysis
                    ? "При изменении настройки выбранные файлы будут проанализированы повторно."
                    : "Пометки «нет в наличии» и служебные метки смогут изменить видимость товара, статус «Под заказ» и доступность в корзине. Если выключить, эти изменения из файла будут проигнорированы, а названия и цены продолжат импортироваться."
                }
                checked={updateAvailabilityAndMadeToOrder}
                onCheckedChange={handleAvailabilityUpdateChange}
                disabled={analyzeMutation.isPending || commitMutation.isPending}
              />
            </div>
            <AppButton
              type="button"
              loading={analyzeMutation.isPending}
              loadingText={
                analysisProgress?.stage === "uploading"
                  ? `Загружаем ${Math.round(analysisProgress.percent)}%`
                  : "Анализируем..."
              }
              disabled={selectedFiles.length === 0 || Boolean(analysis) || commitMutation.isPending}
              onClick={() =>
                selectedFiles.length > 0 &&
                analyzeMutation.mutate({
                  files: selectedFiles,
                  createMissing: createMissingProducts,
                  updateAvailability: updateAvailabilityAndMadeToOrder,
                })
              }
            >
              <Rows3 size={18} />
              {isOneCBatch ? "Распознать и проанализировать файлы" : "Анализировать файл"}
            </AppButton>
          </div>
        </div>
      </DataPanel>

      {summary && (
        <div className="price-import-metrics">
          <MetricCard
            icon={<Rows3 size={18} />}
            label="Строк в файле"
            value={summary.totalRows}
            size="compact"
          />
          <MetricCard
            icon={<RefreshCw size={18} />}
            label="Изменится"
            value={summary.changed}
            accent
            size="compact"
          />
          <MetricCard
            icon={<CheckCircle2 size={18} />}
            label="Без изменений"
            value={summary.unchanged}
            size="compact"
          />
          <MetricCard
            icon={<SearchX size={18} />}
            label="Артикулы не найдены"
            value={summary.notFound}
            size="compact"
          />
          <MetricCard
            icon={<PackagePlus size={18} />}
            label="Будет создано"
            value={summary.toCreate}
            size="compact"
          />
          <MetricCard
            icon={<FileSpreadsheet size={18} />}
            label="Цены заданы документами"
            value={summary.priceSetting}
            size="compact"
          />
          <MetricCard
            icon={<AlertTriangle size={18} />}
            label="Ошибки и дубли"
            value={summary.invalid + summary.duplicate}
            size="compact"
          />
        </div>
      )}

      {analysis && summary && (
        <DataPanel
          title="Предпросмотр изменений"
          actions={
            <div className="price-import-preview__actions">
              {issueCount > 0 && <AppBadge tone="red">Будет пропущено: {issueCount}</AppBadge>}
              <AppBadge tone="blue">Выбрано: {actionableCount}</AppBadge>
              <AppButton
                type="button"
                variant="secondary"
                aria-label="Выбрать все позиции для импорта"
                title="Выбрать все позиции для импорта"
                disabled={completed || commitMutation.isPending}
                onClick={() =>
                  setRowSelection(
                    Object.fromEntries(
                      analysis.rows.filter(isImportableRow).map((row) => [row.id, true]),
                    ),
                  )
                }
              >
                <CheckCheck size={17} />
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                aria-label="Снять выбор со всех позиций"
                title="Снять выбор со всех позиций"
                disabled={actionableCount === 0 || completed || commitMutation.isPending}
                onClick={() => setRowSelection({})}
              >
                <X size={17} />
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                loading={analysisQuery.isFetching}
                loadingMode="spinner-only"
                aria-label="Обновить предпросмотр"
                title="Обновить предпросмотр"
                onClick={() => analysisQuery.refetch()}
              >
                <RefreshCw size={17} />
              </AppButton>
            </div>
          }
        >
          <div className="price-import-preview">
            {skippedCount > 0 ? (
              <AppAlert title="Проблемные строки будут пропущены" tone="warning">
                Строки с ошибками, дубликатами и неизвестными артикулами не попадут в импорт.
                Остальные товары можно обновить без правки исходного файла.
              </AppAlert>
            ) : summary.toCreate > 0 ? (
              <AppAlert title="Новые товары будут созданы" tone="success">
                Для {summary.toCreate} числовых артикулов будут созданы неактивные черновики с
                ценами из файла. Перед публикацией заполните карточки товаров и назначьте им
                категории.
              </AppAlert>
            ) : null}
            {summary.priceSetting > 0 && (
              <AppAlert title="Цены из документов установки цен защищены" tone="info">
                Для {summary.priceSetting} товар{summary.priceSetting === 1 ? "а" : "ов"} цена из
                файла не будет применена. Название товара, если оно изменилось, будет импортировано.
              </AppAlert>
            )}
            <AppDataTable
              data={analysis.rows}
              columns={columns}
              rowId={(row) => row.id}
              loading={analysisQuery.isLoading && !analyzeMutation.data}
              searchable
              selectable={!completed}
              canSelectRow={isImportableRow}
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
              showSelectionSummary={false}
              defaultPageSize={20}
              pageSizes={[10, 20, 50]}
              emptyTitle="В файле нет строк для предпросмотра"
              emptyDescription="Проверьте структуру прайс-листа и загрузите другой файл."
            />
            <div className="price-import-preview__footer">
              <div>
                <strong>
                  К импорту выбрано: {actionableCount}
                  {summary.priceSetting > 0
                    ? `; для ${summary.priceSetting} цен действуют документы установки цен`
                    : ""}
                </strong>
                <span>
                  Цены из документов установки цен не перезаписываются прайс-листом. Новые товары
                  создаются только для числовых артикулов и остаются неактивными до заполнения
                  карточки.
                </span>
              </div>
              {completed ? (
                <AppButton asChild>
                  <Link to="/admin/products">Вернуться к товарам</Link>
                </AppButton>
              ) : (
                <AppButton
                  type="button"
                  disabled={actionableCount === 0 || commitMutation.isPending}
                  onClick={() => {
                    setConfirmed(false);
                    setConfirmOpen(true);
                  }}
                >
                  Подтвердить импорт
                </AppButton>
              )}
            </div>
          </div>
        </DataPanel>
      )}

      <AppModal
        title="Подтвердить импорт каталога"
        description={`К применению выбрано позиций: ${actionableCount}.`}
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!commitMutation.isPending) setConfirmOpen(open);
          if (!open) setConfirmed(false);
        }}
        contentClassName="price-import-confirm-modal"
      >
        <div className="price-import-confirm">
          <div className="price-import-confirm__summary">
            <div>
              <span>{analysis?.sourceFiles.length ? "Файлы" : "Файл"}</span>
              <strong>
                {analysis?.sourceFiles.length
                  ? `${analysis.sourceFiles.length} файлов цен`
                  : (selectedFile?.name ?? analysis?.fileName ?? "Прайс-лист")}
              </strong>
            </div>
            <div>
              <span>Выбрано для импорта</span>
              <strong>{selectedRowIndexes.length}</strong>
            </div>
            <div>
              <span>Будет создано</span>
              <strong>{selectedToCreateCount}</strong>
            </div>
            <div>
              <span>Будет пропущено</span>
              <strong>{skippedCount}</strong>
            </div>
          </div>
          {skippedCount > 0 && (
            <AppAlert title="Есть строки, которые не будут импортированы" tone="warning">
              Ошибки, дубликаты и неизвестные артикулы будут пропущены. Остальные цены импортируются
              одной операцией.
            </AppAlert>
          )}
          {(summary?.toCreate ?? 0) > 0 && (
            <AppAlert title="Создание черновиков" tone="warning">
              Новые товары будут созданы неактивными. В средний процент изменения цен они не
              попадут, так как у них нет предыдущей цены.
            </AppAlert>
          )}
          {analysis?.sourceFiles.length ? (
            <div className="price-import-confirm__files">
              {analysis.sourceFiles.map((file) => (
                <div key={`${file.fileName}-${file.priceType}`}>
                  <span>{file.fileName}</span>
                  <AppBadge tone="blue">{priceTypeMeta[file.priceType]}</AppBadge>
                </div>
              ))}
            </div>
          ) : null}
          <AppCheckbox
            label={
              analysis?.sourceFiles.length
                ? "Я проверил распознанные типы цен и предпросмотр"
                : "Я проверил предпросмотр"
            }
            description="После подтверждения будут обновлены названия и цены товаров."
            checked={confirmed}
            onCheckedChange={setConfirmed}
            disabled={commitMutation.isPending}
          />
          <div className="price-import-confirm__actions">
            <AppButton
              type="button"
              variant="secondary"
              disabled={commitMutation.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              Отмена
            </AppButton>
            <AppButton
              type="button"
              loading={commitMutation.isPending}
              loadingText="Импортируем..."
              disabled={!confirmed || actionableCount === 0}
              onClick={() => commitMutation.mutate()}
            >
              Импортировать изменения
            </AppButton>
          </div>
        </div>
      </AppModal>
    </AdminPage>
  );
}
