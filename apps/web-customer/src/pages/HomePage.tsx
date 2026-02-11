import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth.context";
import { useCart } from "../cart/cart.context";

export function HomePage() {
  const { user } = useAuth();
  const { totalItems, subtotal } = useCart();

  return (
    <section className="animate-fade-in overflow-hidden rounded-3xl border border-white/70 bg-white/85 shadow-float backdrop-blur-sm">
      <div className="grid gap-0 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6 p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Customer dashboard</p>
            <h2 className="title-gradient mt-2 text-3xl font-extrabold tracking-tight">Welcome back to FOODO</h2>
            <p className="mt-2 text-sm text-slate-600">
              Signed in as <span className="font-semibold text-slate-900">{user?.email}</span>
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Browse the catalog, build your basket and track orders in real time.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="glass-panel rounded-2xl p-4 transition duration-300 hover:-translate-y-1 hover:shadow-card">
              <p className="text-xs uppercase tracking-wide text-slate-500">Cart items</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{totalItems}</p>
            </div>
            <div className="glass-panel rounded-2xl p-4 transition duration-300 hover:-translate-y-1 hover:shadow-card">
              <p className="text-xs uppercase tracking-wide text-slate-500">Cart subtotal</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">${subtotal.toFixed(2)}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card"
              to="/products"
            >
              Open catalog
            </Link>
            <Link
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card"
              to="/orders"
            >
              Open orders
            </Link>
          </div>
        </div>

        <div className="hidden lg:block">
          <img
            src="/images/hero/customer-dashboard.jpg"
            alt="Customer dashboard"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}
