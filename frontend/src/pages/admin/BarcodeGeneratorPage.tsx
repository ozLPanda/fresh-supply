import { FormEvent, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import {
  Barcode,
  Copy,
  ExternalLink,
  LoaderCircle,
  PackageSearch,
  Plus,
  Printer,
  Trash2,
} from "lucide-react";
import { AdminPage } from "@/layouts/AdminPage";
import {
  findBarcodeProducts,
  type BarcodeProductLookup,
  generateBarcodePdf,
  type BarcodePdfDownload,
  type BarcodePdfMode,
} from "@/shared/api/barcodes";
import { fetchProductPage } from "@/shared/api/catalog";
import type { Product } from "@/shared/types/models";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCheckbox } from "@/shared/ui/AppControls";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { AppNumberInput, AppTextarea } from "@/shared/ui/AppField";
import { AppTable } from "@/shared/ui/AppTable";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import { SegmentedControl } from "@/shared/ui/SegmentedControl";
import "./BarcodeGeneratorPage.css";

type BarcodeRow = {
  sku: string;
  name?: string;
  productId?: number;
  nameStatus: "loading" | "resolved";
  quantity: number;
};

const MAX_LABELS = 10_000;
const PICKER_PAGE_SIZE = 50;
const LABELS_PER_SHEET: Record<BarcodePdfMode, number> = {
  COMPACT: 36,
  WITH_NAME: 18,
};

function calculateExcludedRows(rows: BarcodeRow[], excludedCount: number) {
  let remaining = excludedCount;
  const excluded: Array<{ sku: string; quantity: number }> = [];

  for (let index = rows.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const row = rows[index];
    const quantity = Math.min(row.quantity, remaining);
    excluded.push({ sku: row.sku, quantity });
    remaining -= quantity;
  }

  return excluded.reverse();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось выполнить операцию";
}

