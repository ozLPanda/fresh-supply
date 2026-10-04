import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, Plug, Search } from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import { ApiError } from "@/shared/api/http";
import {
  connectMks,
  fetchMksStatus,
  searchMks,
  type MksFilter,
  type MksFilterValue,
  type MksProduct,
  type MksSearchRequest,
  type MksSearchResult,
} from "@/shared/api/mks";
import {
  createSupplierImport,
  SUPPLIER_IMPORTS_KEY,
  type SupplierImportScope,
} from "@/shared/api/supplierProducts";
import { SupplierImportQueue } from "@/shared/components/supplier-products/SupplierImportQueue";
import { useSupplierImportQueue } from "@/shared/components/supplier-products/useSupplierImportQueue";
import type { RowSelectionState } from "@tanstack/react-table";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppCheckbox } from "@/shared/ui/AppControls";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { AppInput, AppNumberInput, AppSearchInput, AppSelect } from "@/shared/ui/AppField";
import { MksProductModal } from "./MksProductModal";
import "./MksCatalogPage.css";

const CATALOG_URL = "https://mkskz.master.pro/cabinet/action12/initcatalog0#!?page=1";
const STATUS_KEY = ["mks-catalog-status"];
const PAGE_SIZES = [10, 25, 50, 100];

function readRequest(search: string): MksSearchRequest {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page"));
  const size = Number(params.get("size"));
  let filters: MksSearchRequest["filters"] = {};
  try {
    const value: unknown = JSON.parse(params.get("filters") ?? "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) {
      filters = Object.fromEntries(
        Object.entries(value).filter(
          ([, entry]) =>
            typeof entry === "string" ||
            typeof entry === "boolean" ||
            (typeof entry === "number" && Number.isFinite(entry)) ||
            (Array.isArray(entry) && entry.every((item) => typeof item === "string")),
        ),
      );
    }
  } catch {
    // Malformed list state is treated as an empty filter selection.
  }
  return {
    query: params.get("q") ?? "",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    size: PAGE_SIZES.includes(size) ? size : 25,
    filters,
  };
}

function initialRequest(search: string, state: unknown) {
  if (search) return readRequest(search);
  const snapshot = (state as { mksCatalogState?: Partial<MksSearchRequest> } | null)
    ?.mksCatalogState;
  if (!snapshot) return readRequest("");
  const params = new URLSearchParams({
    q: typeof snapshot.query === "string" ? snapshot.query : "",
    page: String(snapshot.page ?? 1),
    size: String(snapshot.size ?? 25),
    filters: JSON.stringify(snapshot.filters ?? {}),
  });
  return readRequest(params.toString());
}

function safeReturnPath(state: unknown) {
  const candidate = (state as { returnTo?: unknown } | null)?.returnTo;
  if (
    typeof candidate !== "string" ||
    !candidate.startsWith("/admin/") ||
    /[\\\x00-\x1f]/.test(candidate)
  ) {
    return "/admin/products";
  }
  try {
    const url = new URL(candidate, window.location.origin);
    return url.origin === window.location.origin && url.pathname !== "/admin/mks-catalog"
      ? `${url.pathname}${url.search}${url.hash}`
      : "/admin/products";
  } catch {
    return "/admin/products";
  }
}

