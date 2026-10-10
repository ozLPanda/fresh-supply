import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Info,
  Pencil,
  Plus,
  ScanLine,
  Warehouse,
  X,
} from "lucide-react";
import { fetchProductPage } from "@/shared/api/catalog";
import { API_URL } from "@/shared/api/http";
import { WarehouseBalance } from "@/shared/api/warehouse";
import { Product } from "@/shared/types/models";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppActionMenu, AppButton, type AppSplitButtonAction } from "@/shared/ui/AppButton";
import { AppDataTable, type AppDataTableColumn } from "@/shared/ui/AppDataTable";
import { AppModal } from "@/shared/ui/AppFeedback";
import { AppInput, AppSearchInput } from "@/shared/ui/AppField";
import { formatMoney } from "@/pages/public/store-utils";
import { OrderProductAvailability } from "./OrderProductAvailability";
import { normalizeOrderQuantity, OrderQuantityInput } from "./OrderQuantityInput";
import { BarcodeScannerModal } from "@/features/barcodeScanner/BarcodeScannerModal";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { ProductCreateModal } from "@/shared/components/products/ProductCreateModal";
import "./OrderProductPickerModal.css";

export type OrderProductPickerPriceTier =
  | "RETAIL"
  | "WHOLESALE"
  | "BULK_WHOLESALE"
  | "SKO"
  | "GSKO"
  | "INCOMING";

const inventoryQuantityFormatter = new Intl.NumberFormat("ru-KZ", {
  maximumFractionDigits: 3,
});

function priceForTier(product: Product, priceTier: OrderProductPickerPriceTier) {
  if (priceTier === "WHOLESALE") return product.wholesalePrice ?? null;
  if (priceTier === "BULK_WHOLESALE") return product.bulkWholesalePrice ?? null;
  if (priceTier === "SKO") return product.skoPrice ?? null;
  if (priceTier === "GSKO") return product.gskoPrice ?? null;
  if (priceTier === "INCOMING") return product.incomingPrice ?? null;
  return product.price;
}

function imageUrl(product: Product) {
  const filePath = product.images?.find((image) => image.mainImage)?.filePath;
  if (!filePath) return null;
  return /^https?:\/\//i.test(filePath)
    ? filePath
    : `${API_URL}${filePath.startsWith("/") ? filePath : `/${filePath}`}`;
}

