import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { StoreLayout } from "@/layouts/StoreLayout";
import { useCommerce } from "@/features/commerce/CommerceProvider";
import { api } from "@/shared/api/http";
import { imageUrl } from "@/shared/images/imageCache";
import { Cart } from "@/shared/types/models";
import {
  formatDiscountPercent,
  formatMoney,
  hasPriceChange,
  hasPersonalDiscount,
  normalizeText,
} from "@/pages/public/store-utils";
import { AppBadge } from "@/shared/ui/AppBadge";
import { AppButton } from "@/shared/ui/AppButton";
import { AppCard } from "@/shared/ui/AppCard";
import { AppCheckbox } from "@/shared/ui/AppControls";
import { AppSearchInput } from "@/shared/ui/AppField";
import { AppSkeleton } from "@/shared/ui/AppFeedback";
import { StoreEmptyState } from "@/pages/public/StoreEmptyState";
import { CartPriceLevels } from "@/features/commerce/CartPriceLevels";
import { TemporaryInvoicePanel } from "@/features/commerce/TemporaryInvoicePanel";
import {
  CartItemSelection,
  readCartItemSelection,
  resolveCartItemSelection,
  saveCartItemSelection,
} from "@/features/commerce/cart-selection";
import {
  canUseCartDiscountPrices,
  readCartDiscountPricesEnabled,
  saveCartDiscountPricesEnabled,
} from "@/features/commerce/cart-price-mode";
import "./CommercePages.css";

function clampQuantity(value: number) {
  return Math.min(Math.max(value, 1), 999);
}

const CART_TIER_LABELS = {
  WHOLESALE: "Опт",
  BULK_WHOLESALE: "Крупный опт",
  SKO: "СКО",
} as const;

function CartQuantityControl({
  productId,
  quantity,
  onQuantityChange,
}: {
  productId: number;
  quantity: number;
  onQuantityChange: (productId: number, quantity: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(quantity));

  useEffect(() => {
    setDraft(String(quantity));
  }, [quantity]);

  function commit(nextDraft = draft) {
    const parsed = Number.parseInt(nextDraft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(quantity));
      return;
    }

    const nextQuantity = clampQuantity(parsed);
    setDraft(String(nextQuantity));
    if (nextQuantity !== quantity) void onQuantityChange(productId, nextQuantity);
  }

  function changeDraft(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value.replace(/\D/g, "");
    setDraft(nextValue.slice(0, 3));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      setDraft(String(quantity));
      event.currentTarget.blur();
    }
  }

  return (
    <div className="commerce-quantity">
      <AppButton
        type="button"
        variant="ghost"
        aria-label="Уменьшить количество"
        disabled={quantity <= 1}
        onClick={() => void onQuantityChange(productId, quantity - 1)}
      >
        <Minus size={16} />
      </AppButton>
      <input
        className="commerce-quantity__input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        aria-label="Количество"
        onChange={changeDraft}
        onBlur={() => commit()}
        onKeyDown={handleKeyDown}
      />
      <AppButton
        type="button"
        variant="ghost"
        aria-label="Увеличить количество"
        disabled={quantity >= 999}
        onClick={() => void onQuantityChange(productId, quantity + 1)}
      >
        <Plus size={16} />
      </AppButton>
    </div>
  );
}

