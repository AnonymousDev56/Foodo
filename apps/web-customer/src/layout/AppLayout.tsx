import type { PropsWithChildren } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/auth.context";
import { isUnifiedAuthEnabled } from "../auth/unified-auth";
import { useCart } from "../cart/cart.context";

export function AppLayout({ children }: PropsWithChildren) {
  const location = useLocation();
  const { isAuthenticated, logout, user } = useAuth();
  const { totalItems } = useCart();
  const unifiedAuthEnabled = isUnifiedAuthEnabled();

  const links = isAuthenticated
    ? [
        { to: "/", label: "Home" },
        { to: "/products", label: "Products" },
        { to: "/orders", label: "Orders" },
        { to: "/profile", label: "Profile" }
      ]
    : [
        { to: "/login", label: "Login" },
        { to: unifiedAuthEnabled ? "/signup" : "/register", label: unifiedAuthEnabled ? "Sign up" : "Register" }
      ];

  return (
    <div className="min-h-screen text-slate-900">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-0 h-72 bg-gradient-to-b from-brand-100/40 via-white/0 to-transparent" />
      <header className="sticky top-0 z-40 border-b border-white/70 bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900">FOODO Customer</h1>
            {user ? <p className="text-xs text-slate-500">{user.email}</p> : null}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <nav className="glass-panel flex items-center gap-1 rounded-2xl p-1 text-sm">
              {links.map((link) => {
                const active = link.to === "/" ? location.pathname === "/" : location.pathname.startsWith(link.to);
                return (
                  <Link
                    key={link.to}
                    className={
                      active
                        ? "rounded-xl bg-white px-3 py-1.5 font-semibold text-brand-700 shadow-card"
                        : "rounded-xl px-3 py-1.5 text-slate-600 transition duration-200 hover:-translate-y-0.5 hover:bg-white hover:text-slate-900"
                    }
                    to={link.to}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>

            {isAuthenticated ? (
              <span className="rounded-xl border border-brand-100 bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-700">
                Cart: {totalItems}
              </span>
            ) : null}

            {isAuthenticated ? (
              <button
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card"
                onClick={logout}
                type="button"
              >
                Logout
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
