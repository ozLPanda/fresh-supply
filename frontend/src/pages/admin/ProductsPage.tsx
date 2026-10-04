import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SortingState, VisibilityState } from "@tanstack/react-table";
import {
  Check,
  Edit,
  EyeOff,
  FileSpreadsheet,
  Filter,
  ImageOff,
  Plus,
  Trash2,
  Truck,
} from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/shared/api/http";
import {
  fetchAllCategories,
  fetchProductCatalogAnalytics,
  fetchProductPage,
} from "@/shared/api/catalog";
import { Category, PagedResult, Product, ProductImage } from "@/shared/types/models";
import { AdminPage } from "@/layouts/AdminPage";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { reconcileProductImageCache, productImageUrl } from "@/shared/images/imageCache";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton } from "@/shared/ui/AppButton";
import { type AppContextMenuAction } from "@/shared/ui/AppContextMenu";
import {
  AppDataTable,
  type AppDataTableColumn,
  type AppDataTableDensity,
  type AppDataTableFilterValues,
} from "@/shared/ui/AppDataTable";
import { DataPanel } from "@/shared/ui/DataPanel";
import { AppAlert, AppModal } from "@/shared/ui/AppFeedback";
import { MetricCard } from "@/shared/ui/MetricCard";
import { appToast } from "@/shared/ui/AppToast";
import "./ProductsPage.css";

const PRODUCTS_TABLE_STATE_KEY = "admin-products-table-state-v1";

type ProductsTableState = {
  search: string;
  page: number;
  pageSize: number;
  sorting: SortingState;
  filterValues: AppDataTableFilterValues;
  density: AppDataTableDensity;
  columnVisibility: VisibilityState;
  scrollY: number;
};

type ProductsPageLocationState = {
  productsTableState?: ProductsTableState;
};

type ProductImageDeleteTarget = {
  productId: number;
  productName: string;
  imageId: number;
};

type ProductAvailabilityStatus = "HIDDEN" | "MADE_TO_ORDER" | "AVAILABLE";

const DEFAULT_PRODUCTS_TABLE_STATE: ProductsTableState = {
  search: "",
  page: 1,
  pageSize: 10,
  sorting: [{ id: "nameRu", desc: false }],
  filterValues: {},
  density: "default",
  columnVisibility: {},
  scrollY: 0,
};

function getProductsTableState(): ProductsTableState {
  try {
    const saved = window.sessionStorage.getItem(PRODUCTS_TABLE_STATE_KEY);
    if (!saved) return DEFAULT_PRODUCTS_TABLE_STATE;
    const value = JSON.parse(saved) as Partial<ProductsTableState>;

    return {
      search: typeof value.search === "string" ? value.search : "",
      page: Number.isInteger(value.page) && value.page! > 0 ? value.page! : 1,
      pageSize: Number.isInteger(value.pageSize) && value.pageSize! > 0 ? value.pageSize! : 10,
      sorting: Array.isArray(value.sorting)
        ? value.sorting.filter(
            (item): item is { id: string; desc: boolean } =>
              typeof item?.id === "string" && typeof item.desc === "boolean",
          )
        : DEFAULT_PRODUCTS_TABLE_STATE.sorting,
      filterValues:
        value.filterValues && typeof value.filterValues === "object"
          ? Object.fromEntries(
              Object.entries(value.filterValues).filter(
                ([key, values]) =>
                  typeof key === "string" &&
                  Array.isArray(values) &&
                  values.every((item) => typeof item === "string"),
              ),
            )
          : {},
      density:
        value.density === "compact" || value.density === "comfortable" ? value.density : "default",
      columnVisibility:
        value.columnVisibility && typeof value.columnVisibility === "object"
          ? value.columnVisibility
          : {},
      scrollY: typeof value.scrollY === "number" && value.scrollY > 0 ? value.scrollY : 0,
    };
  } catch {
    return DEFAULT_PRODUCTS_TABLE_STATE;
  }
}

function imageStack(images: ProductImage[] | undefined) {
  if (!images?.length) return [];
  const mainImage = images.find((image) => image.mainImage);
  return mainImage ? [mainImage, ...images.filter((image) => image.id !== mainImage.id)] : images;
}

