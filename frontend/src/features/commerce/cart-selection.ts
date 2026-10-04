import { CartItem } from "@/shared/types/models";

const CART_SELECTION_KEY = "company_shop_cart_selection";

export type CartItemSelection = {
  selectedIds: number[];
  knownItemIds: number[];
};

function normalizeIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))];
}

function parseCartItemSelection(value: string | null): CartItemSelection | null {
  if (value === null) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      const selectedIds = normalizeIds(parsed);
      return { selectedIds, knownItemIds: selectedIds };
    }

    if (typeof parsed !== "object" || parsed === null) return null;
    const selection = parsed as Record<string, unknown>;
    return {
      selectedIds: normalizeIds(selection.selectedIds),
      knownItemIds: normalizeIds(selection.knownItemIds),
    };
  } catch {
    return null;
  }
}

export function readCartItemSelection(): CartItemSelection | null {
  try {
    const localSelection = parseCartItemSelection(localStorage.getItem(CART_SELECTION_KEY));
    if (localSelection !== null) return localSelection;

    // Переносим выбор из предыдущей версии, где он жил только в рамках вкладки.
    return parseCartItemSelection(sessionStorage.getItem(CART_SELECTION_KEY));
  } catch {
    return null;
  }
}

export function saveCartItemSelection(selection: CartItemSelection) {
  localStorage.setItem(CART_SELECTION_KEY, JSON.stringify(selection));
  sessionStorage.removeItem(CART_SELECTION_KEY);
}

export function clearCartItemSelection() {
  localStorage.removeItem(CART_SELECTION_KEY);
  sessionStorage.removeItem(CART_SELECTION_KEY);
}

export function resolveCartItemSelection(items: CartItem[], selection: CartItemSelection | null) {
  const availableIds = items.map((item) => item.id);
  if (selection === null) return availableIds;

  const selectedIdSet = new Set(selection.selectedIds);
  const knownIdSet = new Set(selection.knownItemIds);

  return availableIds.filter(
    (cartItemId) => selectedIdSet.has(cartItemId) || !knownIdSet.has(cartItemId),
  );
}
