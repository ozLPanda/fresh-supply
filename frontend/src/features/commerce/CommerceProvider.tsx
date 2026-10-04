import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/http";
import { Cart, CartItem, CurrentUser, Product } from "@/shared/types/models";
import { clearCartItemSelection } from "@/features/commerce/cart-selection";
import { MadeToOrderCartConfirmationModal } from "@/features/commerce/MadeToOrderCartConfirmationModal";
import { pushPromptSession } from "@/features/notifications/pushPromptSession";

const GUEST_CART_KEY = "company_shop_guest_cart";
const MADE_TO_ORDER_CONFIRMATION_DISABLED_KEY =
  "company_shop_made_to_order_cart_confirmation_disabled";
const emptyCart: Cart = { items: [], itemCount: 0, total: 0 };

type PendingMadeToOrderAddition = {
  product: Product;
  quantity: number;
  resolve: (added: boolean) => void;
  reject: (error: unknown) => void;
};

function isMadeToOrderConfirmationDisabled() {
  try {
    return localStorage.getItem(MADE_TO_ORDER_CONFIRMATION_DISABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function readGuestCart(): CartItem[] {
  try {
    return (JSON.parse(localStorage.getItem(GUEST_CART_KEY) ?? "[]") as CartItem[]).map((item) => ({
      ...item,
      id: item.id ?? -item.productId,
    }));
  } catch {
    return [];
  }
}

function resolveGuestUnitPrice(item: CartItem) {
  const regularPrice = item.regularPrice ?? item.price;
  return {
    regularPrice,
    wholesale: false,
    price: regularPrice,
  };
}

function guestCart(items: CartItem[]): Cart {
  const normalizedItems = items.map((item) => {
    const price = resolveGuestUnitPrice(item);
    return {
      ...item,
      regularPrice: price.regularPrice,
      price: price.price,
      wholesale: price.wholesale,
      lineTotal: price.price * item.quantity,
    };
  });
  return {
    items: normalizedItems,
    itemCount: normalizedItems.reduce((sum, item) => sum + item.quantity, 0),
    total: normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0),
  };
}

type CommerceContextValue = {
  user: CurrentUser | null;
  authLoading: boolean;
  cart: Cart;
  cartLoading: boolean;
  login: (phone: string, password: string) => Promise<CurrentUser>;
  register: (input: {
    name: string;
    phone: string;
    email?: string;
    password: string;
  }) => Promise<CurrentUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshCart: () => Promise<void>;
  addProduct: (product: Product, quantity?: number) => Promise<boolean>;
  setQuantity: (productId: number, quantity: number) => Promise<void>;
  removeProduct: (productId: number) => Promise<void>;
  clearCart: () => Promise<void>;
};

const CommerceContext = createContext<CommerceContextValue | null>(null);

export function CommerceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cart, setCart] = useState<Cart>(() => guestCart(readGuestCart()));
  const [cartLoading, setCartLoading] = useState(true);
  const [pendingMadeToOrderAddition, setPendingMadeToOrderAddition] =
    useState<PendingMadeToOrderAddition | null>(null);
  const [rememberMadeToOrderChoice, setRememberMadeToOrderChoice] = useState(false);
  const [madeToOrderConfirmationDisabled, setMadeToOrderConfirmationDisabled] = useState(
    isMadeToOrderConfirmationDisabled,
  );
  const [confirmingMadeToOrderAddition, setConfirmingMadeToOrderAddition] = useState(false);

  const saveGuest = useCallback((items: CartItem[]) => {
    const nextCart = guestCart(items);
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(nextCart.items));
    setCart(nextCart);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api<CurrentUser>("/api/auth/me"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["product"] }),
      ]);
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, [queryClient]);

  const refreshCart = useCallback(async () => {
    try {
      setCart(await api<Cart>("/api/cart"));
    } catch {
      setCart(guestCart(readGuestCart()));
    } finally {
      setCartLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function initializeCommerce() {
      const userResult = await Promise.allSettled([api<CurrentUser>("/api/auth/me")]);

      if (!active) return;

      if (userResult[0].status !== "fulfilled") {
        setUser(null);
        setCart(guestCart(readGuestCart()));
        setAuthLoading(false);
        setCartLoading(false);
        return;
      }

      setUser(userResult[0].value);
      setAuthLoading(false);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["product"] }),
      ]);

      try {
        const initialCart = await api<Cart>("/api/cart");
        if (active) setCart(initialCart);
      } catch {
        if (active) setCart(guestCart(readGuestCart()));
      } finally {
        if (active) setCartLoading(false);
      }
    }

    void initializeCommerce();

    return () => {
      active = false;
    };
  }, [queryClient]);

  async function finishAuthentication() {
    const guest = readGuestCart();
    if (guest.length) {
      setCart(
        await api<Cart>("/api/cart/merge", {
          method: "POST",
          body: JSON.stringify({
            items: guest.map(({ productId, quantity }) => ({ productId, quantity })),
          }),
        }),
      );
      localStorage.removeItem(GUEST_CART_KEY);
      clearCartItemSelection();
    } else {
      await refreshCart();
    }
    const current = await api<CurrentUser>("/api/auth/me");
    setUser(current);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["product"] }),
    ]);
    return current;
  }

  async function login(phone: string, password: string) {
    await api<unknown>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password }),
    });
    return finishAuthentication();
  }

  async function register(input: {
    name: string;
    phone: string;
    email?: string;
    password: string;
  }) {
    await api<unknown>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return finishAuthentication();
  }

  async function logout() {
    try {
      await api<void>("/api/auth/logout", { method: "POST" });
    } finally {
      pushPromptSession.reset();
      clearCartItemSelection();
      setUser(null);
      setCart(guestCart(readGuestCart()));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["product"] }),
      ]);
    }
  }

  const addProductToCart = useCallback(
    async (product: Product, quantity: number) => {
      if (!product.id || product.price === null) return;
      if (user) {
        setCart(
          await api<Cart>("/api/cart/items", {
            method: "POST",
            body: JSON.stringify({ productId: product.id, quantity }),
          }),
        );
        return;
      }
      const current = readGuestCart();
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        existing.quantity = Math.min(999, existing.quantity + quantity);
        existing.regularPrice = product.price;
        existing.wholesalePrice = product.wholesalePrice;
      } else {
        current.push({
          id: -product.id,
          productId: product.id,
          sku: product.sku,
          nameRu: product.nameRu,
          price: product.price,
          regularPrice: product.price,
          wholesalePrice: product.wholesalePrice,
          available: product.active,
          madeToOrder: product.madeToOrder,
          quantity,
          lineTotal: 0,
          imagePath: product.images?.find((image) => image.mainImage)?.filePath,
          imageContentHash: product.images?.find((image) => image.mainImage)?.contentHash,
        });
      }
      saveGuest(current);
    },
    [saveGuest, user],
  );

  const addProduct = useCallback(
    async (product: Product, quantity = 1) => {
      if (!product.id || product.price === null) return false;
      if (product.madeToOrder && !madeToOrderConfirmationDisabled) {
        return new Promise<boolean>((resolve, reject) => {
          setRememberMadeToOrderChoice(false);
          setPendingMadeToOrderAddition({ product, quantity, resolve, reject });
        });
      }
      await addProductToCart(product, quantity);
      return true;
    },
    [addProductToCart, madeToOrderConfirmationDisabled],
  );

  function cancelMadeToOrderAddition() {
    if (confirmingMadeToOrderAddition) return;
    pendingMadeToOrderAddition?.resolve(false);
    setPendingMadeToOrderAddition(null);
  }

  async function confirmMadeToOrderAddition() {
    const pending = pendingMadeToOrderAddition;
    if (!pending) return;
    setConfirmingMadeToOrderAddition(true);
    try {
      await addProductToCart(pending.product, pending.quantity);
      if (rememberMadeToOrderChoice) {
        try {
          localStorage.setItem(MADE_TO_ORDER_CONFIRMATION_DISABLED_KEY, "true");
        } catch {
          // The addition still succeeds when persistent browser storage is unavailable.
        }
        setMadeToOrderConfirmationDisabled(true);
      }
      pending.resolve(true);
      setPendingMadeToOrderAddition(null);
    } catch (error) {
      pending.reject(error);
      setPendingMadeToOrderAddition(null);
    } finally {
      setConfirmingMadeToOrderAddition(false);
    }
  }

  async function setQuantityValue(productId: number, quantity: number) {
    if (user) {
      setCart(
        await api<Cart>(`/api/cart/items/${productId}?quantity=${quantity}`, { method: "PUT" }),
      );
      return;
    }
    saveGuest(
      readGuestCart().map((item) => (item.productId === productId ? { ...item, quantity } : item)),
    );
  }

  async function removeProduct(productId: number) {
    if (user) {
      setCart(await api<Cart>(`/api/cart/items/${productId}`, { method: "DELETE" }));
      return;
    }
    saveGuest(readGuestCart().filter((item) => item.productId !== productId));
  }

  async function clearCart() {
    if (user) {
      await api<void>("/api/cart", { method: "DELETE" });
      setCart(emptyCart);
      return;
    }
    localStorage.removeItem(GUEST_CART_KEY);
    setCart(emptyCart);
  }

  const value = useMemo<CommerceContextValue>(
    () => ({
      user,
      authLoading,
      cart,
      cartLoading,
      login,
      register,
      logout,
      refreshUser,
      refreshCart,
      addProduct,
      setQuantity: setQuantityValue,
      removeProduct,
      clearCart,
    }),
    [addProduct, authLoading, cart, cartLoading, refreshCart, refreshUser, user],
  );

  return (
    <CommerceContext.Provider value={value}>
      {children}
      <MadeToOrderCartConfirmationModal
        product={pendingMadeToOrderAddition?.product ?? null}
        rememberChoice={rememberMadeToOrderChoice}
        submitting={confirmingMadeToOrderAddition}
        onOpenChange={(open) => !open && cancelMadeToOrderAddition()}
        onRememberChoiceChange={setRememberMadeToOrderChoice}
        onCancel={cancelMadeToOrderAddition}
        onConfirm={() => void confirmMadeToOrderAddition()}
      />
    </CommerceContext.Provider>
  );
}

export function useCommerce() {
  const context = useContext(CommerceContext);
  if (!context) throw new Error("useCommerce must be used inside CommerceProvider");
  return context;
}