function availabilityStatus(product: Product): ProductAvailabilityStatus {
  if (!product.active) return "HIDDEN";
  return product.madeToOrder ? "MADE_TO_ORDER" : "AVAILABLE";
}

function availabilityStatusLabel(status: ProductAvailabilityStatus) {
  switch (status) {
    case "HIDDEN":
      return "Скрыт";
    case "MADE_TO_ORDER":
      return "Под заказ";
    case "AVAILABLE":
      return "В наличии";
  }
}

export function ProductsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useCommerce();
  const showingMissingIncomingPrices = searchParams.get("missingIncomingPrice") === "true";
  const initialState = useRef(
    (location.state as ProductsPageLocationState | null)?.productsTableState ??
      getProductsTableState(),
  ).current;
  const [search, setSearch] = useState(initialState.search);
  const [page, setPage] = useState(initialState.page);
  const [pageSize, setPageSize] = useState(initialState.pageSize);
  const [sorting, setSorting] = useState<SortingState>(initialState.sorting);
  const [filterValues, setFilterValues] = useState<AppDataTableFilterValues>(
    initialState.filterValues,
  );
  const [density, setDensity] = useState<AppDataTableDensity>(initialState.density);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    initialState.columnVisibility,
  );
  const [imageToDelete, setImageToDelete] = useState<ProductImageDeleteTarget | null>(null);
  const stateRef = useRef<ProductsTableState>(initialState);
  const scrollRestoredRef = useRef(false);
  const tablePanelRef = useRef<HTMLDivElement>(null);

  const categoriesQuery = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => fetchAllCategories(),
  });
  const tableFilters = useMemo(() => {
    const categoryFilter =
      filterValues.category?.length === 1 ? filterValues.category[0] : undefined;
    const statusFilter = filterValues.active?.length === 1 ? filterValues.active[0] : undefined;

    return {
      excludeImportCreated: true,
      missingIncomingPrice: showingMissingIncomingPrices || undefined,
      search: search || undefined,
      category: categoryFilter || undefined,
      active: statusFilter === "active" ? true : statusFilter === "hidden" ? false : undefined,
    };
  }, [filterValues, search, showingMissingIncomingPrices]);
  const productsQuery = useQuery({
    queryKey: [
      "products",
      "admin",
      search,
      page,
      pageSize,
      sorting,
      filterValues,
      showingMissingIncomingPrices,
    ],
    queryFn: () => {
      const sortId = sorting[0]?.id ?? "nameRu";

      return fetchProductPage({
        ...tableFilters,
        // The admin catalogue must search the catalogue text directly. Semantic search is
        // useful for the storefront, but makes exact product names disappear among similar ones.
        lexicalOnly: true,
        page,
        size: pageSize,
        sort: sortId === "category" ? "categoryNameRu" : sortId,
        direction: sorting[0]?.desc ? "desc" : "asc",
      });
    },
  });
  const analyticsQuery = useQuery({
    queryKey: ["products", "admin", "analytics", tableFilters],
    queryFn: () => fetchProductCatalogAnalytics(tableFilters),
  });

  const data = productsQuery.data?.items ?? [];
  const categories = categoriesQuery.data ?? [];

  stateRef.current = {
    search,
    page,
    pageSize,
    sorting,
    filterValues,
    density,
    columnVisibility,
    scrollY: window.scrollY,
  };

  function persistTableState() {
    window.sessionStorage.setItem(
      PRODUCTS_TABLE_STATE_KEY,
      JSON.stringify({ ...stateRef.current, scrollY: window.scrollY }),
    );
  }

  function openProduct(productId: number) {
    const productsTableState = { ...stateRef.current, scrollY: window.scrollY };
    window.sessionStorage.setItem(PRODUCTS_TABLE_STATE_KEY, JSON.stringify(productsTableState));
    navigate(`/admin/products/${productId}`, {
      state: { returnTo: `${location.pathname}${location.search}`, productsTableState },
    });
  }

  useEffect(
    () => () => {
      persistTableState();
    },
    [],
  );

  useEffect(() => {
    setPage(1);
  }, [showingMissingIncomingPrices]);

  useEffect(() => {
    if (
      scrollRestoredRef.current ||
      initialState.scrollY === 0 ||
      !productsQuery.isSuccess ||
      productsQuery.isFetching ||
      data.length === 0
    ) {
      return;
    }

    const tablePanel = tablePanelRef.current;
    if (!tablePanel) return;

    let frame = 0;
    const observer = new ResizeObserver(() => scheduleRestore());
    const restoreScroll = () => {
      const documentHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      const maximumScrollY = Math.max(0, documentHeight - window.innerHeight);
      if (maximumScrollY + 1 < initialState.scrollY) return;

      window.scrollTo({ top: initialState.scrollY, left: 0, behavior: "auto" });

      if (Math.abs(window.scrollY - initialState.scrollY) > 1) {
        frame = window.requestAnimationFrame(restoreScroll);
        return;
      }
      scrollRestoredRef.current = true;
      observer.disconnect();
    };

    function scheduleRestore() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(restoreScroll);
    }

    observer.observe(tablePanel);
    scheduleRestore();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [data.length, initialState.scrollY, productsQuery.isFetching, productsQuery.isSuccess]);

  const remove = useMutation({
    mutationFn: (id: number) => api(`/api/products/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  const removeImage = useMutation({
    mutationFn: ({ productId, imageId }: ProductImageDeleteTarget) =>
      api<ProductImage[]>(`/api/products/${productId}/images/${imageId}`, { method: "DELETE" }),
    onSuccess: (images, target) => {
      let updatedProduct: Product | null = null;
      queryClient.setQueriesData<PagedResult<Product>>(
        { queryKey: ["products", "admin"] },
        (current) => {
          // This key prefix also matches the catalogue analytics query, whose response
          // has no `items` array. Only table-page cache entries can be updated here.
          if (!current || !Array.isArray(current.items)) return current;
          return {
            ...current,
            items: current.items.map((product) => {
              if (product.id !== target.productId) return product;
              updatedProduct = { ...product, images };
              return updatedProduct;
            }),
          };
        },
      );
      if (updatedProduct) reconcileProductImageCache([updatedProduct]);
      setImageToDelete(null);
      appToast.success("Изображение удалено");
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось удалить изображение"),
  });

  const updateAvailabilityStatus = useMutation({
    mutationFn: ({ productId, status }: { productId: number; status: ProductAvailabilityStatus }) =>
      api<Product>(`/api/products/${productId}/availability-status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      appToast.success(`Статус товара: ${availabilityStatusLabel(variables.status)}`);
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось изменить статус товара"),
  });

  const categoryOptions = useMemo(
    () =>
      categories.map((category: Category) => ({
        value: String(category.id),
        label: category.nameRu,
      })),
    [categories],
  );
  const canUpdateProducts = user?.permissions.includes("products.update") ?? false;
  const canDeleteProducts = user?.permissions.includes("products.delete") ?? false;

  function productActions(product: Product): AppContextMenuAction[] {
    const status = availabilityStatus(product);
    return [
      ...(canUpdateProducts
        ? [
            {
              label: "Редактировать",
              icon: <Edit size={17} />,
              onSelect: () => product.id && openProduct(product.id),
            },
            {
              label: "В наличии",
              icon: <Check size={17} />,
              disabled: updateAvailabilityStatus.isPending || status === "AVAILABLE",
              onSelect: () =>
                product.id &&
                updateAvailabilityStatus.mutate({ productId: product.id, status: "AVAILABLE" }),
            },
            {
              label: "Под заказ",
              icon: <Truck size={17} />,
              disabled: updateAvailabilityStatus.isPending || status === "MADE_TO_ORDER",
              onSelect: () =>
                product.id &&
                updateAvailabilityStatus.mutate({ productId: product.id, status: "MADE_TO_ORDER" }),
            },
            {
              label: "Скрыть товар",
              icon: <EyeOff size={17} />,
              disabled: updateAvailabilityStatus.isPending || status === "HIDDEN",
              onSelect: () =>
                product.id &&
                updateAvailabilityStatus.mutate({ productId: product.id, status: "HIDDEN" }),
            },
          ]
        : []),
      ...(canDeleteProducts
        ? [
            {
              label: "Удалить",
              icon: <Trash2 size={17} />,
              disabled: !product.id || remove.isPending,
              destructive: true,
              separatorBefore: canUpdateProducts,
              onSelect: () => product.id && remove.mutate(product.id),
            },
          ]
        : []),
    ];
  }

  const columns: AppDataTableColumn<Product>[] = [
    {
      id: "images",
      header: "Фото",
      width: 82,
      hideable: false,
      searchable: false,
      cell: (product) => {
        const images = imageStack(product.images);
        const displayedImage = images[0];
        if (!displayedImage) {
          return (
            <span className="products-page__image-placeholder" title="У товара нет изображений">
              <ImageOff size={18} aria-hidden="true" />
            </span>
          );
        }

        const visibleImages = images.slice(0, 3);
        return (
          <button
            type="button"
            className={`products-page__image-stack${images.length > 1 ? " has-multiple" : ""}`}
            onClick={() => product.id && openProduct(product.id)}
            onContextMenu={(event) => {
              if (!canUpdateProducts || !product.id) return;
              event.preventDefault();
              setImageToDelete({
                productId: product.id,
                productName: product.nameRu,
                imageId: displayedImage.id,
              });
            }}
            title={
              canUpdateProducts
                ? "Нажмите, чтобы открыть товар. Правой кнопкой мыши — удалить текущее изображение"
                : "Нажмите, чтобы открыть товар"
            }
            aria-label={`Изображения товара: ${product.nameRu}. ${
              canUpdateProducts ? "Правая кнопка мыши удаляет текущее изображение." : ""
            }`}
          >
            {[...visibleImages].reverse().map((image, index) => {
              const offset = (visibleImages.length - index - 1) * 4;
              return (
                <img
                  key={image.id}
                  src={productImageUrl(image) ?? ""}
                  alt=""
                  style={{ transform: `translate(${offset}px, ${offset}px)` }}
                />
              );
            })}
            {images.length > 1 && (
              <span className="products-page__image-count">{images.length}</span>
            )}
          </button>
        );
      },
    },
    {
      id: "sku",
      header: "Артикул",
      accessor: "sku",
      sortable: true,
      width: 130,
      cell: (product) => <code>{product.sku}</code>,
    },
    {
      id: "nameRu",
      header: "Название",
      accessor: "nameRu",
      sortable: true,
      cell: (product) => (
        <strong
          className="products-page__name"
          onDoubleClick={() => product.id && openProduct(product.id)}
          title="Дважды щелкните, чтобы открыть карточку товара"
        >
          {product.nameRu}
        </strong>
      ),
    },
    {
      id: "category",
      header: "Категория",
      value: (product) => product.categoryId ?? "",
      sortable: true,
      filterable: true,
      filterOptions: categoryOptions,
      cell: (product) => product.categoryNameRu ?? "Без категории",
    },
    {
      id: "price",
      header: "Цена",
      accessor: "price",
      sortable: true,
      align: "right",
      cell: (product) => (
        <code className="products-page__price">
          {product.price === null
            ? "—"
            : `${new Intl.NumberFormat("ru-KZ").format(product.price)} ₸`}
        </code>
      ),
    },
    {
      id: "active",
      header: "Статус",
      value: (product) => (product.active ? "active" : "hidden"),
      sortable: true,
      filterable: true,
      filterOptions: [
        { value: "active", label: "Активные" },
        { value: "hidden", label: "Скрытые" },
      ],
      cell: (product) => (
        <AppBadge
          tone={
            availabilityStatus(product) === "AVAILABLE"
              ? "green"
              : availabilityStatus(product) === "MADE_TO_ORDER"
                ? "orange"
                : "slate"
          }
        >
          {availabilityStatusLabel(availabilityStatus(product))}
        </AppBadge>
      ),
    },
    {
      id: "actions",
      header: "",
      hideable: false,
      width: 56,
      align: "right",
      cell: (product) => {
        const actions = productActions(product);
        return actions.length > 0 ? (
          <AppActionMenu label={`Действия: ${product.nameRu}`} actions={actions} />
        ) : null;
      },
    },
  ];

  return (
    <AdminPage
      eyebrow="Товары и услуги"
      title={showingMissingIncomingPrices ? "Товары без приходной цены" : "Управление товарами"}
      actions={
        <>
          <AppButton asChild variant="secondary">
            <Link to="/admin/products/import-prices">
              <FileSpreadsheet size={18} />
              Импортировать прайс
            </Link>
          </AppButton>
          <AppButton asChild>
            <Link to="/admin/products/new">
              <Plus size={18} />
              Создать товар
            </Link>
          </AppButton>
        </>
      }
    >
      <div className="metric-grid">
        <MetricCard
          icon={<Plus size={18} />}
          label="Всего товаров"
          value={analyticsQuery.data?.totalItems ?? 0}
          size="compact"
        />
        <MetricCard
          icon={<Filter size={18} />}
          label="Без категории"
          value={analyticsQuery.data?.withoutCategory ?? 0}
          accent
          size="compact"
        />
        <MetricCard
          icon={<Edit size={18} />}
          label="Активные"
          value={analyticsQuery.data?.activeItems ?? 0}
          size="compact"
        />
        <MetricCard
          icon={<Trash2 size={18} />}
          label="Требуют фото"
          value={analyticsQuery.data?.withoutImages ?? 0}
          size="compact"
        />
      </div>

      {(showingMissingIncomingPrices || (analyticsQuery.data?.withoutIncomingPrice ?? 0) > 0) && (
        <div className="products-page__incoming-warning">
          <AppAlert
            title={`У ${analyticsQuery.data?.withoutIncomingPrice ?? 0} товаров не указана приходная цена`}
            tone="warning"
          >
            {showingMissingIncomingPrices
              ? "Откройте карточку товара через меню действий и заполните приходную цену."
              : "Без неё нельзя корректно рассчитать чистую прибыль и динамику закупочных цен."}
          </AppAlert>
          <AppButton asChild variant="secondary">
            <Link
              to={
                showingMissingIncomingPrices
                  ? "/admin/products"
                  : "/admin/products?missingIncomingPrice=true"
              }
            >
              {showingMissingIncomingPrices ? "Все товары" : "Открыть таблицу"}
            </Link>
          </AppButton>
        </div>
      )}

      <div ref={tablePanelRef}>
        <DataPanel title={showingMissingIncomingPrices ? "Без приходной цены" : "Каталог товаров"}>
          <AppDataTable
            data={data}
            columns={columns}
            rowId={(product) => String(product.id ?? product.sku)}
            loading={productsQuery.isLoading}
            selectable={false}
            mode="server"
            defaultPageSize={10}
            searchValue={search}
            onSearchChange={setSearch}
            filterValues={filterValues}
            onFilterValuesChange={setFilterValues}
            sortingState={sorting}
            onSortingStateChange={setSorting}
            density={density}
            onDensityChange={setDensity}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            contextMenuActions={canUpdateProducts || canDeleteProducts ? productActions : undefined}
            contextMenuLabel={(product) => `Действия: ${product.nameRu}`}
            page={productsQuery.data?.page ?? page}
            pageSize={productsQuery.data?.size ?? pageSize}
            totalItems={productsQuery.data?.totalItems ?? 0}
            totalPages={productsQuery.data?.totalPages ?? 1}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            emptyTitle="Товары не найдены"
            emptyDescription="Измените поиск или фильтры либо создайте новый товар."
          />
        </DataPanel>
      </div>

      <AppModal
        open={imageToDelete !== null}
        onOpenChange={(open) => !open && setImageToDelete(null)}
        title="Удалить изображение?"
        description={
          imageToDelete
            ? `Изображение товара «${imageToDelete.productName}» будет удалено без возможности восстановления.`
            : undefined
        }
      >
        <div className="products-page__image-delete-actions">
          <AppButton variant="secondary" onClick={() => setImageToDelete(null)}>
            Отмена
          </AppButton>
          <AppButton
            variant="danger"
            loading={removeImage.isPending}
            onClick={() => imageToDelete && removeImage.mutate(imageToDelete)}
          >
            Удалить
          </AppButton>
        </div>
      </AppModal>
    </AdminPage>
  );
}
