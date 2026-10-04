import { type MouseEvent, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { CheckCheck, Edit, FileSpreadsheet, PackageCheck, ScanSearch } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import { ALMATY_TIME_ZONE } from "@/shared/lib/dateTime";
import {
  activateEligibleImportCreatedProductDrafts,
  analyzeImportCreatedProductDrafts,
  fetchImportCreatedProductImports,
  fetchImportCreatedProducts,
  type ImportCreatedProductActivationResult,
  type ImportCreatedProduct,
} from "@/shared/api/importCreatedProducts";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppContextMenu, type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import { AppAlert, AppModal, AppSkeleton } from "@/shared/ui/AppFeedback";
import { AppSelect } from "@/shared/ui/AppField";
import { appToast } from "@/shared/ui/AppToast";
import { DataPanel } from "@/shared/ui/DataPanel";
import "./ImportCreatedProductsPage.css";

const moneyFormat = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: ALMATY_TIME_ZONE,
});

function formatMoney(value: number | null) {
  return value === null ? "—" : `${moneyFormat.format(value)} ₸`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Не удалось загрузить созданные товары";
}

type ImportCreatedProductContextMenuState = {
  product: ImportCreatedProduct;
  x: number;
  y: number;
};

export function ImportCreatedProductsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedImport, setSelectedImport] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sorting, setSorting] = useState<SortingState>([{ id: "importedAt", desc: true }]);
  const [activationModalOpen, setActivationModalOpen] = useState(false);
  const [activationResult, setActivationResult] =
    useState<ImportCreatedProductActivationResult | null>(null);
  const [productContextMenu, setProductContextMenu] =
    useState<ImportCreatedProductContextMenuState | null>(null);

  const importsQuery = useQuery({
    queryKey: ["import-created-products", "imports"],
    queryFn: fetchImportCreatedProductImports,
  });
  const productsQuery = useQuery({
    queryKey: ["import-created-products", search, selectedImport, status, page, pageSize, sorting],
    queryFn: () =>
      fetchImportCreatedProducts({
        page,
        size: pageSize,
        search: search || undefined,
        importId: selectedImport === "all" ? undefined : selectedImport,
        active: status === "active" ? true : status === "draft" ? false : undefined,
        sort: sorting[0]?.id ?? "importedAt",
        direction: sorting[0]?.desc ? "desc" : "asc",
      }),
  });

  const activationAnalysis = useMutation({
    mutationFn: analyzeImportCreatedProductDrafts,
    onError: (error) => appToast.error(getErrorMessage(error)),
  });
  const activateDrafts = useMutation({
    mutationFn: activateEligibleImportCreatedProductDrafts,
    onSuccess: (result) => {
      setActivationResult(result);
      void queryClient.invalidateQueries({ queryKey: ["import-created-products"] });
      appToast.success(`Активировано товаров: ${result.activatedProducts}`);
    },
    onError: (error) => appToast.error(getErrorMessage(error)),
  });

  const fileOptions = useMemo(
    () => [
      { value: "all", label: "Все файлы" },
      ...(importsQuery.data ?? []).map((item) => ({
        value: item.importId,
        label: `${item.fileName} · ${item.createdCount}`,
      })),
    ],
    [importsQuery.data],
  );

  const productActions = useCallback(
    (product: ImportCreatedProduct): AppContextMenuAction[] => [
      {
        label: "Открыть товар",
        icon: <Edit size={17} />,
        onSelect: () =>
          navigate(`/admin/products/${product.id}`, {
            state: { returnTo: "/admin/products/import-created" },
          }),
      },
    ],
    [navigate],
  );

  const columns = useMemo<AppDataTableColumn<ImportCreatedProduct>[]>(
    () => [
      {
        id: "sku",
        header: "Артикул",
        accessor: "sku",
        sortable: true,
        width: 130,
        cell: (product) => <code className="import-created-products__sku">{product.sku}</code>,
      },
      {
        id: "nameRu",
        header: "Название",
        accessor: "nameRu",
        sortable: true,
        cell: (product) => (
          <Link
            className="import-created-products__name"
            to={`/admin/products/${product.id}`}
            state={{ returnTo: "/admin/products/import-created" }}
            title={product.nameRu}
          >
            {product.nameRu}
          </Link>
        ),
      },
      {
        id: "price",
        header: "Розница",
        accessor: "price",
        sortable: true,
        align: "right",
        cell: (product) => (
          <span className="import-created-products__price">{formatMoney(product.price)}</span>
        ),
      },
      {
        id: "categoryName",
        header: "Категория",
        accessor: "categoryName",
        cell: (product) =>
          product.categoryName ?? (
            <span className="import-created-products__muted">Не назначена</span>
          ),
      },
      {
        id: "wholesalePrice",
        header: "Опт",
        accessor: "wholesalePrice",
        align: "right",
        cell: (product) => (
          <span className="import-created-products__price">
            {formatMoney(product.wholesalePrice)}
          </span>
        ),
      },
      {
        id: "bulkWholesalePrice",
        header: "Крупный опт",
        accessor: "bulkWholesalePrice",
        align: "right",
        initialHidden: true,
        cell: (product) => (
          <span className="import-created-products__price">
            {formatMoney(product.bulkWholesalePrice)}
          </span>
        ),
      },
      {
        id: "skoPrice",
        header: "СКО",
        accessor: "skoPrice",
        align: "right",
        initialHidden: true,
        cell: (product) => (
          <span className="import-created-products__price">{formatMoney(product.skoPrice)}</span>
        ),
      },
      {
        id: "active",
        header: "Статус",
        value: (product) => (product.active ? "active" : "draft"),
        sortable: true,
        cell: (product) => (
          <AppBadge tone={product.active ? "green" : "orange"}>
            {product.active ? "Активен" : "Черновик"}
          </AppBadge>
        ),
      },
      {
        id: "importFileName",
        header: "Файл импорта",
        accessor: "importFileName",
        cell: (product) => (
          <div className="import-created-products__file">
            <FileSpreadsheet size={16} aria-hidden="true" />
            <span>
              <strong>{product.importFileName ?? "Файл недоступен"}</strong>
              <small>{formatDate(product.importedAt)}</small>
            </span>
          </div>
        ),
      },
      {
        id: "importedAt",
        header: "Создан",
        accessor: "importedAt",
        sortable: true,
        initialHidden: true,
        cell: (product) => formatDate(product.importedAt),
      },
      {
        id: "actions",
        header: "",
        hideable: false,
        width: 56,
        align: "right",
        cell: (product) => (
          <AppActionMenu label={`Действия: ${product.nameRu}`} actions={productActions(product)} />
        ),
      },
    ],
    [productActions],
  );

  function resetPageAnd(action: () => void) {
    setPage(1);
    action();
  }

  const selectedImportSummary = importsQuery.data?.find((item) => item.importId === selectedImport);
  const data = productsQuery.data?.items ?? [];

  function openActivationAnalysis() {
    setActivationResult(null);
    setActivationModalOpen(true);
    activationAnalysis.mutate();
  }

  function openProductContextMenu(
    product: ImportCreatedProduct,
    event: MouseEvent<HTMLTableRowElement>,
  ) {
    if (event.button !== 2) return;
    event.preventDefault();
    setProductContextMenu({ product, x: event.clientX, y: event.clientY });
  }

  return (
    <AdminPage
      eyebrow="Товары и услуги"
      title="Создание товара (импорт)"
      actions={
        <div className="import-created-products__header-actions">
          <AppButton type="button" variant="secondary" onClick={openActivationAnalysis}>
            <ScanSearch size={18} aria-hidden="true" />
            Проверить черновики
          </AppButton>
          <AppBadge tone="blue">
            <PackageCheck size={15} aria-hidden="true" />
            {productsQuery.data?.totalItems ?? 0} товаров
          </AppBadge>
        </div>
      }
    >
      <div className="import-created-products__content">
        <div className="import-created-products__intro">
          <div>
            <strong>Отдельная очередь импортированных товаров</strong>
            <p>
              Проверьте название, категорию и изображения. После активации товар останется в этой
              группе и появится в каталоге магазина.
            </p>
          </div>
          {selectedImportSummary && (
            <span>
              В файле создано: <b>{selectedImportSummary.createdCount}</b>
            </span>
          )}
        </div>

        <DataPanel title="Товары, созданные из прайс-листов">
          <AppDataTable
            data={data}
            columns={columns}
            rowId={(product) => String(product.id)}
            loading={productsQuery.isLoading}
            error={productsQuery.isError ? getErrorMessage(productsQuery.error) : undefined}
            selectable={false}
            mode="server"
            searchValue={search}
            onSearchChange={(value) => resetPageAnd(() => setSearch(value))}
            toolbarFilters={
              <>
                <div className="app-data-table__filter import-created-products__filter import-created-products__filter--file">
                  <AppSelect
                    ariaLabel="Файл импорта"
                    options={fileOptions}
                    value={selectedImport}
                    onValueChange={(value) =>
                      resetPageAnd(() => setSelectedImport(Array.isArray(value) ? "all" : value))
                    }
                    searchable
                    clearable={false}
                    disabled={importsQuery.isLoading}
                  />
                </div>
                <div className="app-data-table__filter import-created-products__filter import-created-products__filter--status">
                  <AppSelect
                    ariaLabel="Статус товара"
                    options={[
                      { value: "all", label: "Все статусы" },
                      { value: "draft", label: "Черновики" },
                      { value: "active", label: "Активные" },
                    ]}
                    value={status}
                    onValueChange={(value) =>
                      resetPageAnd(() => setStatus(Array.isArray(value) ? "all" : value))
                    }
                    clearable={false}
                  />
                </div>
              </>
            }
            activeToolbarFilters={Number(selectedImport !== "all") + Number(status !== "all")}
            onClearToolbarFilters={() => {
              setSelectedImport("all");
              setStatus("all");
            }}
            sortingState={sorting}
            onSortingStateChange={(value) => resetPageAnd(() => setSorting(value))}
            page={productsQuery.data?.page ?? page}
            pageSize={productsQuery.data?.size ?? pageSize}
            totalItems={productsQuery.data?.totalItems ?? 0}
            totalPages={productsQuery.data?.totalPages ?? 1}
            onPageChange={setPage}
            onPageSizeChange={(value) => resetPageAnd(() => setPageSize(value))}
            pageSizes={[10, 20, 50, 100]}
            defaultPageSize={20}
            emptyTitle="Импортированные товары не найдены"
            emptyDescription="Измените файл, статус или поисковый запрос."
            onRowContextMenu={openProductContextMenu}
          />
        </DataPanel>
      </div>

      {productContextMenu && (
        <AppContextMenu
          open
          x={productContextMenu.x}
          y={productContextMenu.y}
          label={`Действия: ${productContextMenu.product.nameRu}`}
          actions={productActions(productContextMenu.product)}
          onOpenChange={(open) => !open && setProductContextMenu(null)}
        />
      )}

      <AppModal
        open={activationModalOpen}
        onOpenChange={(open) => {
          if (!activateDrafts.isPending) setActivationModalOpen(open);
        }}
        title="Проверка черновиков импорта"
        description="Будут проверены все неактивные товары, созданные через импорт цен, независимо от фильтров таблицы."
        contentClassName="import-created-products__activation-modal"
      >
        {activationAnalysis.isPending ? (
          <AppSkeleton />
        ) : activationAnalysis.isError ? (
          <AppAlert title="Не удалось проверить черновики" tone="danger">
            {getErrorMessage(activationAnalysis.error)}
          </AppAlert>
        ) : activationAnalysis.data ? (
          <div className="import-created-products__activation-content">
            {activationResult ? (
              <AppAlert title="Активация завершена" tone="success">
                Активировано товаров: {activationResult.activatedProducts}. Пропущено:{" "}
                {activationResult.skippedProducts.length}.
              </AppAlert>
            ) : (
              <AppAlert title="Анализ завершён" tone="info">
                Подходящие черновики можно активировать одной операцией.
              </AppAlert>
            )}

            <div className="import-created-products__activation-summary">
              <div>
                <span>Всего черновиков</span>
                <strong>{activationAnalysis.data.totalDrafts}</strong>
              </div>
              <div>
                <span>Можно активировать</span>
                <strong>{activationAnalysis.data.readyToActivate}</strong>
              </div>
              <div>
                <span>Пропущено</span>
                <strong>{activationAnalysis.data.skippedProducts.length}</strong>
              </div>
            </div>

            <p className="import-created-products__activation-terms">
              Служебные слова: {activationAnalysis.data.excludedNameTerms.join(", ")}.
            </p>

            {activationAnalysis.data.skippedProducts.length > 0 && (
              <div className="import-created-products__activation-skips">
                <strong>Пропущенные карточки</strong>
                <ul>
                  {activationAnalysis.data.skippedProducts.map((product) => (
                    <li key={product.productId}>
                      <div>
                        <b>{product.nameRu || "Без названия"}</b>
                        <span>Артикул: {product.sku}</span>
                      </div>
                      <small>{product.reasons.join("; ")}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="import-created-products__activation-actions">
              <AppButton
                type="button"
                variant="secondary"
                disabled={activateDrafts.isPending}
                onClick={() => setActivationModalOpen(false)}
              >
                Закрыть
              </AppButton>
              {!activationResult && (
                <AppButton
                  type="button"
                  loading={activateDrafts.isPending}
                  loadingText="Активируем"
                  disabled={activationAnalysis.data.readyToActivate === 0}
                  onClick={() => activateDrafts.mutate()}
                >
                  <CheckCheck size={18} aria-hidden="true" />
                  Активировать: {activationAnalysis.data.readyToActivate}
                </AppButton>
              )}
            </div>
          </div>
        ) : null}
      </AppModal>
    </AdminPage>
  );
}
