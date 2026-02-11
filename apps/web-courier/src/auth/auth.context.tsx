import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from "react";
import { loginRequest, meRequest } from "./auth.api";
import type { AuthUser, LoginPayload } from "./auth.types";

const TOKEN_KEY = "foodo.courier.token";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (payload: LoginPayload) => Promise<void>;
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

  const ensureCourierRole = useCallback((currentUser: AuthUser) => {
    if (currentUser.role !== "Courier") {
      throw new Error("Only Courier role can access courier panel");
    }

    return currentUser;
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const response = await loginRequest(payload);
    const roleCheckedUser = ensureCourierRole(response.user);
    persistToken(response.accessToken);
    setUser(roleCheckedUser);
  }, [ensureCourierRole, persistToken]);

  const refreshMe = useCallback(async () => {
    const currentToken = localStorage.getItem(TOKEN_KEY);
    if (!currentToken) {
      logout();
      return;
    }

    const me = await meRequest(currentToken);
    const roleCheckedUser = ensureCourierRole(me);
    setUser(roleCheckedUser);
  }, [ensureCourierRole, logout]);

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
        const roleCheckedUser = ensureCourierRole(me);
        if (isMounted) {
          setUser(roleCheckedUser);
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
  }, [ensureCourierRole, logout, token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user && token),
      isBootstrapping,
      login,
      refreshMe,
      logout
    }),
    [isBootstrapping, login, logout, refreshMe, token, user]
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
