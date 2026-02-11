import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isGatewayAuthRuntime } from "../auth/auth.api";
import { useAuth } from "../auth/auth.context";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const location = useLocation();

  if (isBootstrapping) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <h2 className="text-lg font-semibold text-slate-900">Checking admin session...</h2>
      </section>
    );
  }

  if (!isAuthenticated) {
    if (typeof window !== "undefined" && isGatewayAuthRuntime()) {
      window.location.replace("/login");
      return null;
    }
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
