import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ImageOff } from "lucide-react";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { AdminPage } from "@/layouts/AdminPage";
import { fetchSupplierProduct, SUPPLIER_PRODUCTS_KEY } from "@/shared/api/supplierProducts";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppAlert, AppSkeleton } from "@/shared/ui/AppFeedback";
import "./SupplierProductPage.css";

function returnPath(state: unknown, current: string) {
  const candidate = (state as { returnTo?: unknown } | null)?.returnTo;
  const fallback = "/admin/products/suppliers";
  if (
    typeof candidate !== "string" ||
    !candidate.startsWith("/admin/") ||
    /[\\\x00-\x1f]/.test(candidate)
  )
    return fallback;
  try {
    const url = new URL(candidate, window.location.origin);
    return url.origin === window.location.origin && url.pathname !== current
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}
const money = (value: number | null) =>
  value === null
    ? "Не указана"
    : `${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value)} ₸`;
export function SupplierProductPage() {
  const { id } = useParams();
  const { user } = useCommerce();
  const location = useLocation();
  const navigate = useNavigate();
  const [imageIndex, setImageIndex] = useState(0);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const productId = Number(id);
  useEffect(() => {
    setImageIndex(0);
    setFailedImages([]);
  }, [productId]);
  const validId = Number.isSafeInteger(productId) && productId > 0;
  const query = useQuery({
    queryKey: [...SUPPLIER_PRODUCTS_KEY, "detail", user?.id, productId],
    queryFn: () => fetchSupplierProduct(productId),
    enabled: validId,
    retry: false,
  });
  const product = query.data;
  const images = [
    ...new Set(
      [...(product?.images ?? []), product?.imageUrl].filter((value): value is string => !!value),
    ),
  ];
  const currentImage = images[imageIndex];
  const details = product?.details;
  const facts = product
    ? [
        ["Поставщик", product.supplierName],
        ["Артикул", product.sku],
        ["Бренд", product.brand],
        ["Наличие у поставщика", product.availability],
        [
          "Обновлено",
          new Date(product.syncedAt).toLocaleString("ru-KZ", { timeZone: "Asia/Almaty" }),
        ],
      ]
    : [];
  const mksFacts = details
    ? [
        ["Модель", details.product.model],
        ["Штрихкод", details.barcode],
        ["Серия", details.series],
        ["Единица измерения", details.product.unit],
        ["Минимальное количество", details.minQuantity],
        ["Количество во внутренней упаковке", details.innerQuantity],
        ["Количество в коробке", details.outerQuantity],
      ]
    : [];
  return (
    <AdminPage
      title={product?.name ?? "Товар поставщика"}
      eyebrow={product?.supplierName ?? "Товары поставщиков"}
      className="supplier-product"
      backAction={
        <AppButton
          type="button"
          variant="ghost"
          aria-label="Вернуться к товарам поставщиков"
          onClick={() => navigate(returnPath(location.state, location.pathname), { replace: true })}
        >
          <ArrowLeft size={18} />
        </AppButton>
      }
    >
      {!validId ? (
        <AppAlert tone="danger" title="Товар не найден">
          Некорректная ссылка на товар.
        </AppAlert>
      ) : query.isLoading ? (
        <AppCard title="Загружаем карточку">
          <AppSkeleton />
        </AppCard>
      ) : query.error ? (
        <AppAlert
          tone="danger"
          title="Не удалось загрузить товар"
          onRetry={() => void query.refetch()}
        >
          {query.error.message}
        </AppAlert>
      ) : (
        product && (
          <>
            <AppCard
              title="Данные поставщика"
              description="Цены и наличие указаны поставщиком. Данные обновляются ежедневно."
            >
              <div className="supplier-product__overview">
                <div className="supplier-product__gallery">
                  <div className="supplier-product__image">
                    {currentImage && !failedImages.includes(currentImage) ? (
                      <img
                        src={currentImage}
                        alt={product.name}
                        referrerPolicy="no-referrer"
                        onError={() => setFailedImages((previous) => [...previous, currentImage])}
                      />
                    ) : (
                      <div className="supplier-product__placeholder">
                        <ImageOff size={40} />
                        <span>Фотография недоступна</span>
                      </div>
                    )}
                  </div>
                  {images.length > 1 && (
                    <div className="supplier-product__thumbnails">
                      {images.map((image, index) => (
                        <AppButton
                          key={image}
                          type="button"
                          variant="secondary"
                          aria-label={`Показать фото ${index + 1}`}
                          aria-pressed={index === imageIndex}
                          className="supplier-product__thumbnail"
                          onClick={() => setImageIndex(index)}
                        >
                          <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        </AppButton>
                      ))}
                    </div>
                  )}
                </div>
                <div className="supplier-product__summary">
                  <dl className="supplier-product__prices">
                    <div>
                      <dt>Цена для нас</dt>
                      <dd>{money(product.purchasePrice)}</dd>
                    </div>
                    <div>
                      <dt>
                        {product.supplierCode === "mks" ? "Розничная цена (МРЦ)" : "Розничная цена"}
                      </dt>
                      <dd>{money(product.retailPrice)}</dd>
                    </div>
                  </dl>
                  <dl className="supplier-product__facts">
                    {facts.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value || "Не указано"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </AppCard>
            <AppCard title="Описание">
              <p className="supplier-product__text">
                {product.description || "Поставщик не предоставил описание."}
              </p>
            </AppCard>
            {product.supplierCode === "mks" && details && (
              <AppCard title="Дополнительные данные МКС">
                <dl className="supplier-product__facts">
                  {mksFacts.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value || "Не указано"}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Рекомендуемая розничная цена (РРЦ)</dt>
                    <dd>{money(details.retailPrice)}</dd>
                  </div>
                </dl>
                {details.characteristics.length > 0 && (
                  <section className="supplier-product__section">
                    <h3>Характеристики</h3>
                    <dl className="supplier-product__facts">
                      {details.characteristics.map((entry, index) => (
                        <div key={`${index}-${entry.name}`}>
                          <dt>{entry.name}</dt>
                          <dd>{entry.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                )}
                {[
                  ["Преимущества", details.advantages],
                  ["Применение", details.usage],
                ].map(
                  ([title, text]) =>
                    text && (
                      <section key={title} className="supplier-product__section">
                        <h3>{title}</h3>
                        <p className="supplier-product__text">{text}</p>
                      </section>
                    ),
                )}
              </AppCard>
            )}
          </>
        )
      )}
    </AdminPage>
  );
}
