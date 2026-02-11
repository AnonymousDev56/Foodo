import type { Order, OrderLiveMessage } from "@foodo/shared-types";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/auth.context";

const ordersApiUrl = import.meta.env.VITE_ORDERS_API_URL ?? "http://localhost:3002";

function buildOrdersWsUrl(token: string) {
  const resolvedOrdersApiUrl =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/app/") || window.location.port === "8080")
      ? window.location.origin
      : ordersApiUrl;
  const wsBase = resolvedOrdersApiUrl.replace(/^http/, "ws");
  const url = new URL("/orders/ws", wsBase);
  url.searchParams.set("token", token);
  return url.toString();
}

function parseOrderLiveMessage(raw: string): Order | null {
  try {
    const payload = JSON.parse(raw) as OrderLiveMessage;
    if (payload.type !== "order.updated" || !payload.order?.id) {
      return null;
    }
    return payload.order;
  } catch {
    return null;
  }
}

interface UseOrdersLiveOptions {
  enabled?: boolean;
  onOrderUpdated: (order: Order) => void;
}

export function useOrdersLive({ enabled = true, onOrderUpdated }: UseOrdersLiveOptions) {
  const { token, isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const callbackRef = useRef(onOrderUpdated);

  useEffect(() => {
    callbackRef.current = onOrderUpdated;
  }, [onOrderUpdated]);

  useEffect(() => {
    if (!enabled || !token || !isAuthenticated) {
      setIsConnected(false);
      return;
    }

    let isDisposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (isDisposed) {
        return;
      }

      socket = new WebSocket(buildOrdersWsUrl(token));

      socket.onopen = () => {
        if (!isDisposed) {
          setIsConnected(true);
        }
      };

      socket.onmessage = (event) => {
        const order = parseOrderLiveMessage(String(event.data ?? ""));
        if (order) {
          callbackRef.current(order);
        }
      };

      socket.onclose = () => {
        if (isDisposed) {
          return;
        }
        setIsConnected(false);
        reconnectTimer = window.setTimeout(connect, 1200);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      isDisposed = true;
      setIsConnected(false);
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [enabled, isAuthenticated, token]);

  return { isConnected };
}