export function OrderProductPickerModal({
  open,
  onOpenChange,
  priceTier,
  onAdd,
  onEditProduct,
  showQuantityPicker = false,
  quantityInOrder,
  quantityInOrderLabel = "В заказе",
  destinationName = "заказ",
  minQuantity,
  maxQuantity,
  addingProductId,
  allowMissingPrice = false,
  showAvailability = false,
  mobileAvailabilityOnly = false,
  showStock = false,
  stockByProductId,
  stockLoading = false,
  inventoryMode = false,
  isProductInDocument,
  inventoryCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priceTier: OrderProductPickerPriceTier;
  onAdd: (product: Product, quantity?: number) => boolean | void | Promise<unknown>;
  /** Открывает редактор товара из меню доступных действий. */
  onEditProduct?: (product: Product) => void;
  /** Показывает ввод количества непосредственно перед добавлением товара. */
  showQuantityPicker?: boolean;
  /** Возвращает уже добавленное количество товара. */
  quantityInOrder?: (product: Product) => number;
  quantityInOrderLabel?: string;
  destinationName?: string;
  minQuantity?: number;
  maxQuantity?: number;
  addingProductId?: number | null;
  /** Для внутренних документов товар можно выбрать без установленной цены продажи. */
  allowMissingPrice?: boolean;
  /** Показывает внутренние сведения о доступности при создании заказа. */
  showAvailability?: boolean;
  /** Добавляет сведения об остатках на телефоне, сохраняя прежний вид таблицы ПК. */
  mobileAvailabilityOnly?: boolean;
  /** Показывает остатки только пользователю с правом просмотра склада. */
  showStock?: boolean;
  stockByProductId?: ReadonlyMap<number, WarehouseBalance>;
  stockLoading?: boolean;
  /** Фактическое количество заменяет прежнее значение, включая ноль. */
  inventoryMode?: boolean;
  /** Отличает уже выбранный товар с нулевым количеством от отсутствующего. */
  isProductInDocument?: (product: Product) => boolean;
  /** Общее число позиций инвентаризации, в том числе с нулевым количеством. */
  inventoryCount?: number;
}) {
  const { user } = useCommerce();
  const queryClient = useQueryClient();
  const canCreateProduct = user?.permissions.includes("products.create") ?? false;
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const scrollSnapshotRef = useRef<{ element: HTMLElement; top: number; left: number }[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [compactInventory, setCompactInventory] = useState(
    () => window.matchMedia("(max-width: 960px)").matches,
  );
  const [compactOrders, setCompactOrders] = useState(
    () => window.matchMedia("(max-width: 767px)").matches,
  );
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 960px)");
    const syncLayout = () => setCompactInventory(mediaQuery.matches);
    mediaQuery.addEventListener("change", syncLayout);
    return () => mediaQuery.removeEventListener("change", syncLayout);
  }, []);
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const syncLayout = () => setCompactOrders(mediaQuery.matches);
    mediaQuery.addEventListener("change", syncLayout);
    return () => mediaQuery.removeEventListener("change", syncLayout);
  }, []);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pendingBarcode, setPendingBarcode] = useState<string | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [quantityByProductId, setQuantityByProductId] = useState<Record<number, number>>({});
  const [inventoryQuantityByProductId, setInventoryQuantityByProductId] = useState<
    Record<number, string>
  >({});
  const [addedProductId, setAddedProductId] = useState<number | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [localAddingProductId, setLocalAddingProductId] = useState<number | null>(null);
  const addPendingRef = useRef(false);
  const [addFeedback, setAddFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const busyProductId = addingProductId ?? localAddingProductId;
  const productsQuery = useQuery({
    queryKey: ["products", "order-picker", search, page, pageSize],
    queryFn: () =>
      fetchProductPage({
        page,
        size: pageSize,
        search: search.trim() || undefined,
        active: true,
        excludeImportCreated: true,
        lexicalOnly: true,
        sort: "nameRu",
        direction: "asc",
      }),
    enabled: open && (!inventoryMode || !compactInventory),
  });
  const inventoryProductsQuery = useInfiniteQuery({
    queryKey: ["products", "inventory-picker", search.trim()],
    queryFn: ({ pageParam }) =>
      fetchProductPage({
        page: pageParam,
        size: 20,
        search: search.trim() || undefined,
        active: true,
        excludeImportCreated: true,
        lexicalOnly: true,
        sort: "nameRu",
        direction: "asc",
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    enabled: open && inventoryMode && compactInventory,
  });
  const inventoryProducts = useMemo(
    () =>
      compactInventory
        ? (inventoryProductsQuery.data?.pages.flatMap((result) => result.items) ?? [])
        : (productsQuery.data?.items ?? []),
    [compactInventory, inventoryProductsQuery.data, productsQuery.data],
  );
  const inventoryFetching = compactInventory
    ? inventoryProductsQuery.isFetching
    : productsQuery.isFetching;

  useEffect(() => {
    if (!open) {
      setCreateProductOpen(false);
      scrollSnapshotRef.current = [];
      setSearch("");
      setPage(1);
      setQuantityByProductId({});
      setInventoryQuantityByProductId({});
      setAddedProductId(null);
      setDetailProduct(null);
      setAddFeedback(null);
      setExpandedProductId(null);
      setPendingBarcode(null);
      setBarcodeError(null);
      setScannerOpen(false);
    }
  }, [open]);

  function restorePickerPosition() {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const { element, top, left } of scrollSnapshotRef.current) {
          if (!element.isConnected) continue;
          element.scrollTop = top;
          element.scrollLeft = left;
        }
        createButtonRef.current?.focus({ preventScroll: true });
      }),
    );
  }

  function changeCreatorOpen(next: boolean) {
    if (next) {
      scrollSnapshotRef.current = Array.from(
        pickerRef.current?.querySelectorAll<HTMLElement>(
          ".app-data-table__scroll, .order-product-picker__order-list, .order-product-picker__mobile-list",
        ) ?? [],
      ).map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    }
    setCreateProductOpen(next);
    if (!next) restorePickerPosition();
  }

  function refreshCreatedProduct() {
    // Existing query keys and cached rows keep the picker mounted during refresh.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["import-created-products"] }),
    ]).finally(restorePickerPosition);
  }

  const createProductButton = canCreateProduct ? (
    <AppButton
      ref={createButtonRef}
      type="button"
      variant="primary"
      className="order-product-picker__create"
      onClick={() => changeCreatorOpen(true)}
    >
      <Plus size={18} aria-hidden="true" />
      Создать товар
    </AppButton>
  ) : null;

  useEffect(() => {
    if (!pendingBarcode || inventoryFetching || search.trim() !== pendingBarcode) {
      return;
    }
    const product = inventoryProducts.find(
      (item) => item.sku.trim().toLocaleLowerCase() === pendingBarcode.toLocaleLowerCase(),
    );
    setPendingBarcode(null);
    if (!product?.id) {
      setBarcodeError("Товар с таким штрихкодом или артикулом не найден");
      return;
    }
    setBarcodeError(null);
    setExpandedProductId(product.id);
    requestAnimationFrame(() =>
      document.getElementById(`inventory-product-quantity-${product.id}`)?.focus(),
    );
  }, [inventoryProducts, inventoryFetching, pendingBarcode, search]);

  function quantityToAdd(product: Product) {
    if (!product.id) return 1;
    return quantityByProductId[product.id] ?? 1;
  }

  function updateQuantityToAdd(productId: number, value: number) {
    const normalized = normalizeOrderQuantity(value, 1, maxQuantity, minQuantity);
    setQuantityByProductId((current) => ({ ...current, [productId]: normalized }));
  }

  function inventoryQuantityText(product: Product) {
    if (!product.id) return "";
    return (
      inventoryQuantityByProductId[product.id] ??
      (inventoryProductSelected(product) ? String(quantityInOrder?.(product) ?? 0) : "1")
    );
  }

  function updateInventoryQuantity(productId: number, value: string) {
    if (/^\d*(?:[.,]\d{0,3})?$/.test(value)) {
      setInventoryQuantityByProductId((current) => ({ ...current, [productId]: value }));
    }
  }

  function parsedInventoryQuantity(product: Product) {
    const value = inventoryQuantityText(product);
    if (!value || /[.,]$/.test(value)) return null;
    const quantity = Number(value.replace(",", "."));
    if (
      !Number.isFinite(quantity) ||
      quantity < (minQuantity ?? 0) ||
      quantity > (maxQuantity ?? Infinity)
    ) {
      return null;
    }
    return quantity;
  }

  function inventoryProductSelected(product: Product) {
    return isProductInDocument?.(product) ?? (quantityInOrder?.(product) ?? 0) > 0;
  }

  function inventoryQuantityLabel(product: Product) {
    return inventoryQuantityFormatter.format(quantityInOrder?.(product) ?? 0);
  }

  function markProductAdded(productId: number) {
    setAddedProductId(productId);
    window.setTimeout(() => {
      setAddedProductId((current) => (current === productId ? null : current));
    }, 1_800);
  }

  async function addProduct(product: Product, quantity: number) {
    if (addPendingRef.current || addingProductId != null) return false;
    addPendingRef.current = true;
    setLocalAddingProductId(product.id ?? null);
    setAddFeedback(null);
    try {
      const result = await onAdd(product, quantity);
      if (result === false) {
        setAddFeedback({
          message: "Товар не добавлен. Проверьте сообщение об ошибке и повторите действие.",
          error: true,
        });
        return false;
      }
      if (product.id) markProductAdded(product.id);
      setAddFeedback({
        message: inventoryMode
          ? `Количество установлено: ${inventoryQuantityFormatter.format(quantity)} · ${product.nameRu}`
          : `Добавлено: ${inventoryQuantityFormatter.format(quantity)} · ${product.nameRu}`,
        error: false,
      });
      return true;
    } catch {
      setAddFeedback({
        message: "Не удалось добавить товар. Повторите действие.",
        error: true,
      });
      return false;
    } finally {
      addPendingRef.current = false;
      setLocalAddingProductId(null);
    }
  }

  async function setInventoryQuantity(product: Product, quantity: number) {
    if (!(await addProduct(product, quantity))) return;
    setExpandedProductId(null);
    setInventoryQuantityByProductId((current) => {
      const next = { ...current };
      if (product.id) delete next[product.id];
      return next;
    });
    setSearch("");
    setPage(1);
    setBarcodeError(null);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function searchBarcode(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    setScannerOpen(false);
    setBarcodeError(null);
    setExpandedProductId(null);
    setPendingBarcode(code);
    setSearch(code);
    setPage(1);
  }

  function productActions(product: Product): AppSplitButtonAction[] {
    return [
      {
        label: "Карточка товара",
        icon: <Info size={17} />,
        onSelect: () => setDetailProduct(product),
      },
      ...(onEditProduct && product.id
        ? [
            {
              label: "Редактировать товар",
              icon: <Pencil size={17} />,
              onSelect: () => onEditProduct?.(product),
            },
          ]
        : []),
      ...(showAvailability && showStock
        ? [
            {
              label: "Складские сведения",
              icon: <Warehouse size={17} />,
              onSelect: () => setDetailProduct(product),
            },
          ]
        : []),
    ];
  }

  function renderAvailability(product: Product) {
    if (mobileAvailabilityOnly && !inventoryMode && !compactOrders) return null;
    return showAvailability || (inventoryMode && !compactInventory) ? (
      <OrderProductAvailability
        madeToOrder={product.madeToOrder}
        balance={product.id ? stockByProductId?.get(product.id) : undefined}
        showStock={showStock}
        stockLoading={stockLoading}
      />
    ) : null;
  }

  function renderAddControls(product: Product, mobile = false) {
    const priceMissing = priceForTier(product, priceTier) === null;
    const adding = busyProductId === product.id;
    const quantity = quantityToAdd(product);
    const alreadyAdded = quantityInOrder?.(product) ?? 0;
    const justAdded = addedProductId === product.id;
    const added = alreadyAdded > 0 || justAdded;
    return (
      <div
        className={`order-product-picker__add${mobile ? " order-product-picker__add--mobile" : ""}`}
      >
        {(mobile || (showQuantityPicker && product.id)) && (
          <div className="order-product-picker__quantity">
            {showQuantityPicker && product.id ? (
              <OrderQuantityInput
                label={mobile ? "Добавить количество" : undefined}
                value={quantity}
                aria-label={`Количество товара ${product.nameRu} для добавления`}
                selectOnFocus
                minQuantity={minQuantity}
                maxQuantity={maxQuantity}
                onValueChange={(value) => updateQuantityToAdd(product.id!, value)}
              />
            ) : (
              <span>Добавится: {inventoryQuantityFormatter.format(quantity)}</span>
            )}
            <span>
              {quantityInOrderLabel}: {inventoryQuantityFormatter.format(alreadyAdded)}
            </span>
          </div>
        )}
        <AppButton
          type="button"
          variant="secondary"
          className={`order-product-picker__add-button${!mobile && added ? " is-added" : ""}${justAdded ? " is-just-added" : ""}`}
          disabled={(!allowMissingPrice && priceMissing) || busyProductId != null}
          loading={adding}
          loadingMode="spinner-only"
          aria-label={`Добавить ${inventoryQuantityFormatter.format(quantity)} товара ${product.nameRu}. ${quantityInOrderLabel}: ${inventoryQuantityFormatter.format(alreadyAdded)}`}
          onClick={() => void addProduct(product, quantity)}
        >
          {!mobile && added ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Plus size={16} aria-hidden="true" />
          )}
          {added ? (mobile ? "Добавить ещё" : "Добавлено") : "Добавить"}
        </AppButton>
        {mobile && justAdded && (
          <span className="order-product-picker__added-note">
            <Check size={14} aria-hidden="true" /> Добавлено
          </span>
        )}
      </div>
    );
  }

  const columns: AppDataTableColumn<Product>[] = [
    {
      id: "product",
      header: "Товар",
      value: (product) => `${product.sku} ${product.nameRu}`,
      cell: (product) => {
        const src = imageUrl(product);
        return (
          <div className="order-product-picker__product">
            <div className="order-product-picker__image">
              {src ? <img src={src} alt="" loading="lazy" /> : <ImageOff size={18} />}
            </div>
            <div className="order-product-picker__product-main">
              <strong>{product.nameRu}</strong>
              <span>Артикул: {product.sku}</span>
              {renderAvailability(product)}
            </div>
            {inventoryMode && (
              <AppActionMenu
                actions={productActions(product)}
                label={`Действия: ${product.nameRu}`}
              />
            )}
          </div>
        );
      },
    },
    {
      id: "price",
      header: "Цена",
      value: (product) => priceForTier(product, priceTier) ?? -1,
      searchable: false,
      align: "right",
      width: 140,
      cell: (product) => {
        const price = priceForTier(product, priceTier);
        return price === null ? <AppBadge tone="red">Не указана</AppBadge> : formatMoney(price);
      },
    },
    {
      id: "add",
      header: showQuantityPicker || inventoryMode ? "Количество" : "",
      hideable: false,
      searchable: false,
      align: "right",
      width: inventoryMode ? 290 : showQuantityPicker ? 250 : 140,
      cell: (product) =>
        inventoryMode ? renderInventoryEditor(product) : renderAddControls(product),
    },
  ];

  function renderInventoryEditor(product: Product, compact = false) {
    const selected = inventoryProductSelected(product);
    const quantity = parsedInventoryQuantity(product);
    const priceMissing = priceForTier(product, priceTier) === null;
    const adding = busyProductId === product.id;
    return (
      <div
        className={
          compact ? "order-product-picker__mobile-editor" : "order-product-picker__inventory-editor"
        }
      >
        <div className={compact ? undefined : "order-product-picker__quantity"}>
          <AppInput
            id={`inventory-product-quantity-${product.id}`}
            type="text"
            inputMode="decimal"
            label={compact ? "Фактически" : undefined}
            value={inventoryQuantityText(product)}
            aria-label={`Фактическое количество товара ${product.nameRu}`}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              if (product.id) updateInventoryQuantity(product.id, event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && quantity !== null) {
                event.preventDefault();
                void setInventoryQuantity(product, quantity);
              }
            }}
          />
          {!compact && (
            <span>
              {selected ? `В документе: ${inventoryQuantityLabel(product)}` : "Не считали"}
            </span>
          )}
        </div>
        <AppButton
          type="button"
          variant={!compact || selected ? "secondary" : "primary"}
          disabled={
            (!allowMissingPrice && priceMissing) || busyProductId != null || quantity === null
          }
          loading={adding}
          loadingMode="spinner-only"
          onClick={() => {
            if (quantity !== null) void setInventoryQuantity(product, quantity);
          }}
        >
          {!compact && !selected && <Plus size={16} aria-hidden="true" />}
          {selected ? "Изменить" : compact ? "Установить" : "Добавить"}
        </AppButton>
      </div>
    );
  }

  const detailPrice = detailProduct ? priceForTier(detailProduct, priceTier) : null;
  const detailBalance = detailProduct?.id ? stockByProductId?.get(detailProduct.id) : undefined;

  return (
    <>
      <AppModal
        title="Подобрать товар"
        description={
          inventoryMode
            ? "Найдите товар и укажите фактическое количество. Повторный выбор заменит его значение."
            : compactOrders
              ? `Найдите товар и добавьте его в ${destinationName} кнопкой «Добавить». Дополнительные действия — в меню ⋯.`
              : `Найдите товар по названию или артикулу и добавьте его в ${destinationName} кнопкой или двойным щелчком по строке. По ПКМ можно открыть карточку товара.`
        }
        open={open}
        onOpenChange={(next) => {
          if (!createProductOpen) onOpenChange(next);
        }}
        onInteractOutside={(event) => {
          if (createProductOpen) {
            event.preventDefault();
            return;
          }
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest(".app-context-menu, .app-dropdown-menu")
          ) {
            event.preventDefault();
          }
        }}
        contentClassName={`order-product-picker-modal${inventoryMode ? " order-product-picker-modal--inventory" : ""}`}
      >
        <div
          ref={pickerRef}
          className={`order-product-picker${inventoryMode ? " order-product-picker--inventory" : ""}`}
          tabIndex={inventoryMode ? 0 : undefined}
          aria-label={inventoryMode ? "Подбор товаров для инвентаризации" : undefined}
        >
          {inventoryMode && compactInventory ? (
            <div className="order-product-picker__inventory-search">
              <div
                className={`order-product-picker__inventory-search-row${canCreateProduct ? " has-create" : ""}`}
              >
                <AppSearchInput
                  ref={searchInputRef}
                  label="Поиск товара или штрихкода"
                  value={search}
                  placeholder="Название, артикул или штрихкод"
                  autoComplete="off"
                  suffix={
                    search ? (
                      <button
                        type="button"
                        className="order-product-picker__clear-search"
                        aria-label="Очистить поиск товара"
                        onClick={() => {
                          setSearch("");
                          setPage(1);
                          setPendingBarcode(null);
                          setBarcodeError(null);
                          searchInputRef.current?.focus();
                        }}
                      >
                        <X size={17} aria-hidden="true" />
                      </button>
                    ) : undefined
                  }
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                    setPendingBarcode(null);
                    setBarcodeError(null);
                    setExpandedProductId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const query = search.trim();
                      if (/^[A-Za-z0-9._-]+$/.test(query)) searchBarcode(query);
                      else if (
                        !inventoryProductsQuery.isFetching &&
                        inventoryProducts.length === 1
                      ) {
                        const product = inventoryProducts[0];
                        setExpandedProductId(product.id ?? null);
                        if (product.id)
                          requestAnimationFrame(() =>
                            document
                              .getElementById(`inventory-product-quantity-${product.id}`)
                              ?.focus(),
                          );
                      }
                    }
                  }}
                />
                <AppButton
                  type="button"
                  variant="secondary"
                  className="order-product-picker__scan"
                  aria-label="Сканировать штрихкод камерой"
                  onClick={() => setScannerOpen(true)}
                >
                  <ScanLine size={20} aria-hidden="true" />
                  <span>Сканировать</span>
                </AppButton>
                {createProductButton}
              </div>
              <div className="order-product-picker__inventory-summary" role="status">
                <span>
                  Подсчитано: <b>{inventoryCount ?? 0}</b>
                </span>
                {barcodeError && (
                  <span className="order-product-picker__barcode-error">{barcodeError}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="order-product-picker__toolbar">
              <AppSearchInput
                ref={searchInputRef}
                label="Поиск товара"
                value={search}
                placeholder="Название или артикул"
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                  setPendingBarcode(null);
                  setBarcodeError(null);
                }}
                onKeyDown={(event) => {
                  if (
                    inventoryMode &&
                    event.key === "Enter" &&
                    /^[A-Za-z0-9._-]+$/.test(search.trim())
                  ) {
                    event.preventDefault();
                    searchBarcode(search);
                  }
                }}
                error={inventoryMode ? (barcodeError ?? undefined) : undefined}
              />
              {createProductButton}
            </div>
          )}
          {inventoryMode ? (
            <div
              className={`order-product-picker__inventory-results${!compactInventory ? " order-product-picker__inventory-results--desktop" : ""}`}
            >
              {compactInventory ? (
                <div className="order-product-picker__mobile-list" key={search}>
                  {inventoryProductsQuery.isLoading ? (
                    <p className="order-product-picker__mobile-state">Загрузка товаров…</p>
                  ) : inventoryProductsQuery.isError && !inventoryProductsQuery.data ? (
                    <p className="order-product-picker__mobile-state" role="alert">
                      Не удалось загрузить каталог товаров
                    </p>
                  ) : inventoryProducts.length === 0 ? (
                    <p className="order-product-picker__mobile-state">Товары не найдены</p>
                  ) : (
                    <>
                      {inventoryProducts.map((product) => {
                        const selected = inventoryProductSelected(product);
                        const expanded = expandedProductId === product.id;
                        return (
                          <article
                            className={`order-product-picker__mobile-item${expanded ? " is-expanded" : ""}`}
                            key={product.id ?? product.sku}
                          >
                            <button
                              type="button"
                              className="order-product-picker__mobile-row"
                              aria-expanded={expanded}
                              aria-label={`${product.nameRu}, артикул ${product.sku}, ${selected ? `в документе ${inventoryQuantityLabel(product)}` : "не считали"}`}
                              onClick={() => {
                                setExpandedProductId(expanded ? null : (product.id ?? null));
                                if (!expanded && product.id)
                                  requestAnimationFrame(() =>
                                    document
                                      .getElementById(`inventory-product-quantity-${product.id}`)
                                      ?.focus(),
                                  );
                              }}
                            >
                              <span className="order-product-picker__mobile-info">
                                <strong>{product.nameRu}</strong>
                                <small>Артикул: {product.sku}</small>
                              </span>
                              <span
                                className={`order-product-picker__mobile-status${selected ? " is-selected" : ""}`}
                              >
                                {selected
                                  ? `В документе: ${inventoryQuantityLabel(product)}`
                                  : "Не считали"}
                              </span>
                              <ChevronDown size={17} aria-hidden="true" />
                            </button>
                            {expanded && renderInventoryEditor(product, true)}
                          </article>
                        );
                      })}
                      {inventoryProductsQuery.hasNextPage && (
                        <AppButton
                          type="button"
                          variant="ghost"
                          className="order-product-picker__load-more"
                          loading={inventoryProductsQuery.isFetchingNextPage}
                          loadingText="Загружаем"
                          onClick={() => void inventoryProductsQuery.fetchNextPage()}
                        >
                          Показать ещё товары
                        </AppButton>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <AppDataTable
                  className="order-product-picker__table"
                  data={productsQuery.data?.items ?? []}
                  columns={columns}
                  rowId={(product) => String(product.id ?? product.sku)}
                  loading={productsQuery.isLoading}
                  error={
                    productsQuery.isError && !productsQuery.data
                      ? "Не удалось загрузить каталог товаров"
                      : undefined
                  }
                  searchable={false}
                  selectable={false}
                  contextMenuActions={productActions}
                  contextMenuLabel={(product) => `Действия: ${product.nameRu}`}
                  mode="server"
                  searchValue={search.trim()}
                  page={productsQuery.data?.page ?? page}
                  pageSize={productsQuery.data?.size ?? pageSize}
                  pageSizes={[10, 25, 50, 100]}
                  totalItems={productsQuery.data?.totalItems ?? 0}
                  totalPages={productsQuery.data?.totalPages ?? 1}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  emptyTitle="Товары не найдены"
                  emptyDescription="Измените запрос или проверьте каталог."
                />
              )}
              {compactInventory && (
                <div className="order-product-picker__mobile-footer">
                  <span>
                    Показано {inventoryProducts.length} из{" "}
                    {inventoryProductsQuery.data?.pages[0]?.totalItems ?? 0}
                  </span>
                  <AppButton type="button" onClick={() => onOpenChange(false)}>
                    Готово
                  </AppButton>
                </div>
              )}
            </div>
          ) : (
            <div className="order-product-picker__order-results">
              <div className="order-product-picker__order-mobile">
                <div
                  className="order-product-picker__order-list"
                  key={`${search}-${page}-${pageSize}`}
                >
                  {productsQuery.isLoading ? (
                    <p className="order-product-picker__mobile-state">Загрузка товаров…</p>
                  ) : productsQuery.isError && !productsQuery.data ? (
                    <p className="order-product-picker__mobile-state" role="alert">
                      Не удалось загрузить каталог товаров
                    </p>
                  ) : !productsQuery.data?.items.length ? (
                    <p className="order-product-picker__mobile-state">
                      Товары не найдены. Измените запрос.
                    </p>
                  ) : (
                    productsQuery.data.items.map((product) => {
                      const src = imageUrl(product);
                      const price = priceForTier(product, priceTier);
                      return (
                        <article
                          className="order-product-picker__order-card"
                          key={product.id ?? product.sku}
                        >
                          <div className="order-product-picker__order-card-heading">
                            <div className="order-product-picker__image">
                              {src ? (
                                <img src={src} alt="" loading="lazy" />
                              ) : (
                                <ImageOff size={18} />
                              )}
                            </div>
                            <strong>{product.nameRu}</strong>
                            <AppActionMenu
                              actions={productActions(product)}
                              label={`Действия: ${product.nameRu}`}
                            />
                          </div>
                          <span className="order-product-picker__order-sku">
                            Артикул: {product.sku}
                          </span>
                          {renderAvailability(product)}
                          <div className="order-product-picker__order-price">
                            Цена:{" "}
                            {price === null ? (
                              <AppBadge tone="red">Не указана</AppBadge>
                            ) : (
                              <strong>{formatMoney(price)}</strong>
                            )}
                          </div>
                          {renderAddControls(product, true)}
                          {!allowMissingPrice && price === null && (
                            <p className="order-product-picker__price-hint">
                              Добавление доступно после установки цены товара.
                            </p>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
                <div className="order-product-picker__order-footer">
                  <span>
                    Найдено: {productsQuery.data?.totalItems ?? 0} · Страница{" "}
                    {productsQuery.data?.page ?? page} из {productsQuery.data?.totalPages || 1}
                  </span>
                  <div className="order-product-picker__order-pagination">
                    <AppButton
                      type="button"
                      variant="secondary"
                      aria-label="Предыдущая страница товаров"
                      disabled={page <= 1 || productsQuery.isFetching}
                      onClick={() => setPage((current) => current - 1)}
                    >
                      <ChevronLeft size={18} aria-hidden="true" />
                    </AppButton>
                    <AppButton type="button" onClick={() => onOpenChange(false)}>
                      Готово
                    </AppButton>
                    <AppButton
                      type="button"
                      variant="secondary"
                      aria-label="Следующая страница товаров"
                      disabled={
                        page >= (productsQuery.data?.totalPages ?? 1) || productsQuery.isFetching
                      }
                      onClick={() => setPage((current) => current + 1)}
                    >
                      <ChevronRight size={18} aria-hidden="true" />
                    </AppButton>
                  </div>
                </div>
              </div>
              <AppDataTable
                className="order-product-picker__table"
                data={productsQuery.data?.items ?? []}
                columns={columns}
                rowId={(product) => String(product.id ?? product.sku)}
                loading={productsQuery.isLoading}
                error={
                  productsQuery.isError && !productsQuery.data
                    ? "Не удалось загрузить каталог товаров"
                    : undefined
                }
                searchable={false}
                selectable={false}
                onRowDoubleClick={(product) => {
                  const priceMissing = priceForTier(product, priceTier) === null;
                  if ((!allowMissingPrice && priceMissing) || busyProductId != null) return;
                  void addProduct(product, quantityToAdd(product));
                }}
                contextMenuActions={productActions}
                contextMenuLabel={(product) => `Действия: ${product.nameRu}`}
                mode="server"
                page={productsQuery.data?.page ?? page}
                pageSize={productsQuery.data?.size ?? pageSize}
                pageSizes={[10, 25, 50, 100]}
                totalItems={productsQuery.data?.totalItems ?? 0}
                totalPages={productsQuery.data?.totalPages ?? 1}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                emptyTitle="Товары не найдены"
                emptyDescription="Измените запрос или проверьте каталог."
              />
            </div>
          )}
          <div
            className={`order-product-picker__feedback${addFeedback?.error ? " is-error" : ""}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {addFeedback?.message}
          </div>
        </div>
      </AppModal>
      {canCreateProduct && (
        <ProductCreateModal
          open={open && createProductOpen}
          onOpenChange={changeCreatorOpen}
          onCreated={refreshCreatedProduct}
        />
      )}
      <AppModal
        title="Карточка товара"
        open={open && detailProduct !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDetailProduct(null);
        }}
        contentClassName="order-product-picker-detail"
      >
        {detailProduct && (
          <div className="order-product-picker-detail__content">
            <strong>{detailProduct.nameRu}</strong>
            <span>Артикул: {detailProduct.sku}</span>
            <span>Цена: {detailPrice === null ? "Не указана" : formatMoney(detailPrice)}</span>
            {renderAvailability(detailProduct)}
            {showAvailability && showStock && !stockLoading && detailBalance && (
              <dl className="order-product-picker-detail__stock">
                <div>
                  <dt>На складе</dt>
                  <dd>{inventoryQuantityFormatter.format(detailBalance.onHand)}</dd>
                </div>
                <div>
                  <dt>В резерве</dt>
                  <dd>{inventoryQuantityFormatter.format(detailBalance.reserved)}</dd>
                </div>
                <div>
                  <dt>Свободно</dt>
                  <dd>{inventoryQuantityFormatter.format(detailBalance.available)}</dd>
                </div>
              </dl>
            )}
            {onEditProduct && detailProduct.id && (
              <AppButton
                type="button"
                variant="secondary"
                onClick={() => {
                  onEditProduct?.(detailProduct);
                  setDetailProduct(null);
                }}
              >
                Редактировать товар
              </AppButton>
            )}
            <AppButton type="button" onClick={() => setDetailProduct(null)}>
              Закрыть
            </AppButton>
          </div>
        )}
      </AppModal>
      {inventoryMode && (
        <BarcodeScannerModal
          open={scannerOpen}
          onOpenChange={setScannerOpen}
          onDetected={searchBarcode}
          onManualEntry={() => {
            setScannerOpen(false);
            requestAnimationFrame(() => searchInputRef.current?.focus());
          }}
        />
      )}
    </>
  );
}
