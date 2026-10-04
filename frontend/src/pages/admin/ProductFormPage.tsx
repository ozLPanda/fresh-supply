import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardList, Package, Save } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AdminPage } from "@/layouts/AdminPage";
import { api, API_URL } from "@/shared/api/http";
import { fetchAllCategories } from "@/shared/api/catalog";
import { MeasurementUnit, Product, ProductImage } from "@/shared/types/models";
import { measurementUnitOptions } from "@/shared/lib/measurementUnit";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppSwitch, AppTabs } from "@/shared/ui/AppControls";
import { AppInput, AppMoneyInput, AppSelect, AppTextarea } from "@/shared/ui/AppField";
import { AppImageUpload, type AppImageUploadItem } from "@/shared/ui/AppImageUpload";
import { appToast } from "@/shared/ui/AppToast";
import { AppAlert } from "@/shared/ui/AppFeedback";
import { ProductActivityHistory } from "./ProductActivityHistory";
import "./ProductFormPage.css";

const MAX_PRODUCT_IMAGES = 10;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

type ProductFormLocationState = {
  returnTo?: string;
  productsTableState?: unknown;
  mksCatalogState?: unknown;
  supplierDraft?: { sku?: string; nameRu?: string; nameKk?: string; incomingPrice?: number | null };
};

function getReturnPath(search: string, state: unknown) {
  const returnTo =
    new URLSearchParams(search).get("returnTo") ??
    (state as ProductFormLocationState | null)?.returnTo;
  if (typeof returnTo !== "string" || !returnTo.startsWith("/admin/") || returnTo.includes("\\")) {
    return "/admin/products";
  }
  try {
    const target = new URL(returnTo, window.location.origin);
    if (
      target.origin !== window.location.origin ||
      !target.pathname.startsWith("/admin/") ||
      target.pathname === "/admin/products/new"
    )
      return "/admin/products";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/admin/products";
  }
}

function getReturnState(state: unknown) {
  const productsTableState = (state as ProductFormLocationState | null)?.productsTableState;
  if (productsTableState) return { productsTableState, restoreScroll: true };
  const mksCatalogState = (state as ProductFormLocationState | null)?.mksCatalogState;
  return mksCatalogState ? { mksCatalogState, restoreScroll: true } : undefined;
}

function positiveIntegerOrNull(value: string) {
  const number = Number(value);
  return value === "" || !Number.isInteger(number) || number < 1 ? null : number;
}

