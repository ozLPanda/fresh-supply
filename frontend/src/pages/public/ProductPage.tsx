import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FolderOpen, ShoppingCart } from "lucide-react";
import { ApiError, api } from "@/shared/api/http";
import { categoryImageUrl, productImageUrl } from "@/shared/images/imageCache";
import {
  fetchAllStoreProducts,
  fetchStoreCategoryTree,
  fetchStoreProduct,
} from "@/shared/api/catalog";
import { Product } from "@/shared/types/models";
import { StoreLayout } from "@/layouts/StoreLayout";
import { AppAlert, AppSkeleton, AppTooltip } from "@/shared/ui/AppFeedback";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppTabs } from "@/shared/ui/AppControls";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { appToast } from "@/shared/ui/AppToast";
import { ProductGrid } from "@/pages/public/ProductGrid";
import { ProductPriceHistory } from "@/pages/public/ProductPriceHistory";
import { ProductReviews } from "@/pages/public/ProductReviews";
import { StoreEmptyState } from "@/pages/public/StoreEmptyState";
import { absoluteUrl, SeoMeta } from "@/shared/seo/SeoMeta";
import {
  formatDiscountPercent,
  formatMoney,
  flattenCategories,
  getProductDeliveryTerm,
  getProductImage,
  getProductStatusLabel,
  hasPersonalDiscount,
} from "@/pages/public/store-utils";
import "./ProductPage.css";

