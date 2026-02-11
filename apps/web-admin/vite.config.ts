import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveUnifiedAuthEnabled() {
  return (process.env.UNIFIED_AUTH_ENABLED ?? process.env.VITE_UNIFIED_AUTH_ENABLED ?? "false") === "true";
}

export default defineConfig(({ command }) => {
  const unifiedAuthEnabled = resolveUnifiedAuthEnabled();

  return {
    plugins: [react()],
    base: command === "build" ? (unifiedAuthEnabled ? "/app/admin/" : "/") : "/",
    define: {
      "import.meta.env.UNIFIED_AUTH_ENABLED": JSON.stringify(unifiedAuthEnabled ? "true" : "false")
    },
    server: {
      port: 5175
    }
  };
});
