import type { Role } from "./auth.types";

const TOKEN_BY_ROLE: Record<Role, string> = {
  Customer: "foodo.customer.token",
  Courier: "foodo.courier.token",
  Admin: "foodo.admin.token"
};

const UNIFIED_PATHS = new Set(["/login", "/signup", "/verify-email"]);

export function isUnifiedAuthEnabled() {
  return (import.meta.env as { UNIFIED_AUTH_ENABLED?: string }).UNIFIED_AUTH_ENABLED === "true";
}

export function isGatewayUnifiedRuntime() {
  if (!isUnifiedAuthEnabled()) {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }

  const { pathname, port } = window.location;
  if (pathname.startsWith("/app/")) {
    return true;
  }

  return port === "8080" && UNIFIED_PATHS.has(pathname);
}

export function storeAccessTokenByRole(role: Role, token: string) {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of Object.values(TOKEN_BY_ROLE)) {
    window.localStorage.removeItem(key);
  }
  window.localStorage.setItem(TOKEN_BY_ROLE[role], token);
}

export function resolveLoginRedirect(role: Role) {
  const inGateway = isGatewayUnifiedRuntime();
  if (inGateway) {
    if (role === "Customer") {
      return "/app/customer";
    }
    if (role === "Courier") {
      return "/app/courier";
    }
    return "/app/admin";
  }

  const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
  if (role === "Customer") {
    return "/";
  }
  if (role === "Courier") {
    return `http://${host}:5174`;
  }
  return `http://${host}:5175`;
}