export function ProductFormPage({
  embedded = false,
  productId,
  onSaved,
}: {
  embedded?: boolean;
  productId?: number;
  onSaved?: (product: Product) => void;
}) {
  const { id: routeId } = useParams();
  const id = productId ? String(productId) : routeId;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const returnPath = getReturnPath(location.search, location.state);
  const returnState = getReturnState(location.state);
  const initializedProductId = React.useRef<number | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const supplierDraft =
    !id && !embedded
      ? (location.state as ProductFormLocationState | null)?.supplierDraft
      : undefined;
  const [product, setProduct] = useState<Product>(() => ({
    sku: typeof supplierDraft?.sku === "string" ? supplierDraft.sku : "",
    nameRu: typeof supplierDraft?.nameRu === "string" ? supplierDraft.nameRu : "",
    nameKk: typeof supplierDraft?.nameKk === "string" ? supplierDraft.nameKk : "",
    price: 0,
    measurementUnit: "KG",
    active: !supplierDraft,
    madeToOrder: Boolean(supplierDraft),
    incomingPrice:
      typeof supplierDraft?.incomingPrice === "number" &&
      Number.isFinite(supplierDraft.incomingPrice) &&
      supplierDraft.incomingPrice >= 0
        ? supplierDraft.incomingPrice
        : undefined,
    deliveryDaysFrom: null,
    deliveryDaysTo: null,
  }));
  const skuEdited = React.useRef(false);
  const skuRequest = React.useRef<Promise<{ sku: string }> | null>(null);
  const [skuLoading, setSkuLoading] = useState(!id && !supplierDraft?.sku?.trim());
  const [skuLoadFailed, setSkuLoadFailed] = useState(false);

  React.useEffect(() => {
    if (id || supplierDraft?.sku?.trim()) return;
    let cancelled = false;
    // Reuse the request across StrictMode effect replays without caching an article across forms.
    skuRequest.current ??= api<{ sku: string }>("/api/products/next-sku", { method: "POST" });
    skuRequest.current
      .then(({ sku }) => {
        if (!cancelled && !skuEdited.current) {
          setProduct((current) => (current.sku.trim() ? current : { ...current, sku }));
        }
      })
      .catch(() => {
        if (!cancelled) setSkuLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setSkuLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, supplierDraft?.sku]);

  const categories = useQuery({ queryKey: ["categories"], queryFn: () => fetchAllCategories() });
  const existing = useQuery({
    queryKey: ["product", id],
    queryFn: () => api<Product>(`/api/products/${id}`),
    enabled: Boolean(id),
    refetchOnWindowFocus: false,
  });

  React.useEffect(() => {
    if (
      existing.data?.id == null ||
      String(existing.data.id) !== id ||
      initializedProductId.current === existing.data.id
    ) {
      return;
    }
    initializedProductId.current = existing.data.id;
    setProduct({ ...existing.data, measurementUnit: existing.data.measurementUnit ?? "PIECE" });
  }, [existing.data, id]);

  const pendingPreviews = useMemo(
    () =>
      pendingFiles.map((file, index) => ({
        id: `pending-${index}-${file.name}-${file.lastModified}`,
        src: URL.createObjectURL(file),
        name: file.name,
        main: !(product.images?.length ?? 0) && index === 0,
        pending: true,
      })),
    [pendingFiles, product.images?.length],
  );

  React.useEffect(
    () => () => pendingPreviews.forEach((preview) => URL.revokeObjectURL(preview.src)),
    [pendingPreviews],
  );

  const imageItems: AppImageUploadItem[] = [
    ...(product.images ?? []).map((image) => ({
      id: String(image.id),
      src: `${API_URL}${image.filePath}`,
      name: image.originalFileName,
      main: image.mainImage,
    })),
    ...pendingPreviews,
  ];

  async function uploadPendingImages(productId: number) {
    for (const file of pendingFiles) {
      const body = new FormData();
      body.append("file", file);
      await api<ProductImage>(`/api/products/${productId}/images`, { method: "POST", body });
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const saved = await api<Product>(id ? `/api/products/${id}` : "/api/products", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(product),
      });
      if (!saved.id) throw new Error("Не удалось определить сохранённый товар");
      try {
        await uploadPendingImages(saved.id);
        return { saved, imageUploadFailed: false };
      } catch {
        return { saved, imageUploadFailed: true };
      }
    },
    onSuccess: async ({ saved, imageUploadFailed }) => {
      const savedProduct = (current?: Product) => ({
        ...current,
        ...saved,
        images: current?.images ?? saved.images,
      });
      setProduct((current) => savedProduct(current));
      queryClient.setQueryData<Product>(["product", String(saved.id)], savedProduct);
      if (!embedded) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["products"], refetchType: "all" }),
          queryClient.invalidateQueries({
            queryKey: ["import-created-products"],
            refetchType: "all",
          }),
        ]);
      }
      if (imageUploadFailed) {
        appToast.error("Товар сохранён, но часть изображений загрузить не удалось");
        if (embedded) return;
        navigate(`/admin/products/${saved.id}?returnTo=${encodeURIComponent(returnPath)}`, {
          state: returnState,
        });
        return;
      }
      appToast.success(id ? "Изменения сохранены" : "Товар создан");
      if (embedded) {
        onSaved?.(saved);
        return;
      }
      navigate(returnPath, { state: returnState });
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось сохранить товар"),
  });

  const removeImage = useMutation({
    mutationFn: (imageId: number) =>
      api<ProductImage[]>(`/api/products/${id}/images/${imageId}`, { method: "DELETE" }),
    onSuccess: (images) => {
      setProduct((current) => ({ ...current, images }));
      void queryClient.invalidateQueries({ queryKey: ["product", id] });
      appToast.success("Изображение удалено");
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось удалить изображение"),
  });

  const setMainImage = useMutation({
    mutationFn: (imageId: number) =>
      api<ProductImage[]>(`/api/products/${id}/images/${imageId}/main`, { method: "PATCH" }),
    onSuccess: (images) => {
      setProduct((current) => ({ ...current, images }));
      void queryClient.invalidateQueries({ queryKey: ["product", id] });
      appToast.success("Главное изображение изменено");
    },
    onError: (error) =>
      appToast.error(error instanceof Error ? error.message : "Не удалось изменить изображение"),
  });

  function addFiles(files: File[]) {
    const validFiles = files.filter((file) => {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        appToast.error(`${file.name}: разрешены только JPEG, PNG и WEBP`);
        return false;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        appToast.error(`${file.name}: размер файла не должен превышать 5 МБ`);
        return false;
      }
      return true;
    });
    const available = Math.max(
      0,
      MAX_PRODUCT_IMAGES - (product.images?.length ?? 0) - pendingFiles.length,
    );
    setPendingFiles((current) => [...current, ...validFiles.slice(0, available)]);
  }

  function removeItem(item: AppImageUploadItem) {
    if (item.pending) {
      setPendingFiles((current) =>
        current.filter(
          (file, index) => `pending-${index}-${file.name}-${file.lastModified}` !== item.id,
        ),
      );
      return;
    }
    removeImage.mutate(Number(item.id));
  }

  const mediaBusy = save.isPending || removeImage.isPending || setMainImage.isPending;

  const editor = (
    <div className="product-editor">
      <AppCard
        className="product-editor__form"
        title="Основная информация"
        description="Данные, цены, наличие и срок доставки товара."
      >
        {supplierDraft && (
          <AppAlert title="Товар из каталога МКС">
            Артикул, название и приходная цена перенесены от поставщика. Укажите цену продажи,
            проверьте название на казахском языке и срок доставки. Включите «Товар активен», когда
            будете готовы показать его покупателям.
          </AppAlert>
        )}
        <div className="product-editor__fields">
          <AppInput
            label="Артикул"
            value={product.sku}
            placeholder={skuLoading ? "Присваивается…" : undefined}
            hint={
              !id
                ? skuLoadFailed
                  ? "Артикул будет присвоен при сохранении. Можно указать вручную."
                  : "Заполняется автоматически. Можно изменить вручную."
                : undefined
            }
            onChange={(event) => {
              skuEdited.current = true;
              setProduct({ ...product, sku: event.target.value });
            }}
          />
          <AppSelect
            label="Категория"
            options={[
              { value: "", label: "Без категории" },
              ...(categories.data ?? []).map((category) => ({
                value: String(category.id),
                label: category.nameRu,
              })),
            ]}
            value={product.categoryId ? String(product.categoryId) : ""}
            searchable
            clearable={false}
            onValueChange={(value) =>
              setProduct((current) => ({
                ...current,
                categoryId: typeof value === "string" && value ? Number(value) : undefined,
              }))
            }
          />
          <AppInput
            label="Название RU"
            value={product.nameRu}
            onChange={(event) => setProduct({ ...product, nameRu: event.target.value })}
          />
          <AppInput
            label="Название KZ"
            hint="Необязательно"
            value={product.nameKk}
            onChange={(event) => setProduct({ ...product, nameKk: event.target.value })}
          />
          <AppSelect
            label="Единица измерения по умолчанию"
            hint="Используется в новых заказах. При отпуске можно выбрать другую единицу для конкретного заказа."
            fieldClassName="product-editor__status"
            value={product.measurementUnit ?? "KG"}
            disabled={save.isPending}
            onChange={(event) =>
              setProduct((current) => ({
                ...current,
                measurementUnit: event.target.value as MeasurementUnit,
              }))
            }
          >
            {measurementUnitOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AppSelect>
          <AppMoneyInput
            label="Цена"
            value={product.price}
            onValueChange={(value) => setProduct({ ...product, price: value ?? 0 })}
          />
          <AppMoneyInput
            label="Оптовая цена"
            value={product.wholesalePrice ?? null}
            onValueChange={(value) =>
              setProduct({ ...product, wholesalePrice: value ?? undefined })
            }
          />
          <AppMoneyInput
            label="Крупный опт"
            value={product.bulkWholesalePrice ?? null}
            onValueChange={(value) =>
              setProduct({ ...product, bulkWholesalePrice: value ?? undefined })
            }
          />
          <AppMoneyInput
            label="СКО"
            hint="Внутренний тип цены: не отображается клиентам магазина."
            value={product.skoPrice ?? null}
            onValueChange={(value) => setProduct({ ...product, skoPrice: value ?? undefined })}
          />
          <AppMoneyInput
            label="ГСКО"
            hint="Внутренний тип цены: не отображается клиентам магазина и не применяется монтажникам."
            value={product.gskoPrice ?? null}
            onValueChange={(value) => setProduct({ ...product, gskoPrice: value ?? undefined })}
          />
          <AppMoneyInput
            label="Приходная цена"
            hint="Внутренняя себестоимость для аналитики прибыли. Клиентам не отображается."
            value={product.incomingPrice ?? null}
            onValueChange={(value) => setProduct({ ...product, incomingPrice: value ?? undefined })}
          />
          <div className="product-editor__status">
            <AppSwitch
              label="Товар активен"
              description="Активный товар отображается в каталоге магазина."
              checked={product.active}
              disabled={save.isPending}
              onCheckedChange={(active) => setProduct((current) => ({ ...current, active }))}
            />
          </div>
          <div className="product-editor__status">
            <AppSwitch
              label="Товар на заказ"
              description="Клиент увидит срок доставки в карточке товара."
              checked={Boolean(product.madeToOrder)}
              disabled={save.isPending}
              onCheckedChange={(madeToOrder) =>
                setProduct((current) => ({ ...current, madeToOrder }))
              }
            />
          </div>
          {product.madeToOrder && (
            <div className="product-editor__delivery-fields">
              <AppInput
                label="Доставка от, дней"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={product.deliveryDaysFrom ?? ""}
                onChange={(event) =>
                  setProduct((current) => ({
                    ...current,
                    deliveryDaysFrom: positiveIntegerOrNull(event.target.value),
                  }))
                }
              />
              <AppInput
                label="Доставка до, дней"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={product.deliveryDaysTo ?? ""}
                onChange={(event) =>
                  setProduct((current) => ({
                    ...current,
                    deliveryDaysTo: positiveIntegerOrNull(event.target.value),
                  }))
                }
              />
            </div>
          )}
          <AppTextarea
            className="product-editor__description"
            label="Описание RU"
            value={product.descriptionRu ?? ""}
            onChange={(event) => setProduct({ ...product, descriptionRu: event.target.value })}
          />
        </div>
      </AppCard>
      <AppCard className="product-editor__media">
        <AppImageUpload
          items={imageItems}
          maxFiles={MAX_PRODUCT_IMAGES}
          disabled={mediaBusy}
          onFilesSelected={addFiles}
          onRemove={removeItem}
          onSetMain={(item) => setMainImage.mutate(Number(item.id))}
        />
        {!id && pendingFiles.length === 0 && (
          <p className="product-editor__media-note">
            Фотографии можно выбрать сразу — они загрузятся после создания товара.
          </p>
        )}
      </AppCard>
    </div>
  );

  const saveButton = (
    <AppButton
      type="button"
      loading={save.isPending}
      loadingText="Сохранение..."
      onClick={() => save.mutate()}
    >
      <Save size={18} />
      Сохранить
    </AppButton>
  );

  if (embedded) {
    return (
      <div className="product-editor-embed">
        {editor}
        <footer className="product-editor-embed__actions">{saveButton}</footer>
      </div>
    );
  }

  return (
    <AdminPage
      eyebrow="Товары"
      title={id ? "Редактирование товара" : "Создание товара"}
      backAction={
        <AppButton
          type="button"
          variant="ghost"
          aria-label="Вернуться к списку товаров"
          onClick={() => navigate(returnPath, { state: returnState })}
        >
          <ArrowLeft size={22} />
        </AppButton>
      }
      actions={saveButton}
    >
      {id ? (
        <AppTabs
          variant="underline"
          items={[
            {
              value: "card",
              label: "Карточка товара",
              icon: <Package size={17} />,
              content: editor,
            },
            {
              value: "activity",
              label: "История операций",
              icon: <ClipboardList size={17} />,
              content: <ProductActivityHistory productId={Number(id)} />,
            },
          ]}
        />
      ) : (
        editor
      )}
    </AdminPage>
  );
}