export function BarcodeGeneratorPage() {
  const [rows, setRows] = useState<BarcodeRow[]>([]);
  const [mode, setMode] = useState<BarcodePdfMode>("COMPACT");
  const [excludeIncompleteSheet, setExcludeIncompleteSheet] = useState(false);
  const [bulkQuantity, setBulkQuantity] = useState(1);
  const [manualValues, setManualValues] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSorting, setPickerSorting] = useState<SortingState>([{ id: "nameRu", desc: false }]);

  const productsQuery = useInfiniteQuery({
    queryKey: ["products", "barcode-picker", pickerSearch, pickerSorting],
    queryFn: ({ pageParam }) => {
      const sort = pickerSorting[0] ?? { id: "nameRu", desc: false };
      return fetchProductPage({
        page: pageParam,
        size: PICKER_PAGE_SIZE,
        search: pickerSearch.trim() || undefined,
        sort: sort.id,
        direction: sort.desc ? "desc" : "asc",
        excludeImportCreated: true,
        lexicalOnly: true,
      });
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled: pickerOpen,
  });

  const pickerProducts = useMemo(() => {
    const productsById = new Map<string, Product>();
    productsQuery.data?.pages.forEach((page) => {
      page.items.forEach((product) => {
        const id = String(product.id ?? product.sku);
        if (!productsById.has(id)) productsById.set(id, product);
      });
    });
    return [...productsById.values()];
  }, [productsQuery.data]);

  function loadMoreProducts() {
    if (productsQuery.hasNextPage && !productsQuery.isFetchingNextPage) {
      void productsQuery.fetchNextPage();
    }
  }

  const pdfMutation = useMutation<BarcodePdfDownload, unknown, Window>({
    mutationFn: () =>
      generateBarcodePdf({
        mode,
        excludeIncompleteSheet,
        items: rows.map((row) => ({
          value: row.sku,
          quantity: row.quantity,
          ...(row.name ? { name: row.name } : {}),
        })),
      }),
    onSuccess: ({ blob, fileName }, previewWindow) => {
      const pdfFile = new File([blob], fileName, { type: "application/pdf" });
      const pdfUrl = URL.createObjectURL(pdfFile);
      if (previewWindow.closed) {
        URL.revokeObjectURL(pdfUrl);
        appToast.error("Вкладка предпросмотра была закрыта");
        return;
      }
      previewWindow.location.replace(pdfUrl);
      const closedCheck = window.setInterval(() => {
        if (!previewWindow.closed) return;
        window.clearInterval(closedCheck);
        URL.revokeObjectURL(pdfUrl);
      }, 30_000);
      appToast.success("PDF открыт в новой вкладке и готов к печати");
    },
    onError: (error, previewWindow) => {
      if (!previewWindow.closed) previewWindow.close();
      appToast.error(errorMessage(error));
    },
  });

  const productNamesMutation = useMutation<Record<string, BarcodeProductLookup>, unknown, string[]>(
    {
      mutationFn: findBarcodeProducts,
      onSuccess: (namesBySku, requestedSkus) => {
        const requested = new Set(requestedSkus);
        setRows((current) =>
          current.map((row) => {
            if (!requested.has(row.sku)) return row;
            const product = namesBySku[row.sku];
            const name = product?.name?.trim();
            return {
              ...row,
              ...(name ? { name } : {}),
              ...(product ? { productId: product.id } : {}),
              nameStatus: "resolved",
            };
          }),
        );
      },
      onError: (error, requestedSkus) => {
        const requested = new Set(requestedSkus);
        setRows((current) =>
          current.map((row) => (requested.has(row.sku) ? { ...row, nameStatus: "resolved" } : row)),
        );
        appToast.error(`Не удалось загрузить наименования: ${errorMessage(error)}`);
      },
    },
  );

  const labelCount = rows.reduce((sum, row) => sum + row.quantity, 0);
  const labelsPerSheet = LABELS_PER_SHEET[mode];
  const incompleteSheetLabels = labelCount % labelsPerSheet;
  const freeSlots = incompleteSheetLabels === 0 ? 0 : labelsPerSheet - incompleteSheetLabels;
  const excludedLabelCount = excludeIncompleteSheet ? incompleteSheetLabels : 0;
  const includedLabelCount = labelCount - excludedLabelCount;
  const excludedRows = calculateExcludedRows(rows, excludedLabelCount);
  const generatedSheetCount =
    labelCount === 0
      ? 0
      : excludeIncompleteSheet
        ? Math.floor(labelCount / labelsPerSheet)
        : Math.ceil(labelCount / labelsPerSheet);
  const missingNameCount = rows.filter(
    (row) => row.nameStatus === "resolved" && !row.name?.trim(),
  ).length;
  const limitExceeded = labelCount > MAX_LABELS;

  async function copyExcludedRows(includeQuantity: boolean) {
    const text = excludedRows
      .map((row) => (includeQuantity ? `${row.sku}\t${row.quantity}` : row.sku))
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      appToast.success(
        includeQuantity ? "Артикулы с количеством скопированы" : "Артикулы скопированы",
      );
    } catch {
      appToast.error("Не удалось скопировать список");
    }
  }

  function addRows(nextRows: BarcodeRow[]) {
    setRows((current) => {
      const merged = new Map(current.map((row) => [row.sku, { ...row }]));
      nextRows.forEach((row) => {
        const existing = merged.get(row.sku);
        if (existing) {
          existing.quantity = Math.min(100, existing.quantity + row.quantity);
          if (row.name) existing.name = row.name;
        } else {
          merged.set(row.sku, row);
        }
      });
      return [...merged.values()];
    });
  }

  function addManualValues(event: FormEvent) {
    event.preventDefault();
    const values = manualValues.split(/[\s,;]+/).filter(Boolean);
    if (values.length === 0) {
      setManualError("Введите хотя бы один артикул");
      return;
    }
    const invalid = values.find((value) => !/^\d+$/.test(value));
    if (invalid) {
      setManualError(`Артикул «${invalid}» должен содержать только цифры`);
      return;
    }
    if (values.some((value) => value.length > 48)) {
      setManualError("Артикул не должен быть длиннее 48 символов");
      return;
    }

    const skus = [...new Set(values)];
    addRows(skus.map((sku) => ({ sku, quantity: 1, nameStatus: "loading" })));
    productNamesMutation.mutate(skus);
    setManualValues("");
    setManualError(null);
  }

  function addProducts(products: Product[]) {
    addRows(
      products.map((product) => ({
        sku: product.sku,
        name: product.nameRu,
        productId: product.id,
        nameStatus: "resolved",
        quantity: 1,
      })),
    );
    setPickerOpen(false);
  }

  const productColumns = useMemo<AppDataTableColumn<Product>[]>(
    () => [
      {
        id: "sku",
        header: "Артикул",
        accessor: "sku",
        sortable: true,
        width: 150,
        cell: (product) => <code>{product.sku}</code>,
      },
      {
        id: "nameRu",
        header: "Название",
        accessor: "nameRu",
        sortable: true,
        cell: (product) => (
          <strong className="barcode-picker__product-name">{product.nameRu}</strong>
        ),
      },
      {
        id: "card",
        header: "Карточка",
        hideable: false,
        width: 140,
        cell: (product) =>
          product.id ? (
            <AppButton asChild type="button" variant="ghost" className="barcode-picker__link">
              <a
                href={`/admin/products/${product.id}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Открыть карточку товара ${product.nameRu} в новой вкладке`}
              >
                Открыть
                <ExternalLink size={15} />
              </a>
            </AppButton>
          ) : (
            "—"
          ),
      },
    ],
    [],
  );

  const printColumns = useMemo<AppDataTableColumn<BarcodeRow>[]>(
    () => [
      {
        id: "sku",
        header: "Артикул",
        accessor: "sku",
        sortable: true,
        width: 180,
        cell: (row) => <code>{row.sku}</code>,
      },
      {
        id: "name",
        header: "Название",
        value: (row) => row.name ?? "",
        sortable: true,
        cell: (row) =>
          row.nameStatus === "loading" ? (
            <span className="barcode-list__name barcode-list__name--loading" role="status">
              <LoaderCircle size={16} aria-hidden="true" />
              Загрузка наименования…
            </span>
          ) : (
            <span className={row.name ? "barcode-list__name" : "barcode-list__name is-empty"}>
              {row.name || "Не указано"}
            </span>
          ),
      },
      {
        id: "quantity",
        header: "Количество",
        value: (row) => row.quantity,
        searchable: false,
        sortable: true,
        width: 150,
        cell: (row) => (
          <AppNumberInput
            className="barcode-list__quantity"
            min={1}
            max={100}
            step={1}
            value={row.quantity}
            aria-label={`Количество этикеток для артикула ${row.sku}`}
            onChange={(event) => {
              const quantity = Number(event.target.value);
              setRows((current) =>
                current.map((item) =>
                  item.sku === row.sku
                    ? {
                        ...item,
                        quantity: Number.isInteger(quantity)
                          ? Math.max(1, Math.min(100, quantity))
                          : 1,
                      }
                    : item,
                ),
              );
            }}
          />
        ),
      },
      {
        id: "delete",
        header: "",
        hideable: false,
        width: 112,
        cell: (row) => (
          <div className="barcode-list__actions">
            {row.productId ? (
              <AppButton asChild type="button" variant="ghost" className="barcode-list__open">
                <a
                  href={`/admin/products/${row.productId}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Открыть карточку товара для артикула ${row.sku}`}
                >
                  <ExternalLink size={18} />
                </a>
              </AppButton>
            ) : null}
            <AppButton
              type="button"
              variant="ghost"
              className="barcode-list__delete"
              aria-label={`Удалить артикул ${row.sku}`}
              onClick={() => setRows((current) => current.filter((item) => item.sku !== row.sku))}
            >
              <Trash2 size={18} />
            </AppButton>
          </div>
        ),
      },
    ],
    [],
  );

  function openPdfPreview() {
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      appToast.error("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
      return;
    }

    previewWindow.document.title = "Генерация PDF…";
    previewWindow.document.body.textContent = "Генерируем PDF для печати…";
    pdfMutation.mutate(previewWindow);
  }

  return (
    <AdminPage
      eyebrow="Товары и услуги"
      title="Генерация штрих-кодов"
      actions={
        <AppButton
          type="button"
          loading={pdfMutation.isPending}
          loadingText="Генерируем PDF..."
          disabled={
            rows.length === 0 ||
            limitExceeded ||
            includedLabelCount === 0 ||
            rows.some((row) => row.nameStatus === "loading")
          }
          onClick={openPdfPreview}
        >
          <Printer size={18} />
          Генерировать PDF
        </AppButton>
      }
    >
      <AppAlert title="Печать этикеток">
        {mode === "COMPACT"
          ? "Компактная этикетка 45 × 30 мм: Code 128 и артикул под ним."
          : "Этикетка 60 × 45 мм: название товара сверху, увеличенный Code 128 и артикул снизу."}
      </AppAlert>

      <DataPanel
        title="Артикулы для печати"
        actions={
          <AppButton type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
            <PackageSearch size={18} />
            Подбор
          </AppButton>
        }
      >
        <div className="barcode-mode">
          <div>
            <strong>Режим формирования</strong>
            <span>Выберите размер и состав печатной этикетки.</span>
          </div>
          <SegmentedControl
            items={[
              { value: "COMPACT", label: "Компактный 45 × 30 мм" },
              { value: "WITH_NAME", label: "С названием 60 × 45 мм" },
            ]}
            value={mode}
            ariaLabel="Режим формирования этикеток"
            onValueChange={(value) => setMode(value as BarcodePdfMode)}
          />
        </div>

        <form className="barcode-manual" onSubmit={addManualValues}>
          <AppTextarea
            label="Добавить артикулы вручную"
            hint="Только цифры. Несколько артикулов можно разделить пробелом, запятой или новой строкой."
            error={manualError ?? undefined}
            value={manualValues}
            inputMode="numeric"
            spellCheck={false}
            rows={3}
            placeholder={"Например:\n100001\n100002"}
            onChange={(event) => {
              setManualValues(event.target.value);
              if (manualError) setManualError(null);
            }}
          />
          <AppButton type="submit" variant="secondary">
            <Plus size={18} />
            Добавить в таблицу
          </AppButton>
        </form>

        {rows.length > 0 ? (
          <div className="barcode-list">
            <div className="barcode-list__bulk-quantity">
              <AppNumberInput
                label="Количество для всех"
                min={1}
                max={100}
                step={1}
                value={bulkQuantity}
                onChange={(event) => {
                  const quantity = Number(event.target.value);
                  setBulkQuantity(
                    Number.isInteger(quantity) ? Math.max(1, Math.min(100, quantity)) : 1,
                  );
                }}
              />
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => {
                  setRows((current) => current.map((row) => ({ ...row, quantity: bulkQuantity })));
                  appToast.success(`Количество ${bulkQuantity} применено ко всем позициям`);
                }}
              >
                Применить ко всем
              </AppButton>
            </div>
            <AppDataTable
              data={rows}
              columns={printColumns}
              rowId={(row) => row.sku}
              searchable
              selectable={false}
              virtualized
              pagination={false}
              scrollHeight={360}
              rowHeight={58}
              overscan={5}
              emptyTitle="Артикулы не найдены"
              emptyDescription="Измените поисковый запрос."
            />
            {mode === "WITH_NAME" && missingNameCount > 0 && (
              <AppAlert title="Не у всех позиций есть название" tone="warning">
                Для {missingNameCount} позиций, добавленных вручную, заголовок этикетки останется
                пустым. Чтобы напечатать название, добавьте товар через «Подбор».
              </AppAlert>
            )}
            <div className="barcode-list__summary">
              <span>Строк: {rows.length}</span>
              <strong>Этикеток: {labelCount}</strong>
              <AppButton
                type="button"
                variant="ghost"
                onClick={() => setRows([])}
                disabled={pdfMutation.isPending}
              >
                Очистить список
              </AppButton>
            </div>
            <section className="barcode-print-info" aria-labelledby="barcode-print-info-title">
              <div className="barcode-print-info__heading">
                <div>
                  <strong id="barcode-print-info-title">Информация о печати</strong>
                  <span>
                    На одном листе помещается {labelsPerSheet} штрих-кодов. Листов в PDF:{" "}
                    {generatedSheetCount}.
                  </span>
                </div>
                <AppCheckbox
                  label="Не включать неполный последний лист"
                  description="Штрих-коды с неполного листа не попадут в PDF."
                  checked={excludeIncompleteSheet}
                  onCheckedChange={setExcludeIncompleteSheet}
                />
              </div>

              {incompleteSheetLabels === 0 ? (
                <p className="barcode-print-info__complete">Все листы заполнены полностью.</p>
              ) : (
                <p className="barcode-print-info__capacity">
                  Последний лист заполнен на {incompleteSheetLabels} из {labelsPerSheet}. Свободных
                  мест: {freeSlots}.
                </p>
              )}

              {excludeIncompleteSheet && excludedRows.length > 0 && (
                <div className="barcode-print-info__excluded" role="status">
                  <div className="barcode-print-info__excluded-heading">
                    <strong>Не попадут в PDF: {excludedLabelCount} штрих-кодов</strong>
                    <div className="barcode-print-info__copy-actions">
                      <AppButton
                        type="button"
                        variant="secondary"
                        className="barcode-print-info__copy-button"
                        onClick={() => void copyExcludedRows(false)}
                      >
                        <Copy size={15} />
                        Копировать артикулы
                      </AppButton>
                      <AppButton
                        type="button"
                        variant="secondary"
                        className="barcode-print-info__copy-button"
                        onClick={() => void copyExcludedRows(true)}
                      >
                        <Copy size={15} />
                        Артикулы + количество
                      </AppButton>
                    </div>
                  </div>
                  <AppTable
                    className="barcode-print-info__excluded-table"
                    size="compact"
                    headers={["Артикул", "Количество"]}
                    rows={excludedRows.map((row) => [
                      <code key={`${row.sku}-sku`}>{row.sku}</code>,
                      <strong key={`${row.sku}-quantity`}>{row.quantity} шт.</strong>,
                    ])}
                  />
                  {includedLabelCount === 0 && (
                    <span>Для печати полного листа недостаточно штрих-кодов.</span>
                  )}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="barcode-empty">
            <Barcode size={34} />
            <strong>Список артикулов пока пуст</strong>
            <span>Добавьте числовые артикулы вручную или выберите товары из каталога.</span>
          </div>
        )}

        {limitExceeded && (
          <AppAlert title="Превышен лимит PDF" tone="danger">
            В одном файле может быть не более {MAX_LABELS} этикеток. Уменьшите количество перед
            генерацией.
          </AppAlert>
        )}
      </DataPanel>

      <AppModal
        title="Подбор товаров"
        description="Найдите товары и отметьте позиции, для которых нужно напечатать штрих-коды."
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        contentClassName="barcode-picker"
      >
        <AppDataTable
          data={pickerProducts}
          columns={productColumns}
          rowId={(product) => String(product.id ?? product.sku)}
          loading={productsQuery.isLoading}
          error={
            productsQuery.isError && !productsQuery.data
              ? errorMessage(productsQuery.error)
              : undefined
          }
          selectable
          searchable
          mode="infinite"
          searchValue={pickerSearch}
          onSearchChange={setPickerSearch}
          sortingState={pickerSorting}
          onSortingStateChange={setPickerSorting}
          virtualized
          hasMore={productsQuery.hasNextPage}
          loadingMore={productsQuery.isFetchingNextPage}
          onLoadMore={loadMoreProducts}
          loadMoreError={
            productsQuery.isFetchNextPageError ? errorMessage(productsQuery.error) : undefined
          }
          onRetryLoadMore={loadMoreProducts}
          totalItems={productsQuery.data?.pages[0]?.totalItems ?? 0}
          scrollHeight={520}
          rowHeight={64}
          overscan={6}
          bulkActions={[
            {
              label: "Добавить выбранные",
              icon: <Plus size={16} />,
              onSelect: addProducts,
            },
          ]}
          emptyTitle="Товары не найдены"
          emptyDescription="Измените поисковый запрос или добавьте артикул вручную."
        />
      </AppModal>
    </AdminPage>
  );
}
