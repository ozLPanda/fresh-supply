const CART_DISCOUNT_PRICES_KEY_PREFIX = "company_shop_cart_discount_prices";

export const CART_DISCOUNT_PRICE_PERMISSIONS = [
  "commerce.prices.wholesale",
  "commerce.prices.bulkWholesale",
  "commerce.prices.sko",
] as const;

export function canUseCartDiscountPrices(permissions?: string[]) {
  return Boolean(
    permissions?.some((permission) =>
      (CART_DISCOUNT_PRICE_PERMISSIONS as readonly string[]).includes(permission),
    ),
  );
}

function keyForUser(userId: number) {
  return `${CART_DISCOUNT_PRICES_KEY_PREFIX}:${userId}`;
}

/**
 * The choice only needs to survive navigation from the cart to checkout. It is scoped to the
 * signed-in user and is cleared automatically when the browser session ends.
 */
export function readCartDiscountPricesEnabled(userId?: number) {
  if (!userId) return false;

  try {
    return sessionStorage.getItem(keyForUser(userId)) === "true";
  } catch {
    return false;
  }
}

export function saveCartDiscountPricesEnabled(userId: number, enabled: boolean) {
  try {
    sessionStorage.setItem(keyForUser(userId), String(enabled));
  } catch {
    // The server remains authoritative if browser storage is unavailable.
  }
}

export function clearCartDiscountPricesEnabled(userId?: number) {
  if (!userId) return;

  try {
    sessionStorage.removeItem(keyForUser(userId));
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}