function supplierLink(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "mkskz.master.pro" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function supplierImage(value: string | null) {
  const link = supplierLink(value);
  return link && new URL(link).pathname.startsWith("/dbpics/") ? link : undefined;
}

function FilterField({
  filter,
  value,
  disabled,
  onChange,
}: {
  filter: MksFilter;
  value: MksFilterValue | undefined;
  disabled: boolean;
  onChange: (value: MksFilterValue | undefined) => void;
}) {
  if (filter.type === "boolean") {
    return (
      <div className="mks-catalog__boolean-filter">
        <AppCheckbox
          label={filter.label}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked ? true : undefined)}
        />
      </div>
    );
  }
  if (filter.type === "select" || filter.type === "multiselect") {
    const multiple = filter.type === "multiselect";
    return (
      <AppSelect
        label={filter.label}
        options={filter.options}
        multiple={multiple}
        value={
          multiple ? (Array.isArray(value) ? value : []) : typeof value === "string" ? value : ""
        }
        placeholder="Все значения"
        searchable
        clearable
        disabled={disabled}
        showSelectedTags={false}
        multipleValueDisplay="count"
        onValueChange={(next) => onChange(next.length ? next : undefined)}
      />
    );
  }
  if (filter.type === "number") {
    return (
      <AppNumberInput
        label={filter.label}
        value={typeof value === "number" ? value : ""}
        step="any"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next !== "" && Number.isFinite(Number(next)) ? Number(next) : undefined);
        }}
      />
    );
  }
  return (
    <AppInput
      label={filter.label}
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

export function MksCatalogPage() {
  const { user } = useCommerce();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [request, setRequest] = useState(() => initialRequest(location.search, location.state));
  const [appliedRequest, setAppliedRequest] = useState<MksSearchRequest | null>(null);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [importCategories, setImportCategories] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [filters, setFilters] = useState<MksFilter[]>([]);
  const [result, setResult] = useState<MksSearchResult | null>(null);
  const [busy, setBusy] = useState<"connect" | "search" | null>(null);
  const [error, setError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<MksProduct | null>(null);
  const productOpener = useRef<HTMLElement | null>(null);
  const restored = useRef(false);
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: fetchMksStatus, retry: false });
  const canImport = Boolean(
    user?.permissions.includes("supplier-products.import") &&
    user.permissions.includes("pages.supplier-products.view") &&
    user.permissions.includes("pages.mks.view"),
  );
  const canViewSupplierProducts =
    user?.permissions.includes("pages.supplier-products.view") ?? false;
  const {
    query: queue,
    retry: retryImport,
    syncStatus,
  } = useSupplierImportQueue(user?.id, canImport || canViewSupplierProducts);
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const categoryOptions = filters.find((filter) => filter.id === "catalog")?.options ?? [];
  const importMutation = useMutation({
    mutationFn: (scope: SupplierImportScope) =>
      createSupplierImport({
        supplierCode: "mks",
        scope,
        ...(scope === "SELECTED" ? { productIds: selectedIds } : {}),
        ...(scope === "FILTERED" && appliedRequest
          ? {
              query: appliedRequest.query,
              filters: appliedRequest.filters,
              categoryIds: importCategories,
            }
          : {}),
      }),
    onMutate: () => setImportMessage(""),
    onSuccess: (job) => {
      setImportMessage(
        `Импорт №${job.id} добавлен в очередь. Товары появятся в каталоге поставщиков по мере загрузки.`,
      );
      setRowSelection({});
      void queryClient.invalidateQueries({ queryKey: SUPPLIER_IMPORTS_KEY });
    },
  });
  const canCreate = user?.permissions.includes("products.create") ?? false;
  const controlsDisabled = Boolean(busy) || !status.data?.connected;

  function openProduct(product: MksProduct) {
    productOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedProduct(product);
  }

  function closeProduct() {
    setSelectedProduct(null);
    requestAnimationFrame(() => productOpener.current?.focus({ preventScroll: true }));
  }

  function persist(next: MksSearchRequest) {
    const params = new URLSearchParams();
    if (next.query) params.set("q", next.query);
    params.set("page", String(next.page));
    params.set("size", String(next.size));
    if (Object.keys(next.filters).length) params.set("filters", JSON.stringify(next.filters));
    navigate(
      { pathname: location.pathname, search: `?${params}` },
      { replace: true, state: location.state },
    );
  }

  function edit(next: MksSearchRequest) {
    setRequest(next);
    setResult(null);
    setError("");
    persist(next);
  }

  async function load(next: MksSearchRequest, reconnect = false) {
    if (busy) return;
    setBusy(reconnect ? "connect" : "search");
    setResult(null);
    setError("");
    try {
      if (reconnect) {
        const connected = await connectMks();
        queryClient.setQueryData(STATUS_KEY, connected);
        if (!connected.connected)
          throw new Error(connected.message || "Не удалось подключиться к МКС");
        setBusy("search");
      }
      const data = await searchMks(next);
      setResult(data);
      setFilters(data.filters);
      const applied = { ...next, page: data.page, size: data.size };
      setRequest(applied);
      setAppliedRequest(applied);
      persist(applied);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось получить каталог МКС");
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (status.data?.connected && !restored.current) {
      restored.current = true;
      void load(request);
    }
  }, [status.data?.connected]);

  const columns = useMemo<AppDataTableColumn<MksProduct>[]>(
    () => [
      { id: "sku", header: "Артикул", accessor: "sku", width: 160 },
      {
        id: "name",
        header: "Товар",
        accessor: "name",
        width: 350,
        cell: (item) => (
          <div className="mks-catalog__product">
            {supplierImage(item.imageUrl) && (
              <img
                className="mks-catalog__thumbnail"
                src={supplierImage(item.imageUrl)}
                alt=""
                width={50}
                height={50}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            )}
            <div className="mks-catalog__product-description">
              <strong>{item.name}</strong>
              {item.model && item.model !== item.sku && <span>Модель: {item.model}</span>}
            </div>
          </div>
        ),
      },
      { id: "brand", header: "Бренд", accessor: "brand", cell: (item) => item.brand || "—" },
      {
        id: "price",
        header: "Цена поставщика, ₸",
        accessor: "price",
        align: "right",
        width: 190,
        cell: (item) =>
          item.price === null
            ? "Не указана"
            : new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(item.price),
      },
      {
        id: "availability",
        header: "Наличие у МКС",
        accessor: "availability",
        width: 180,
        cell: (item) => item.availability || "Не указано",
      },
      {
        id: "actions",
        header: "Действия",
        hideable: false,
        width: 230,
        cell: (item) => (
          <div className="mks-catalog__row-actions">
            {canCreate && (
              <AppButton
                type="button"
                variant="secondary"
                onKeyDown={(event) => event.stopPropagation()}
                onClick={() => {
                  navigate("/admin/products/new", {
                    state: {
                      returnTo: `${location.pathname}${location.search}`,
                      mksCatalogState: request,
                      supplierDraft: {
                        sku: item.sku || "",
                        nameRu: item.name,
                        nameKk: item.name,
                        incomingPrice: item.price,
                      },
                    },
                  });
                }}
              >
                Создать под заказ
              </AppButton>
            )}
            <AppButton
              type="button"
              variant="secondary"
              aria-label={`Открыть карточку ${item.name}`}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={() => openProduct(item)}
            >
              Карточка
            </AppButton>
          </div>
        ),
      },
    ],
    [canCreate, navigate, location.pathname, location.search, request],
  );

  if (status.error instanceof ApiError && status.error.status === 403) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <AdminPage
      title="Каталог МКС"
      eyebrow="Товары поставщиков"
      className="mks-catalog"
      backAction={
        <AppButton
          type="button"
          variant="ghost"
          aria-label="Вернуться к товарам"
          onClick={() => navigate(safeReturnPath(location.state))}
        >
          <ArrowLeft size={18} />
        </AppButton>
      }
      actions={
        <a
          href={CATALOG_URL}
          className="mks-catalog__link"
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={17} /> Кабинет поставщика
        </a>
      }
    >
      <AppCard
        title="Подключение к поставщику"
        description="Вход выполняется на сервере. Поиск использует каталог МКС."
        actions={
          <AppBadge tone={status.data?.connected ? "green" : "slate"}>
            {status.isLoading
              ? "Проверяем подключение"
              : status.data?.connected
                ? "Подключено"
                : "Не подключено"}
          </AppBadge>
        }
      >
        <div className="mks-catalog__connection">
          <div className="mks-catalog__connection-description">
            {status.data?.message && <p>{status.data.message}</p>}
            {status.data?.lastConnectedAt && (
              <small>
                Последнее подключение:{" "}
                {new Date(status.data.lastConnectedAt).toLocaleString("ru-KZ", {
                  timeZone: "Asia/Almaty",
                })}{" "}
                (Алматы)
              </small>
            )}
            {status.data && !status.data.configured && (
              <AppAlert title="Нужны учётные данные МКС" tone="warning">
                Обратитесь к администратору для настройки доступа к кабинету поставщика. После
                настройки нажмите «Проверить подключение».
              </AppAlert>
            )}
            {status.error && (
              <AppAlert title="Не удалось проверить подключение" tone="danger">
                {status.error.message}
              </AppAlert>
            )}
          </div>
          <div className="mks-catalog__connection-actions">
            <AppButton
              type="button"
              variant="secondary"
              disabled={Boolean(busy) || status.isFetching}
              onClick={() => void status.refetch()}
            >
              Проверить подключение
            </AppButton>
            <AppButton
              type="button"
              disabled={!status.data?.configured || Boolean(busy)}
              loading={busy === "connect"}
              loadingText="Подключаемся…"
              onClick={() => {
                restored.current = true;
                void load({ ...request, page: 1 }, true);
              }}
            >
              <Plug size={17} />
              {status.data?.connected ? "Переподключить" : "Подключить МКС"}
            </AppButton>
          </div>
        </div>
      </AppCard>

      {(canImport || canViewSupplierProducts) && (
        <SupplierImportQueue
          jobs={queue.data ?? []}
          syncStatus={syncStatus.data}
          syncError={syncStatus.error?.message}
          loading={queue.isFetching}
          error={queue.error?.message}
          updatedAt={queue.dataUpdatedAt}
          canRetry={canImport}
          retryingId={retryImport.isPending ? retryImport.variables : undefined}
          retryError={retryImport.error?.message}
          onRefresh={() => {
            void queue.refetch();
            void syncStatus.refetch();
          }}
          onRetry={(id) => retryImport.mutate(id)}
        />
      )}

      <AppCard
        title="Поиск и фильтры"
        description="Фильтры загружаются из кабинета поставщика после подключения."
      >
        <form
          className="mks-catalog__search-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!controlsDisabled) void load({ ...request, page: 1 });
          }}
        >
          <div className="mks-catalog__search-row">
            <AppSearchInput
              label="Название или артикул"
              placeholder="Поиск по каталогу МКС"
              value={request.query}
              disabled={controlsDisabled}
              onChange={(event) => edit({ ...request, query: event.target.value, page: 1 })}
            />
            <AppSelect
              label="Товаров на странице"
              value={String(request.size)}
              disabled={controlsDisabled}
              onChange={(event) => edit({ ...request, size: Number(event.target.value), page: 1 })}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </AppSelect>
            <AppButton
              type="submit"
              disabled={controlsDisabled}
              loading={busy === "search"}
              loadingText="Ищем…"
            >
              <Search size={17} />
              Найти
            </AppButton>
            <AppButton
              type="button"
              variant="secondary"
              disabled={controlsDisabled}
              onClick={() => edit({ query: "", page: 1, size: request.size, filters: {} })}
            >
              Сбросить
            </AppButton>
          </div>
          {filters.length > 0 && (
            <div className="mks-catalog__filters">
              {filters.map((filter) => (
                <FilterField
                  key={filter.id}
                  filter={filter}
                  value={request.filters[filter.id]}
                  disabled={controlsDisabled}
                  onChange={(value) => {
                    const next = { ...request.filters };
                    if (value === undefined) delete next[filter.id];
                    else next[filter.id] = value;
                    edit({ ...request, page: 1, filters: next });
                  }}
                />
              ))}
            </div>
          )}
          <p className="mks-catalog__hint">
            {!status.data?.connected
              ? "Подключите МКС, чтобы искать товары и получить доступные фильтры."
              : filters.length === 0
                ? "Доступные фильтры появятся после загрузки каталога."
                : "Измените условия и нажмите «Найти»."}
          </p>
        </form>
      </AppCard>

      {error && (
        <AppAlert title="Каталог не загружен" tone="danger">
          {error}
        </AppAlert>
      )}
      {result?.warnings.map((warning, index) => (
        <AppAlert key={`${index}-${warning}`} title="Информация поставщика" tone="warning">
          {warning}
        </AppAlert>
      ))}

      {canImport && (
        <AppCard
          title="Импорт в товары поставщиков"
          description="Выберите отдельные товары, все найденные по фильтрам или весь каталог МКС. Обработка продолжается после ухода со страницы."
        >
          <div className="mks-catalog__import">
            {categoryOptions.length > 0 && (
              <AppSelect
                label="Категории для импорта"
                options={categoryOptions}
                multiple
                searchable
                clearable
                placeholder="По категории из поиска или все категории"
                value={importCategories}
                onValueChange={(value) => setImportCategories(Array.isArray(value) ? value : [])}
                disabled={importMutation.isPending}
                showSelectedTags={false}
                multipleValueDisplay="count"
                hint="Можно выбрать несколько категорий. Они применяются вместе с поиском и остальными найденными фильтрами."
              />
            )}
            <p className="mks-catalog__hint">
              Выбрано товаров: {selectedIds.length}. Выбор сохраняется при переходе между
              страницами. Флажок в заголовке таблицы выбирает только текущую страницу.
            </p>
            <div className="mks-catalog__import-actions">
              <AppButton
                type="button"
                disabled={!selectedIds.length || importMutation.isPending}
                loading={importMutation.isPending && importMutation.variables === "SELECTED"}
                onClick={() => importMutation.mutate("SELECTED")}
              >
                Импортировать выбранные ({selectedIds.length})
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                disabled={!result || !appliedRequest || Boolean(busy) || importMutation.isPending}
                loading={importMutation.isPending && importMutation.variables === "FILTERED"}
                onClick={() => importMutation.mutate("FILTERED")}
              >
                {importCategories.length
                  ? `Импортировать категории (${importCategories.length})`
                  : "Импортировать все по фильтрам"}
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                disabled={!status.data?.configured || importMutation.isPending}
                loading={importMutation.isPending && importMutation.variables === "ALL"}
                onClick={() => importMutation.mutate("ALL")}
              >
                Импортировать весь каталог МКС
              </AppButton>
              {selectedIds.length > 0 && (
                <AppButton
                  type="button"
                  variant="ghost"
                  disabled={importMutation.isPending}
                  onClick={() => setRowSelection({})}
                >
                  Снять выбор
                </AppButton>
              )}
            </div>
            <p className="mks-catalog__hint">
              «Все по фильтрам» включает товары со всех страниц результата. «Весь каталог МКС»
              включает все категории без ограничений поиска.
            </p>
            {importMessage && (
              <AppAlert tone="success" title="Импорт запланирован">
                {importMessage}
                {canViewSupplierProducts && (
                  <AppButton
                    type="button"
                    variant="secondary"
                    onClick={() => navigate("/admin/products/suppliers")}
                  >
                    Открыть товары поставщиков
                  </AppButton>
                )}
              </AppAlert>
            )}
            {importMutation.error && (
              <AppAlert tone="danger" title="Не удалось добавить импорт">
                {importMutation.error.message}
              </AppAlert>
            )}
          </div>
        </AppCard>
      )}

      <AppCard
        title="Товары поставщика"
        description={
          canCreate
            ? "Нажмите на товар, чтобы открыть карточку. «Создать под заказ» откроет черновик: укажите цену продажи, сроки и проверьте данные перед публикацией."
            : "Нажмите на товар, чтобы открыть карточку. Цены и наличие относятся к поставщику и требуют проверки перед подтверждением заказа."
        }
      >
        <AppDataTable
          data={result?.items ?? []}
          columns={columns}
          rowId={(item) => item.id}
          onRowClick={openProduct}
          searchable={false}
          selectable={canImport && !importMutation.isPending}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          showSelectionSummary={false}
          pagination={false}
          mode="client"
          loading={Boolean(busy)}
          emptyTitle={result ? "Товары не найдены" : "Каталог ещё не загружен"}
          emptyDescription={
            result
              ? "Измените поиск или фильтры и повторите запрос."
              : "Подключите МКС или нажмите «Найти», чтобы загрузить товары."
          }
        />
        {result && (
          <div className="mks-catalog__pagination">
            <p>
              Страница {result.page}
              {result.totalPages !== null && result.totalPages > 0
                ? ` из ${result.totalPages}`
                : ""}
              <span>
                На странице: {result.items.length}
                {result.totalItems !== null
                  ? ` · Всего: ${result.totalItems}`
                  : " · Общее количество не предоставлено МКС"}
              </span>
            </p>
            <div className="mks-catalog__page-actions">
              <AppButton
                type="button"
                variant="secondary"
                disabled={Boolean(busy) || result.page <= 1}
                onClick={() => void load({ ...request, page: result.page - 1 })}
              >
                <ChevronLeft size={17} />
                Назад
              </AppButton>
              <AppButton
                type="button"
                variant="secondary"
                disabled={Boolean(busy) || !result.hasMore}
                onClick={() => void load({ ...request, page: result.page + 1 })}
              >
                Далее
                <ChevronRight size={17} />
              </AppButton>
            </div>
          </div>
        )}
      </AppCard>
      {selectedProduct && (
        <MksProductModal
          key={selectedProduct.id}
          product={selectedProduct}
          userId={user?.id}
          onClose={closeProduct}
        />
      )}
    </AdminPage>
  );
}
