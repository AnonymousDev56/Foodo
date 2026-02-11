import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { loginRequest, meRequest, registerRequest } from "./auth.api";
import type { AuthUser, LoginPayload, RegisterPayload } from "./auth.types";

const TOKEN_KEY = "foodo.customer.token";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  refreshMe: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const persistToken = useCallback((nextToken: string | null) => {
    if (nextToken) {
      localStorage.setItem(TOKEN_KEY, nextToken);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }

    setToken(nextToken);
  }, []);

  const logout = useCallback(() => {
    persistToken(null);
    setUser(null);
  }, [persistToken]);

  const refreshMe = useCallback(async () => {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    if (!currentToken) {
      logout();
      return;
    }

    const me = await meRequest(currentToken);
    setUser(me);
  }, [logout]);

  const login = useCallback(async (payload: LoginPayload) => {
    const response = await loginRequest(payload);
    persistToken(response.accessToken);
    setUser(response.user);
  }, [persistToken]);

  const register = useCallback(async (payload: RegisterPayload) => {
    const response = await registerRequest(payload);
    persistToken(response.accessToken);
    setUser(response.user);
  }, [persistToken]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      if (!token) {
        if (isMounted) {
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const me = await meRequest(token);
        if (isMounted) {
          setUser(me);
        }
      } catch {
        if (isMounted) {
          logout();
        }
      } finally {
        if (isMounted) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      isMounted = false;
    };
  }, [token, logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token && user),
      isBootstrapping,
      login,
      register,
      refreshMe,
      logout
    }),
    [isBootstrapping, login, logout, refreshMe, register, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
