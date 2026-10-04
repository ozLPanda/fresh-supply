import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { fetchMksProductDetails, type MksProduct, type MksProductDetails } from "@/shared/api/mks";
import { AppButton } from "@/shared/ui/AppButton";
import { AppAlert, AppModal, AppSkeleton } from "@/shared/ui/AppFeedback";
import "./MksProductModal.css";

function supplierImage(value: string) {
  try {
    const url = new URL(value);
    return url.origin === "https://mkskz.master.pro" &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/dbpics/")
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function money(value: number | null) {
  return value === null
    ? "Не указана"
    : `${new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 2 }).format(value)} ₸`;
}

function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const safeImages = [...new Set(images.map(supplierImage).filter((url): url is string => !!url))];
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const current = safeImages[selected];
  const unavailable = !current || failed.includes(current);

  return (
    <div className="mks-product-modal__gallery">
      <div className="mks-product-modal__image">
        {unavailable ? (
          <div className="mks-product-modal__no-image" role="status">
            <ImageOff size={32} aria-hidden="true" />
            <span>
              {current ? "Не удалось загрузить фотографию" : "Фотографии не предоставлены"}
            </span>
          </div>
        ) : (
          <img
            src={current}
            alt={`${name}, фото ${selected + 1}`}
            referrerPolicy="no-referrer"
            onError={() => setFailed((previous) => [...previous, current])}
          />
        )}
      </div>
      {safeImages.length > 1 && (
        <div className="mks-product-modal__thumbnails" aria-label="Фотографии товара">
          {safeImages.map((url, index) => (
            <AppButton
              key={url}
              type="button"
              variant="secondary"
              className="mks-product-modal__thumbnail"
              aria-label={`Показать фото ${index + 1}`}
              aria-pressed={selected === index}
              onClick={() => setSelected(index)}
            >
              {failed.includes(url) ? (
                <ImageOff size={20} aria-hidden="true" />
              ) : (
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setFailed((previous) => [...previous, url])}
                />
              )}
            </AppButton>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductDetails({ details }: { details: MksProductDetails }) {
  const { product } = details;
  const facts = [
    ["Артикул", product.sku],
    ["Модель", product.model],
    ["Штрихкод", details.barcode],
    ["Производитель", product.brand],
    ["Серия", details.series],
    ["Мин. количество", details.minQuantity],
    ["Количество иннер", details.innerQuantity],
    ["Количество аутер", details.outerQuantity],
    ["Единица измерения", product.unit],
    ["Наличие у МКС", product.availability],
  ];
  const descriptions = [
    ["Описание", details.description],
    ["Преимущества", details.advantages],
    ["Применение", details.usage],
  ];

  return (
    <div className="mks-product-modal__details">
      <div className="mks-product-modal__overview">
        <ProductGallery images={details.images} name={product.name} />
        <div className="mks-product-modal__summary">
          <div className="mks-product-modal__prices">
            <span>Цена поставщика</span>
            <strong>{money(product.price)}</strong>
            <dl>
              <div>
                <dt>РРЦ</dt>
                <dd>{money(details.retailPrice)}</dd>
              </div>
              <div>
                <dt>МРЦ</dt>
                <dd>{money(details.minimumPrice)}</dd>
              </div>
            </dl>
          </div>
          <dl className="mks-product-modal__facts">
            {facts.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value || "Не указано"}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <section className="mks-product-modal__section" aria-labelledby="mks-product-characteristics">
        <h3 id="mks-product-characteristics">Характеристики</h3>
        {details.characteristics.length ? (
          <dl className="mks-product-modal__characteristics">
            {details.characteristics.map((entry, index) => (
              <div key={`${index}-${entry.name}`}>
                <dt>{entry.name}</dt>
                <dd>{entry.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mks-product-modal__muted">Характеристики не предоставлены.</p>
        )}
      </section>
      {descriptions.map(
        ([title, text]) =>
          text && (
            <section key={title} className="mks-product-modal__section">
              <h3>{title}</h3>
              <p className="mks-product-modal__text">{text}</p>
            </section>
          ),
      )}
    </div>
  );
}

export function MksProductModal({
  product,
  userId,
  onClose,
}: {
  product: MksProduct;
  userId?: number;
  onClose: () => void;
}) {
  const details = useQuery({
    queryKey: ["mks-product-details", userId, product.id],
    queryFn: () => fetchMksProductDetails(product.id),
    enabled: Boolean(product.id),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const data = details.data?.product?.id === product.id ? details.data : null;
  const focusCard = useCallback((element: HTMLDivElement | null) => {
    element?.focus({ preventScroll: true });
  }, []);

  return (
    <AppModal
      open
      title={data?.product.name || product.name}
      description={`Карточка МКС · Артикул: ${product.sku || "не указан"}`}
      contentClassName="mks-product-modal"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <div className="mks-product-modal__body" ref={focusCard} tabIndex={-1}>
        {details.isLoading ? (
          <div aria-busy="true" role="status" className="mks-product-modal__loading">
            <span>Загружаем карточку товара…</span>
            <AppSkeleton />
          </div>
        ) : details.error ? (
          <AppAlert
            tone="danger"
            title="Не удалось загрузить карточку"
            onRetry={() => void details.refetch()}
            retryLabel="Повторить загрузку карточки"
          >
            {details.error.message}
          </AppAlert>
        ) : data ? (
          <ProductDetails details={data} />
        ) : (
          <AppAlert title="Карточка недоступна" onRetry={() => void details.refetch()}>
            Поставщик не предоставил данные товара. Повторите загрузку.
          </AppAlert>
        )}
      </div>
    </AppModal>
  );
}
