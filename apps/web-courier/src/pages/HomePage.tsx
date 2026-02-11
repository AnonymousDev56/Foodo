import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth.context";

export function HomePage() {
  const { user } = useAuth();

  return (
    <section className="animate-fade-in overflow-hidden rounded-3xl border border-white/70 bg-white/85 shadow-float backdrop-blur-sm">
      <div className="grid gap-0 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6 p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Courier dashboard</p>
            <h2 className="title-gradient mt-2 text-3xl font-extrabold tracking-tight">Delivery control panel</h2>
            <p className="mt-2 text-sm text-slate-600">
              Logged in as <span className="font-semibold text-slate-900">{user?.email}</span>
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Track assigned deliveries and update statuses in real time.
            </p>
          </div>

          <Link
            className="inline-flex rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card"
            to="/deliveries"
          >
            Open my deliveries
          </Link>
        </div>

        <div className="hidden lg:block">
          <img
            src="/images/hero/courier-dashboard.jpg"
            alt="Courier dashboard"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}
