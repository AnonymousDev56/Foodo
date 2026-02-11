import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/auth.context";
import "./styles.css";

function resolveRouterBasename() {
  if (typeof window === "undefined") {
    return undefined;
  }

  const unifiedAuthEnabled =
    (import.meta.env as { UNIFIED_AUTH_ENABLED?: string }).UNIFIED_AUTH_ENABLED === "true";
  if (!unifiedAuthEnabled) {
    return undefined;
  }

  const basePath = "/app/admin";
  if (window.location.pathname === basePath || window.location.pathname.startsWith(`${basePath}/`)) {
    return basePath;
  }

  return undefined;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter basename={resolveRouterBasename()}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
