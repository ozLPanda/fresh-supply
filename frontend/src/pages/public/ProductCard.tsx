import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Pencil, ShoppingCart } from "lucide-react";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppModal } from "@/shared/ui/AppFeedback";
import { productImageUrl } from "@/shared/images/imageCache";
import { Product } from "@/shared/types/models";
import {
  formatDiscountPercent,
  formatMoney,
  getProductAvailabilityTone,
  getProductImage,
  getProductStatusLabel,
  hasPersonalDiscount,
} from "./store-utils";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { appToast } from "@/shared/ui/AppToast";
import { ProductFormPage } from "@/pages/admin/ProductFormPage";
import "./ProductCard.css";

function ProductPlaceholder({ title }: { title: string }) {
  return (
    <div className="product-card__placeholder">
      <span>{title.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

function ProductBody({ product }: { product: Product }) {
  const { addProduct } = useCommerce();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;

  async function add() {
    try {
      const added = await addProduct(product);
      if (added) appToast.success("Товар добавлен в корзину");
    } catch (exception) {
      appToast.error(exception instanceof Error ? exception.message : "Не удалось добавить товар");
    }
  }

  return (
    <div className="product-card__body">
      <div className="product-card__meta">
        <span>Артикул: {product.sku}</span>
        <span>{product.categoryNameRu ?? "Каталог"}</span>
      </div>
      <Link
        className="product-card__title"
        to={`/product/${product.id ?? ""}`}
        state={{ returnTo }}
      >
        {product.nameRu}
      </Link>
      <p>
        {product.shortDescriptionRu ??
          product.descriptionRu ??
          "Профессиональный товар для инженерных систем."}
      </p>
      <div className="product-card__pricing">
        <div className="product-card__price">
          {hasPersonalDiscount(
            product.price,
            product.regularPrice,
            product.personalDiscountPercent,
          ) && (
            <div className="product-card__previous-price">
              <s>{formatMoney(product.regularPrice)}</s>
              <span>−{formatDiscountPercent(product.personalDiscountPercent)}%</span>
            </div>
          )}
          <strong>{formatMoney(product.price)}</strong>
        </div>
        <div className="product-card__actions">
          <AppButton
            type="button"
            className="product-card__action product-card__cart-action"
            disabled={!product.active}
            aria-label={`Добавить «${product.nameRu}» в корзину`}
            title="Добавить в корзину"
            onClick={() => void add()}
          >
            <ShoppingCart size={18} />
          </AppButton>
          <AppButton asChild variant="secondary" className="product-card__action">
            <Link to={`/product/${product.id ?? ""}`} state={{ returnTo }}>
              Подробнее
              <ChevronRight size={16} />
            </Link>
          </AppButton>
        </div>
      </div>
    </div>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const { user } = useCommerce();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  const [cardProduct, setCardProduct] = useState(product);
  const [editing, setEditing] = useState(false);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const image = getProductImage(cardProduct);
  const imageSrc = image ? (productImageUrl(image) ?? "") : "";
  const canEdit =
    Boolean(cardProduct.id) && (user?.permissions?.includes("products.update") ?? false);

  useEffect(() => setCardProduct(product), [product]);

  return (
    <article className="product-card" title={cardProduct.nameRu}>
      {canEdit && (
        <button
          type="button"
          className="product-card__edit"
          onClick={() => setEditing(true)}
          aria-label={`Редактировать товар «${cardProduct.nameRu}»`}
          title="Редактировать товар"
        >
          <Pencil size={16} aria-hidden="true" />
        </button>
      )}
      <Link
        className="product-card__media"
        to={`/product/${cardProduct.id ?? ""}`}
        state={{ returnTo }}
      >
        {imageSrc && failedImageSrc !== imageSrc ? (
          <img
            src={imageSrc}
            alt={cardProduct.nameRu}
            loading="lazy"
            decoding="async"
            onError={() => setFailedImageSrc(imageSrc)}
          />
        ) : (
          <ProductPlaceholder title={cardProduct.categoryNameRu ?? cardProduct.nameRu} />
        )}
        <div className="product-card__badges">
          <AppBadge tone={getProductAvailabilityTone(cardProduct)}>
            {getProductStatusLabel(cardProduct)}
          </AppBadge>
        </div>
      </Link>

      <ProductBody product={cardProduct} />
      {canEdit && cardProduct.id && (
        <AppModal
          open={editing}
          onOpenChange={setEditing}
          title="Редактирование товара"
          contentClassName="product-card__edit-modal"
        >
          <ProductFormPage
            embedded
            productId={cardProduct.id}
            onSaved={(savedProduct) => {
              setCardProduct(savedProduct);
              setEditing(false);
            }}
          />
        </AppModal>
      )}
    </article>
  );
}
