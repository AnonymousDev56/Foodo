import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/auth.context";
import { isUnifiedAuthEnabled } from "./auth/unified-auth";
import { CartProvider } from "./cart/cart.context";
import "./styles.css";

function resolveRouterBasename() {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!isUnifiedAuthEnabled()) {
    return undefined;
  }

  const basePath = "/app/customer";
  if (window.location.pathname === basePath || window.location.pathname.startsWith(`${basePath}/`)) {
    return basePath;
  }

  return undefined;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <CartProvider>
        <BrowserRouter basename={resolveRouterBasename()}>
          <App />
        </BrowserRouter>
      </CartProvider>
    </AuthProvider>
  </React.StrictMode>
);