export function ProductPage() {
  const { addProduct } = useCommerce();
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const categoriesQuery = useQuery({
    queryKey: ["categories", "tree"],
    queryFn: fetchStoreCategoryTree,
  });
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => fetchAllStoreProducts({ active: true }),
  });
  const productQuery = useQuery({
    queryKey: ["product", id],
    queryFn: () => fetchStoreProduct(id!),
    enabled: Boolean(id),
  });

  const categories = categoriesQuery.data ?? [];
  const products = productsQuery.data ?? [];
  const product = productQuery.data;
  const relatedProducts = useMemo(
    () =>
      products
        .filter((item) => item.id !== product?.id && item.categoryId === product?.categoryId)
        .slice(0, 3),
    [product?.categoryId, product?.id, products],
  );
  const category = flattenCategories(categories).find((item) => item.id === product?.categoryId);
  const categorySlug = category?.slug;
  const categoryImageSrc = categoryImageUrl(category);
  const fallbackPath = categorySlug ? `/catalog/${categorySlug}` : "/catalog";
  const returnTo = (location.state as { returnTo?: unknown } | null)?.returnTo;
  let returnPath = fallbackPath;
  if (
    typeof returnTo === "string" &&
    returnTo.startsWith("/") &&
    !returnTo.startsWith("//") &&
    !/[\\\u0000-\u001f]/.test(returnTo)
  ) {
    const target = new URL(returnTo, window.location.origin);
    if (
      target.origin === window.location.origin &&
      (target.pathname === "/" ||
        target.pathname === "/categories" ||
        target.pathname === "/catalog" ||
        target.pathname.startsWith("/catalog/"))
    ) {
      returnPath = `${target.pathname}${target.search}${target.hash}`;
    }
  }

  const image = product ? getProductImage(product) : null;
  const imageSrc = image ? (productImageUrl(image) ?? "") : "";

  useEffect(() => {
    if (!id || !product) return;
    const timestampKey = `company_shop_product_view_${id}`;
    const lastViewedAt = Number(localStorage.getItem(timestampKey) ?? 0);
    if (Date.now() - lastViewedAt < 30 * 60 * 1000) return;

    const visitorKey = "company_shop_visitor_id";
    let visitorId = localStorage.getItem(visitorKey);
    if (!visitorId) {
      visitorId =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(visitorKey, visitorId);
    }
    localStorage.setItem(timestampKey, String(Date.now()));
    void api<void>(`/api/products/${id}/views`, {
      method: "POST",
      body: JSON.stringify({ visitorId }),
    }).catch(() => {
      localStorage.removeItem(timestampKey);
    });
  }, [id, product]);

  async function addToCart(productToAdd: Product) {
    try {
      const added = await addProduct(productToAdd);
      if (added) appToast.success("Товар добавлен в корзину");
    } catch (exception) {
      appToast.error(exception instanceof Error ? exception.message : "Не удалось добавить товар");
    }
  }

  return (
    <StoreLayout categories={categories}>
      {!product && (
        <SeoMeta
          title={
            productQuery.isLoading
              ? "Загрузка товара | Фирма «Актив»"
              : "Товар недоступен | Фирма «Актив»"
          }
          description="Информация о товаре временно недоступна или товар не найден."
          canonicalPath={`/product/${id}`}
          pending={productQuery.isLoading}
          robots={productQuery.isLoading ? "index,follow" : "noindex,follow"}
        />
      )}
      {product && (
        <SeoMeta
          title={`${product.nameRu} — купить в Фирме «Актив»`}
          description={
            product.shortDescriptionRu?.trim() ||
            product.descriptionRu?.trim() ||
            `${product.nameRu}. Артикул ${product.sku}. Цена и заказ в Фирме «Актив».`
          }
          canonicalPath={`/product/${product.id}`}
          image={imageSrc || null}
          robots={product.active ? "index,follow" : "noindex,follow"}
          structuredData={[
            {
              "@context": "https://schema.org",
              "@type": "Product",
              name: product.nameRu,
              sku: product.sku,
              description:
                product.shortDescriptionRu?.trim() ||
                product.descriptionRu?.trim() ||
                `${product.nameRu}.`,
              image: absoluteUrl(imageSrc) || undefined,
              category: product.categoryNameRu || undefined,
              offers:
                product.price != null && Number.isFinite(product.price) && product.price >= 0
                  ? {
                      "@type": "Offer",
                      priceCurrency: "KZT",
                      price: product.price,
                      availability: product.active
                        ? product.madeToOrder
                          ? "https://schema.org/BackOrder"
                          : "https://schema.org/InStock"
                        : "https://schema.org/OutOfStock",
                      itemCondition: "https://schema.org/NewCondition",
                      url: `${window.location.origin}/product/${product.id}`,
                    }
                  : undefined,
            },
            {
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Главная", item: window.location.origin },
                {
                  "@type": "ListItem",
                  position: 2,
                  name: "Каталог",
                  item: `${window.location.origin}/catalog`,
                },
                ...(category && categorySlug
                  ? [
                      {
                        "@type": "ListItem",
                        position: 3,
                        name: category.nameRu,
                        item: `${window.location.origin}/catalog/${categorySlug}`,
                      },
                    ]
                  : []),
                {
                  "@type": "ListItem",
                  position: category && categorySlug ? 4 : 3,
                  name: product.nameRu,
                  item: `${window.location.origin}/product/${product.id}`,
                },
              ],
            },
          ]}
        />
      )}
      <section className="product-page">
        {productQuery.isLoading ? (
          <AppCard className="product-page__hero product-page__hero--loading">
            <AppSkeleton />
          </AppCard>
        ) : product ? (
          <div className="product-page__hero">
            <AppTooltip content="Назад">
              <AppButton
                type="button"
                variant="secondary"
                className="product-page__icon-button product-page__back-button"
                aria-label="Назад"
                onClick={() => navigate(returnPath, { replace: true })}
              >
                <ArrowLeft size={18} />
              </AppButton>
            </AppTooltip>

            <div className="product-page__media">
              {imageSrc && failedImageSrc !== imageSrc ? (
                <img
                  src={imageSrc}
                  alt={product.nameRu}
                  onError={() => setFailedImageSrc(imageSrc)}
                />
              ) : (
                <div className="product-page__fallback">
                  {product.categoryNameRu ?? product.nameRu}
                </div>
              )}
            </div>
            <div className="product-page__content">
              <div className="product-page__meta">
                <AppBadge tone={product.active ? "green" : "orange"}>
                  {getProductStatusLabel(product)}
                </AppBadge>
                <span>Артикул: {product.sku}</span>
              </div>
              <h1>{product.nameRu}</h1>
              <p className="product-page__lead">
                {product.descriptionRu ??
                  product.shortDescriptionRu ??
                  "Подробное описание скоро появится."}
              </p>

              <div className="product-page__buy-panel">
                <div className="product-page__price-block">
                  <span>Цена</span>
                  {hasPersonalDiscount(
                    product.price,
                    product.regularPrice,
                    product.personalDiscountPercent,
                  ) && (
                    <div className="product-page__previous-price">
                      <s>{formatMoney(product.regularPrice)}</s>
                      <b>−{formatDiscountPercent(product.personalDiscountPercent)}%</b>
                    </div>
                  )}
                  <strong className="product-page__price">{formatMoney(product.price)}</strong>
                </div>
                <div className="product-page__actions">
                  <AppTooltip content="Добавить в корзину">
                    <AppButton
                      type="button"
                      className="product-page__icon-button"
                      aria-label="Добавить в корзину"
                      disabled={!product.active}
                      onClick={() => void addToCart(product)}
                    >
                      <ShoppingCart size={19} />
                    </AppButton>
                  </AppTooltip>
                  <AppTooltip content="Перейти к категории">
                    <AppButton
                      asChild
                      variant="secondary"
                      className="product-page__icon-button"
                      aria-label="Перейти к категории"
                    >
                      <Link to={categorySlug ? `/catalog/${categorySlug}` : "/catalog"}>
                        <FolderOpen size={19} />
                      </Link>
                    </AppButton>
                  </AppTooltip>
                </div>
              </div>
            </div>
          </div>
        ) : productQuery.error instanceof ApiError && productQuery.error.status === 404 ? (
          <AppAlert title="Товар не найден" tone="warning">
            Возможно, товар был удалён или адрес страницы устарел.
          </AppAlert>
        ) : null}

        {product && (
          <AppCard className="product-page__tabs-card">
            <AppTabs
              variant="segmented"
              defaultValue="specs"
              items={[
                {
                  value: "specs",
                  label: "Характеристики",
                  content: (
                    <dl className="product-page__specs">
                      <div>
                        <dt>Категория</dt>
                        <dd className="product-page__category-value">
                          <span>{product.categoryNameRu ?? "Не указана"}</span>
                          {categoryImageSrc && (
                            <img src={categoryImageSrc} alt="" aria-hidden="true" />
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Статус</dt>
                        <dd>{getProductStatusLabel(product)}</dd>
                      </div>
                      {product.madeToOrder && (
                        <div>
                          <dt>Срок доставки</dt>
                          <dd>{getProductDeliveryTerm(product)}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Цена</dt>
                        <dd>{formatMoney(product.price)}</dd>
                      </div>
                      <div>
                        <dt>Артикул</dt>
                        <dd>{product.sku}</dd>
                      </div>
                    </dl>
                  ),
                },
                {
                  value: "description",
                  label: "Описание",
                  content: (
                    <p className="product-page__description">
                      {product.descriptionRu ??
                        product.shortDescriptionRu ??
                        "Описание отсутствует."}
                    </p>
                  ),
                },
                {
                  value: "reviews",
                  label: "Отзывы",
                  content: product.id ? <ProductReviews productId={product.id} /> : null,
                },
              ]}
            />
          </AppCard>
        )}

        {product?.id && (
          <AppCard
            className="product-page__price-history"
            title="Динамика цены"
            description="История изменений розничной цены товара"
          >
            <ProductPriceHistory productId={product.id} />
          </AppCard>
        )}

        {relatedProducts.length > 0 && (
          <section className="product-page__related">
            <div className="product-page__related-head">
              <div>
                <p>Рекомендуем</p>
                <h2>Похожие товары</h2>
              </div>
            </div>
            <ProductGrid products={relatedProducts} />
          </section>
        )}

        {productQuery.isError &&
          !(productQuery.error instanceof ApiError && productQuery.error.status === 404) && (
            <StoreEmptyState
              title="Не удалось загрузить товар"
              description="Проверьте соединение с API и повторите попытку."
              tone="danger"
              onRetry={() => productQuery.refetch()}
            />
          )}
      </section>
    </StoreLayout>
  );
}
