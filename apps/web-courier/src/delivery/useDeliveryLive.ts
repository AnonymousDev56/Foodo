import type { DeliveryLiveMessage, Route } from "@foodo/shared-types";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/auth.context";

const deliveryApiUrl = import.meta.env.VITE_DELIVERY_API_URL ?? "http://localhost:3004";

function buildDeliveryWsUrl(token: string) {
  const resolvedDeliveryApiUrl =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/app/") || window.location.port === "8080")
      ? window.location.origin
      : deliveryApiUrl;
  const wsBase = resolvedDeliveryApiUrl.replace(/^http/, "ws");
  const url = new URL("/delivery/ws", wsBase);
  url.searchParams.set("token", token);
  return url.toString();
}

function parseDeliveryLiveMessage(raw: string): Route | null {
  try {
    const payload = JSON.parse(raw) as DeliveryLiveMessage;
    if (payload.type !== "delivery.updated" || !payload.route?.id) {
      return null;
    }
    return payload.route;
  } catch {
    return null;
  }
}

interface UseDeliveryLiveOptions {
  enabled?: boolean;
  onRouteUpdated: (route: Route) => void;
}

export function useDeliveryLive({ enabled = true, onRouteUpdated }: UseDeliveryLiveOptions) {
  const { token, isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const callbackRef = useRef(onRouteUpdated);

  useEffect(() => {
    callbackRef.current = onRouteUpdated;
  }, [onRouteUpdated]);

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

      socket = new WebSocket(buildDeliveryWsUrl(token));

      socket.onopen = () => {
        if (!isDisposed) {
          setIsConnected(true);
        }
      };

      socket.onmessage = (event) => {
        const route = parseDeliveryLiveMessage(String(event.data ?? ""));
        if (route) {
          callbackRef.current(route);
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
