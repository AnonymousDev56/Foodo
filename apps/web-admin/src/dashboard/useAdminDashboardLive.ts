import type { AdminDashboardLiveMessage, AdminDashboardMetrics } from "@foodo/shared-types";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/auth.context";

const ordersApiUrl = import.meta.env.VITE_ORDERS_API_URL ?? "http://localhost:3002";

function buildDashboardWsUrl(token: string) {
  const resolvedOrdersApiUrl =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/app/") || window.location.port === "8080")
      ? window.location.origin
      : ordersApiUrl;
  const wsBase = resolvedOrdersApiUrl.replace(/^http/, "ws");
  const url = new URL("/ws/admin-dashboard", wsBase);
  url.searchParams.set("token", token);
  return url.toString();
}

function parseDashboardMessage(raw: string) {
  try {
    const payload = JSON.parse(raw) as AdminDashboardLiveMessage;
    if (payload.type !== "dashboardUpdate" || !payload.data) {
      return null;
    }
    return payload.data;
  } catch {
    return null;
  }
}

interface UseAdminDashboardLiveOptions {
  enabled?: boolean;
  onUpdate: (payload: AdminDashboardMetrics) => void;
  onPollingError?: (message: string) => void;
  fetchSnapshot: () => Promise<AdminDashboardMetrics>;
}

export function useAdminDashboardLive({
  enabled = true,
  onUpdate,
  onPollingError,
  fetchSnapshot
}: UseAdminDashboardLiveOptions) {
  const { token, isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const callbackRef = useRef(onUpdate);
  const fetchSnapshotRef = useRef(fetchSnapshot);
  const onPollingErrorRef = useRef(onPollingError);

  useEffect(() => {
    callbackRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    fetchSnapshotRef.current = fetchSnapshot;
  }, [fetchSnapshot]);

  useEffect(() => {
    onPollingErrorRef.current = onPollingError;
  }, [onPollingError]);

  useEffect(() => {
    if (!enabled || !token || !isAuthenticated) {
      setIsConnected(false);
      return;
    }

    let isDisposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pollingTimer: number | null = null;

    const runPolling = async () => {
      try {
        const snapshot = await fetchSnapshotRef.current();
        if (!isDisposed) {
          callbackRef.current(snapshot);
        }
      } catch (error) {
        if (!isDisposed) {
          onPollingErrorRef.current?.(
            error instanceof Error ? error.message : "Polling dashboard failed"
          );
        }
      }
    };

    const ensurePolling = () => {
      if (pollingTimer) {
        return;
      }

      void runPolling();
      pollingTimer = window.setInterval(() => {
        void runPolling();
      }, 15_000);
    };

    const stopPolling = () => {
      if (!pollingTimer) {
        return;
      }
      window.clearInterval(pollingTimer);
      pollingTimer = null;
    };

    const connect = () => {
      if (isDisposed) {
        return;
      }

      socket = new WebSocket(buildDashboardWsUrl(token));

      socket.onopen = () => {
        if (isDisposed) {
          return;
        }
        setIsConnected(true);
        stopPolling();
      };

      socket.onmessage = (event) => {
        const payload = parseDashboardMessage(String(event.data ?? ""));
        if (payload) {
          callbackRef.current(payload);
        }
      };

      socket.onclose = () => {
        if (isDisposed) {
          return;
        }
        setIsConnected(false);
        ensurePolling();
        reconnectTimer = window.setTimeout(connect, 1_200);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    // Polling is a fallback path and also gives the first snapshot quickly.
    ensurePolling();
    connect();

    return () => {
      isDisposed = true;
      setIsConnected(false);
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      stopPolling();
      socket?.close();
    };
  }, [enabled, isAuthenticated, token]);

  return { isConnected };
}
