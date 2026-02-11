import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdminDashboardMetrics } from "@foodo/shared-types";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useFoodoClient } from "../api/foodo.client";
import { useAdminDashboardLive } from "../dashboard/useAdminDashboardLive";

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function trendClass(current: number, previous: number | undefined) {
  if (previous === undefined || current === previous) {
    return "text-slate-400";
  }
  return current > previous ? "text-emerald-600" : "text-rose-600";
}

function trendIcon(current: number, previous: number | undefined) {
  if (previous === undefined || current === previous) {
    return "→";
  }
  return current > previous ? "↑" : "↓";
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle: string;
  trendValue: number;
  previousTrendValue?: number;
}

function MetricCard({ title, value, subtitle, trendValue, previousTrendValue }: MetricCardProps) {
  return (
    <article className="glass-panel rounded-2xl p-4 transition duration-300 hover:-translate-y-1 hover:shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <span className={`text-lg font-bold ${trendClass(trendValue, previousTrendValue)}`}>
          {trendIcon(trendValue, previousTrendValue)}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500">{subtitle}</p>
    </article>
  );
}

export function HomePage() {
  const client = useFoodoClient();
  const previousMetricsRef = useRef<AdminDashboardMetrics | null>(null);
  const [metrics, setMetrics] = useState<AdminDashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applySnapshot = useCallback((snapshot: AdminDashboardMetrics) => {
    setMetrics((current) => {
      previousMetricsRef.current = current;
      return snapshot;
    });
    setError(null);
    setIsLoading(false);
  }, []);

  const fetchSnapshot = useCallback(() => client.getAdminDashboardMetrics(), [client]);

  const { isConnected } = useAdminDashboardLive({
    enabled: true,
    fetchSnapshot,
    onUpdate: applySnapshot,
    onPollingError: (message) => {
      if (!metrics) {
        setError(message);
      }
    }
  });

  useEffect(() => {
    let mounted = true;

    async function loadInitial() {
      setIsLoading(true);
      setError(null);
      try {
        const snapshot = await fetchSnapshot();
        if (mounted) {
          applySnapshot(snapshot);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard");
          setIsLoading(false);
        }
      }
    }

    void loadInitial();

    return () => {
      mounted = false;
    };
  }, [applySnapshot, fetchSnapshot]);

  const chartData = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return metrics.ordersPerHour.map((point, index) => ({
      hour: point.hour,
      orders: point.value,
      revenue: metrics.revenuePerHour[index]?.value ?? 0
    }));
  }, [metrics]);

  const previousMetrics = previousMetricsRef.current;

  return (
    <section className="animate-fade-in space-y-5 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-float backdrop-blur-sm sm:p-6">
      <div className="overflow-hidden rounded-3xl border border-slate-100 bg-slate-50/80">
        <div className="grid gap-0 lg:grid-cols-[1.2fr_1fr]">
          <div className="p-6 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Admin dashboard</p>
            <h2 className="title-gradient mt-2 text-3xl font-extrabold tracking-tight">Operations overview</h2>
            <p className="mt-2 text-sm text-slate-600">Orders, finance and courier activity in one place.</p>
            <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
              <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-amber-500"}`} />
              {isConnected ? "Live updates (WS)" : "Fallback polling (15s)"}
            </div>
          </div>
          <img
            src="/images/hero/admin-dashboard.jpg"
            alt="Admin overview"
            className="hidden h-full w-full object-cover lg:block"
            loading="lazy"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-5">
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
          <div className="skeleton h-28" />
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!isLoading && !error && metrics ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <MetricCard
              title="Active orders"
              value={String(metrics.activeOrders)}
              subtitle="pending + cooking + delivery"
              trendValue={metrics.activeOrders}
              previousTrendValue={previousMetrics?.activeOrders}
            />
            <MetricCard
              title="Completed today"
              value={String(metrics.completedToday)}
              subtitle="Orders finished today"
              trendValue={metrics.completedToday}
              previousTrendValue={previousMetrics?.completedToday}
            />
            <MetricCard
              title="Average ETA"
              value={`${metrics.averageEta} min`}
              subtitle="Active delivery routes"
              trendValue={metrics.averageEta}
              previousTrendValue={previousMetrics?.averageEta}
            />
            <MetricCard
              title="Active couriers"
              value={String(metrics.activeCouriers)}
              subtitle="Couriers with active routes"
              trendValue={metrics.activeCouriers}
              previousTrendValue={previousMetrics?.activeCouriers}
            />
            <MetricCard
              title="Revenue today"
              value={formatMoney(metrics.revenueToday)}
              subtitle="Done orders only"
              trendValue={metrics.revenueToday}
              previousTrendValue={previousMetrics?.revenueToday}
            />
            <MetricCard
              title="Avg route length"
              value={`${metrics.avgRouteLength.toFixed(2)} km`}
              subtitle="Per active courier route"
              trendValue={metrics.avgRouteLength}
              previousTrendValue={previousMetrics?.avgRouteLength}
            />
            <MetricCard
              title="Avg ETA accuracy"
              value={`${metrics.avgEtaAccuracy.toFixed(1)}%`}
              subtitle="Completed routes, last 24h"
              trendValue={metrics.avgEtaAccuracy}
              previousTrendValue={previousMetrics?.avgEtaAccuracy}
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-4">
            <article className="glass-panel rounded-2xl p-4">
              <p className="text-sm font-semibold text-slate-800">Orders per hour (12h)</p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="ordersFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b6cff" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#3b6cff" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="hour" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="orders" stroke="#3b6cff" fill="url(#ordersFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="glass-panel rounded-2xl p-4">
              <p className="text-sm font-semibold text-slate-800">Revenue per hour (12h)</p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="hour" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
                    <Tooltip formatter={(value: number) => formatMoney(value)} />
                    <Line type="monotone" dataKey="revenue" stroke="#fb3f73" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="glass-panel rounded-2xl p-4">
              <p className="text-sm font-semibold text-slate-800">Top products (24h)</p>
              <div className="mt-3 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metrics.topProducts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 10 }} interval={0} angle={-16} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b6cff" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="glass-panel rounded-2xl p-4">
              <p className="text-sm font-semibold text-slate-800">Live map (optimized assignments)</p>
              <div className="mt-3 overflow-hidden rounded-xl border border-slate-100">
                <img
                  src="/images/hero/admin-analytics.jpg"
                  alt="Live courier map"
                  className="h-28 w-full object-cover"
                  loading="lazy"
                />
              </div>
              <ul className="mt-3 space-y-2">
                {metrics.optimizedAssignments.slice(0, 5).map((assignment) => (
                  <li
                    key={`assignment-${assignment.orderId}`}
                    className="rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600"
                  >
                    <p className="font-mono text-[11px] text-slate-500">{assignment.orderId}</p>
                    <p className="text-sm font-semibold text-slate-800">{assignment.courierName}</p>
                    <p>{assignment.address}</p>
                    <p className="mt-1 text-slate-500">
                      ETA {assignment.etaMinutes} min ({assignment.etaLowerMinutes}-{assignment.etaUpperMinutes}) • conf {assignment.etaConfidenceScore.toFixed(0)}% • seq #{assignment.sequence}
                    </p>
                  </li>
                ))}
              </ul>
              {!metrics.optimizedAssignments.length ? (
                <p className="mt-3 text-xs text-slate-500">No active optimized assignments.</p>
              ) : null}
            </article>
          </div>
        </div>
      ) : null}
    </section>
  );
}
