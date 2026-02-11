import { createFoodoClient } from "@foodo/shared-types";
import { useMemo } from "react";
import { useAuth } from "../auth/auth.context";
import { isUnifiedAuthEnabled } from "../auth/unified-auth";

function getDefaultServiceBaseUrl(localPort: number) {
  if (typeof window === "undefined") {
    return `http://localhost:${localPort}`;
  }

  const unifiedAuthEnabled = isUnifiedAuthEnabled();
  const { pathname, port } = window.location;
  const isGatewayOrigin =
    pathname.startsWith("/app/") ||
    port === "8080" ||
    (unifiedAuthEnabled && (pathname === "/login" || pathname === "/signup" || pathname === "/verify-email"));

  if (isGatewayOrigin) {
    return window.location.origin;
  }

  return `http://localhost:${localPort}`;
}

const ordersApiUrl = import.meta.env.VITE_ORDERS_API_URL ?? getDefaultServiceBaseUrl(3002);
const warehouseApiUrl = import.meta.env.VITE_WAREHOUSE_API_URL ?? getDefaultServiceBaseUrl(3003);
const deliveryApiUrl = import.meta.env.VITE_DELIVERY_API_URL ?? getDefaultServiceBaseUrl(3004);

export function useFoodoClient() {
  const { token } = useAuth();

  return useMemo(
    () =>
      createFoodoClient({
        ordersApiUrl,
        warehouseApiUrl,
        deliveryApiUrl,
        getAccessToken: () => token
      }),
    [token]
  );
}
