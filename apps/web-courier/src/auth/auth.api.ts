import type {
  AuthResponse,
  AuthUser,
  LoginPayload,
  UpdatePasswordPayload,
  UpdateProfilePayload
} from "./auth.types";

const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL ?? getDefaultAuthApiBaseUrl();
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

function getDefaultAuthApiBaseUrl() {
  if (typeof window === "undefined") {
    return "http://localhost:3001";
  }

  const pathname = window.location.pathname;
  const isGatewayPath =
    pathname === "/app/courier" ||
    pathname.startsWith("/app/courier/");

  if (isGatewayPath || window.location.port === "8080") {
    return window.location.origin;
  }

  return "http://localhost:3001";
}

export function isGatewayAuthRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  const pathname = window.location.pathname;
  const isGatewayPath =
    pathname === "/app/courier" ||
    pathname.startsWith("/app/courier/");

  return isGatewayPath || window.location.port === "8080";
}

function normalizeLoopbackBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    const browserHost = window.location.hostname;
    if (LOOPBACK_HOSTS.has(parsed.hostname) && LOOPBACK_HOSTS.has(browserHost)) {
      parsed.hostname = browserHost;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl.replace(/\/+$/, "");
  }
}

function toLoopbackAlt(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      return parsed.toString().replace(/\/+$/, "");
    }
    if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
      return parsed.toString().replace(/\/+$/, "");
    }
    return null;
  } catch {
    return null;
  }
}

function getAuthBaseCandidates() {
  const primary = normalizeLoopbackBaseUrl(AUTH_API_URL);
  const alt = toLoopbackAlt(primary);
  return alt && alt !== primary ? [primary, alt] : [primary];
}

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "Request failed";
  }

  const maybeMessage = (payload as { message?: unknown }).message;
  if (Array.isArray(maybeMessage)) {
    return maybeMessage.join(", ");
  }

  if (typeof maybeMessage === "string") {
    return maybeMessage;
  }

  return "Request failed";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrls = getAuthBaseCandidates();
  let response: Response | null = null;
  let networkError: unknown = null;

  for (const baseUrl of baseUrls) {
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        }
      });
      break;
    } catch (error) {
      networkError = error;
    }
  }

  if (!response) {
    throw networkError instanceof Error ? networkError : new Error("Failed to fetch");
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`HTTP ${response.status}`);
    }

    throw new Error(getErrorMessage(payload));
  }

  return (await response.json()) as T;
}

export function loginRequest(payload: LoginPayload) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function meRequest(token: string) {
  return request<AuthUser>("/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function profileRequest(token: string) {
  return request<AuthUser>("/auth/profile", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function updateProfileRequest(token: string, payload: UpdateProfilePayload) {
  return request<AuthUser>("/auth/profile", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

export function updatePasswordRequest(token: string, payload: UpdatePasswordPayload) {
  return request<{ updated: boolean }>("/auth/profile/password", {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}
