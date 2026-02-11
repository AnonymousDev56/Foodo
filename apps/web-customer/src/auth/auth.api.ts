import type {
  AuthResponse,
  AuthUser,
  LoginPayload,
  RegisterPayload,
  ResendVerificationPayload,
  SignupPayload,
  SignupResponse,
  UpdatePasswordPayload,
  UpdateProfilePayload,
  VerifyEmailCodePayload
} from "./auth.types";
import { isGatewayUnifiedRuntime } from "./unified-auth";

const AUTH_API_URL = import.meta.env.VITE_AUTH_API_URL ?? getDefaultAuthApiBaseUrl();
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

interface AuthApiErrorPayload {
  error?: string;
  message?: unknown;
  statusCode?: number;
}

export class AuthApiError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

function getDefaultAuthApiBaseUrl() {
  if (typeof window !== "undefined" && isGatewayUnifiedRuntime()) {
    return window.location.origin;
  }
  return "http://localhost:3001";
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
    return { message: "Request failed" };
  }

  const typed = payload as AuthApiErrorPayload;
  const maybeMessage = typed.message;
  if (Array.isArray(maybeMessage)) {
    return { message: maybeMessage.join(", "), code: typed.error };
  }

  if (typeof maybeMessage === "string") {
    return { message: maybeMessage, code: typed.error };
  }

  return { message: "Request failed", code: typed.error };
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
      throw new AuthApiError(`HTTP ${response.status}`, response.status);
    }

    const parsed = getErrorMessage(payload);
    throw new AuthApiError(parsed.message, response.status, parsed.code);
  }

  return (await response.json()) as T;
}

export function loginRequest(payload: LoginPayload) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function registerRequest(payload: RegisterPayload) {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function loginUnifiedRequest(payload: LoginPayload) {
  return request<AuthResponse>("/auth/login-unified", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function signupRequest(payload: SignupPayload) {
  return request<SignupResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function resendVerificationCodeRequest(payload: ResendVerificationPayload) {
  return request<{ accepted: boolean; devVerificationCode?: string }>("/auth/verify-email/resend", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function verifyEmailCodeRequest(payload: VerifyEmailCodePayload) {
  return request<{ verified: boolean }>("/auth/verify-email/code", {
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