export function CartPage() {
  const { user, cart, cartLoading, setQuantity, removeProduct } = useCommerce();
  const canUseCartPriceLevels = canUseCartDiscountPrices(user?.permissions);
  const [savedSelection, setSavedSelection] = useState<CartItemSelection | null>(
    readCartItemSelection,
  );
  const [discountPricesEnabled, setDiscountPricesEnabled] = useState(false);
  const [search, setSearch] = useState("");
  const selectedCartItemIds = useMemo(
    () => resolveCartItemSelection(cart.items, savedSelection),
    [cart.items, savedSelection],
  );
  const selectedCartItemIdSet = useMemo(() => new Set(selectedCartItemIds), [selectedCartItemIds]);
  const selectedItems = useMemo(
    () => cart.items.filter((item) => selectedCartItemIdSet.has(item.id)),
    [cart.items, selectedCartItemIdSet],
  );
  const selectedCartVersion = useMemo(
    () =>
      selectedItems
        .map(
          (item) =>
            `${item.id}:${item.quantity}:${item.price}:${item.regularPrice ?? ""}:${item.priceTier ?? ""}`,
        )
        .join("|"),
    [selectedItems],
  );
  const selectedCartPreview = useQuery({
    queryKey: ["cart-selection-preview", selectedCartVersion, discountPricesEnabled],
    queryFn: () =>
      api<Cart>("/api/cart/selection-preview", {
        method: "POST",
        body: JSON.stringify({
          cartItemIds: selectedCartItemIds,
          useDiscountPrices: discountPricesEnabled,
        }),
      }),
    enabled: Boolean(user && selectedCartItemIds.length),
    placeholderData: keepPreviousData,
  });
  const selectedPricing = selectedCartPreview.data;
  const selectedPricingByItemId = useMemo(
    () => new Map(selectedPricing?.items.map((item) => [item.id, item]) ?? []),
    [selectedPricing],
  );
  const selectionPricingReady =
    !user || Boolean(selectedPricing && !selectedCartPreview.isFetching);
  const selectedItemCount = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const selectedTotal =
    selectedPricing?.total ?? selectedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const visibleItems = useMemo(() => {
    const tokens = normalizeText(search).split(/\s+/).filter(Boolean);
    if (!tokens.length) return cart.items;

    return cart.items.filter((item) => {
      const searchIndex = normalizeText(`${item.nameRu} ${item.sku}`);
      return tokens.every((token) => searchIndex.includes(token));
    });
  }, [cart.items, search]);

  useEffect(() => {
    saveCartItemSelection({
      selectedIds: selectedCartItemIds,
      knownItemIds: cart.items.map((item) => item.id),
    });
  }, [cart.items, selectedCartItemIds]);

  useEffect(() => {
    setDiscountPricesEnabled(
      canUseCartPriceLevels ? readCartDiscountPricesEnabled(user?.id) : false,
    );
  }, [canUseCartPriceLevels, user?.id]);

  function updateSelection(nextSelection: number[]) {
    setSavedSelection({
      selectedIds: nextSelection,
      knownItemIds: cart.items.map((item) => item.id),
    });
  }

  function toggleItem(cartItemId: number, checked: boolean) {
    updateSelection(
      checked
        ? [...selectedCartItemIds, cartItemId]
        : selectedCartItemIds.filter((selectedId) => selectedId !== cartItemId),
    );
  }

  function toggleDiscountPrices(checked: boolean) {
    if (!user) return;
    const nextEnabled = checked && canUseCartPriceLevels;
    setDiscountPricesEnabled(nextEnabled);
    saveCartDiscountPricesEnabled(user.id, nextEnabled);
  }

  return (
    <StoreLayout>
      <section className="commerce-page">
        <header className="commerce-heading">
          <p className="commerce-eyebrow">Покупки</p>
          <h1>Корзина</h1>
        </header>
        {cartLoading ? (
          <AppCard>
            <AppSkeleton />
          </AppCard>
        ) : cart.items.length === 0 ? (
          <StoreEmptyState
            title="Корзина пуста"
            description="Добавьте товары из каталога — они останутся здесь даже до входа."
            actionLabel="Перейти в каталог"
            onAction={() => (window.location.href = "/catalog")}
          />
        ) : (
          <>
            {canUseCartPriceLevels && (
              <AppCard className="commerce-cart-price-mode">
                <AppCheckbox
                  label="Использовать систему скидок"
                  description="По умолчанию действует розничная цена. Включите, чтобы открыть доступные оптовые уровни и применить самый выгодный из них при оформлении."
                  checked={discountPricesEnabled}
                  onCheckedChange={toggleDiscountPrices}
                />
              </AppCard>
            )}
            {discountPricesEnabled &&
            selectedPricing?.priceTiers?.length &&
            selectedPricing.priceTier ? (
              <CartPriceLevels
                tiers={selectedPricing.priceTiers}
                appliedTier={selectedPricing.priceTier}
              />
            ) : null}
            {discountPricesEnabled &&
            user?.permissions.includes("commerce.invoices.create") &&
            selectedCartItemIds.length > 0 ? (
              <TemporaryInvoicePanel
                cartItemIds={selectedCartItemIds}
                cartVersion={selectedCartVersion}
              />
            ) : null}
            <div className="commerce-cart-layout">
              <div className="commerce-cart-list">
                <AppCard className="commerce-cart-selection">
                  <div className="commerce-cart-selection__content">
                    <div>
                      <strong>Выбрано для заказа: {selectedItems.length}</strong>
                      <span>
                        {search.trim()
                          ? `Найдено: ${visibleItems.length} из ${cart.items.length}`
                          : `Позиций в корзине: ${cart.items.length}`}
                      </span>
                    </div>
                    <div className="commerce-cart-selection__actions">
                      <AppButton
                        type="button"
                        variant="secondary"
                        disabled={selectedItems.length === cart.items.length}
                        onClick={() => updateSelection(cart.items.map((item) => item.id))}
                      >
                        Выбрать все
                      </AppButton>
                      <AppButton
                        type="button"
                        variant="ghost"
                        disabled={selectedItems.length === 0}
                        onClick={() => updateSelection([])}
                      >
                        Снять выбор
                      </AppButton>
                    </div>
                  </div>
                  <AppSearchInput
                    fieldClassName="commerce-cart-selection__search"
                    value={search}
                    placeholder="Поиск"
                    aria-label="Поиск товаров в корзине"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </AppCard>
                {visibleItems.map((item) => {
                  const pricingItem = selectedPricingByItemId.get(item.id) ?? item;
                  return (
                    <AppCard key={item.productId} className="commerce-cart-item">
                      <div className="commerce-cart-item__select">
                        <AppCheckbox
                          label={`Выбрать товар «${item.nameRu}»`}
                          checked={selectedCartItemIdSet.has(item.id)}
                          onCheckedChange={(checked) => toggleItem(item.id, checked)}
                        />
                      </div>
                      <div className="commerce-cart-item__image">
                        {item.imagePath ? (
                          <img
                            src={imageUrl(item.imagePath, item.imageContentHash) ?? ""}
                            alt={item.nameRu}
                          />
                        ) : (
                          <ShoppingCart size={28} />
                        )}
                      </div>
                      <div className="commerce-cart-item__body">
                        <span>Артикул: {item.sku}</span>
                        <Link to={`/product/${item.productId}`}>{item.nameRu}</Link>
                        {item.madeToOrder && <AppBadge tone="orange">Под заказ</AppBadge>}
                        {hasPriceChange(pricingItem.price, pricingItem.regularPrice) ? (
                          <span className="commerce-cart-item__previous-price">
                            <s>{formatMoney(pricingItem.regularPrice)}</s>
                            <span aria-hidden="true">→</span>
                            <b>{formatMoney(pricingItem.price)}</b>
                          </span>
                        ) : (
                          <strong>{formatMoney(pricingItem.price)}</strong>
                        )}
                        {hasPersonalDiscount(
                          pricingItem.price,
                          pricingItem.regularPrice,
                          pricingItem.personalDiscountPercent,
                        ) && (
                          <span>
                            Скидка −{formatDiscountPercent(pricingItem.personalDiscountPercent)}%
                          </span>
                        )}
                        {pricingItem.priceTier && pricingItem.priceTier !== "RETAIL" && (
                          <AppBadge tone="green">
                            {CART_TIER_LABELS[pricingItem.priceTier]}
                          </AppBadge>
                        )}
                      </div>
                      <CartQuantityControl
                        productId={item.productId}
                        quantity={item.quantity}
                        onQuantityChange={setQuantity}
                      />
                      <strong className="commerce-cart-item__total">
                        {formatMoney(pricingItem.lineTotal)}
                      </strong>
                      <AppButton
                        className="commerce-cart-item__remove"
                        type="button"
                        variant="ghost"
                        aria-label={`Удалить ${item.nameRu}`}
                        onClick={() => void removeProduct(item.productId)}
                      >
                        <Trash2 size={18} />
                      </AppButton>
                    </AppCard>
                  );
                })}
                {search.trim() && visibleItems.length === 0 && (
                  <AppCard className="commerce-cart-search-empty">
                    <strong>Товары не найдены</strong>
                    <span>Попробуйте изменить запрос или очистить поиск.</span>
                    <AppButton type="button" variant="ghost" onClick={() => setSearch("")}>
                      Очистить поиск
                    </AppButton>
                  </AppCard>
                )}
              </div>
              <AppCard className="commerce-summary" title="Итого">
                <div>
                  <span>Товаров</span>
                  <b>{selectedItemCount}</b>
                </div>
                <div className="commerce-summary__total">
                  <span>К оплате</span>
                  <strong>
                    {selectionPricingReady ? formatMoney(selectedTotal) : "Пересчитываем…"}
                  </strong>
                </div>
                {selectedItems.length ? (
                  selectionPricingReady ? (
                    <AppButton asChild>
                      <Link to="/checkout">Оформить заказ</Link>
                    </AppButton>
                  ) : (
                    <AppButton disabled>Пересчитываем…</AppButton>
                  )
                ) : (
                  <AppButton disabled>Выберите товары</AppButton>
                )}
              </AppCard>
            </div>
          </>
        )}
      </section>
    </StoreLayout>
  );
}
