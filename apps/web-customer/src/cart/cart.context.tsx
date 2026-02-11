import type { Order, Product } from "@foodo/shared-types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { useFoodoClient } from "../api/foodo.client";
import { useAuth } from "../auth/auth.context";

const CART_STORAGE_KEY = "foodo.customer.cart";

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  totalItems: number;
  subtotal: number;
  isCheckingOut: boolean;
  addProduct: (product: Product) => void;
  removeItem: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  checkout: () => Promise<Order>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: PropsWithChildren) {
  const client = useFoodoClient();
  const { isAuthenticated, isBootstrapping } = useAuth();
  const [items, setItems] = useState<CartItem[]>(() => {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    try {
      return JSON.parse(raw) as CartItem[];
    } catch {
      return [];
    }
  });
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  useEffect(() => {
    if (!isBootstrapping && !isAuthenticated) {
      setItems([]);
    }
  }, [isAuthenticated, isBootstrapping]);

  const addProduct = useCallback((product: Product) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (!existing) {
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity: 1
          }
        ];
      }

      return prev.map((item) =>
        item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
      );
    });
  }, []);

  const removeItem = useCallback((productId: string) => {
    setItems((prev) => prev.filter((item) => item.productId !== productId));
  }, []);

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setItems((prev) =>
      prev
        .map((item) =>
          item.productId === productId ? { ...item, quantity: Math.max(1, Math.floor(quantity)) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
  }, []);

  const checkout = useCallback(async () => {
    if (!items.length) {
      throw new Error("Cart is empty");
    }

    setIsCheckingOut(true);
    try {
      const order = await client.createOrder({ items });
      setItems([]);
      return order;
    } finally {
      setIsCheckingOut(false);
    }
  }, [client, items]);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      totalItems: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)),
      isCheckingOut,
      addProduct,
      removeItem,
      setQuantity,
      clearCart,
      checkout
    }),
    [addProduct, checkout, clearCart, isCheckingOut, items, removeItem, setQuantity]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within CartProvider");
  }

  return context;
}
