import type {
  DeliveryStatus,
  OptimizedCourierRouteResponse,
  Route
} from "@foodo/shared-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFoodoClient } from "../api/foodo.client";
import { useAuth } from "../auth/auth.context";
import { useDeliveryLive } from "../delivery/useDeliveryLive";

function statusClasses(status: DeliveryStatus) {
  if (status === "assigned") {
    return "bg-slate-200 text-slate-700";
  }
  if (status === "cooking") {
    return "bg-amber-100 text-amber-800";
  }
  if (status === "delivery") {
    return "bg-sky-100 text-sky-800";
  }
  return "bg-emerald-100 text-emerald-800";
}

function nextStatus(status: DeliveryStatus): DeliveryStatus | null {
  if (status === "assigned") {
    return "cooking";
  }
  if (status === "cooking") {
    return "delivery";
  }
  if (status === "delivery") {
    return "done";
  }
  return null;
}

function actionLabel(status: DeliveryStatus) {
  if (status === "assigned") {
    return "Mark cooking";
  }
  if (status === "cooking") {
    return "Mark in delivery";
  }
  if (status === "delivery") {
    return "Mark delivered";
  }
  return "Completed";
}

function estimateDistanceKm(etaMinutes: number) {
  return Math.max(0.8, etaMinutes * 0.7).toFixed(1);
}

function resolveRouteDistanceKm(route: Route) {
  if (route.routeDistanceKm > 0) {
    return route.routeDistanceKm.toFixed(1);
  }
  return estimateDistanceKm(route.etaMinutes);
}

function mergeCourierRoutes(current: Route[], updatedRoute: Route) {
  if (updatedRoute.status === "done") {
    return current.filter((route) => route.orderId !== updatedRoute.orderId);
  }

  const index = current.findIndex((route) => route.orderId === updatedRoute.orderId);
  if (index === -1) {
    return [updatedRoute, ...current].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const next = [...current];
  next[index] = updatedRoute;
  return next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function DeliveriesPage() {
  const client = useFoodoClient();
  const { user } = useAuth();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedCourierRouteResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRouteLoading, setIsRouteLoading] = useState(true);
  const [isRouteRefreshing, setIsRouteRefreshing] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const loadOptimizedRoute = useCallback(
    async (silent = false) => {
      if (!user) {
        return;
      }

      if (silent) {
        setIsRouteRefreshing(true);
      } else {
        setIsRouteLoading(true);
      }

      try {
        const snapshot = await client.getCourierOptimizedRoute(user.id);
        setOptimizedRoute(snapshot);
        setRouteError(null);
      } catch (loadError) {
        setRouteError(
          loadError instanceof Error ? loadError.message : "Failed to load optimized route"
        );
      } finally {
        if (silent) {
          setIsRouteRefreshing(false);
        } else {
          setIsRouteLoading(false);
        }
      }
    },
    [client, user]
  );

  const { isConnected: isLiveConnected } = useDeliveryLive({
    enabled: Boolean(user),
    onRouteUpdated: (updatedRoute) => {
      setError(null);
      setRoutes((current) => mergeCourierRoutes(current, updatedRoute));
      void loadOptimizedRoute(true);
    }
  });

  useEffect(() => {
    let mounted = true;

    async function loadInitial() {
      if (!user) {
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const [data] = await Promise.all([
          client.getCourierActiveDeliveries(user.id),
          loadOptimizedRoute(false)
        ]);
        if (mounted) {
          setRoutes(data);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load deliveries");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadInitial();

    return () => {
      mounted = false;
    };
  }, [client, loadOptimizedRoute, user]);

  useEffect(() => {
    if (!user) {
      return;
    }
    if (isLiveConnected) {
      return;
    }

    let mounted = true;
    const timer = window.setInterval(async () => {
      setIsRefreshing(true);
      try {
        const data = await client.getCourierActiveDeliveries(user.id);
        if (mounted) {
          setRoutes(data);
        }
      } catch {
        // Silent on periodic polling.
      } finally {
        if (mounted) {
          setIsRefreshing(false);
        }
      }
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [client, isLiveConnected, user]);

  useEffect(() => {
    if (!user || isLiveConnected) {
      return;
    }

    let mounted = true;
    const timer = window.setInterval(async () => {
      if (!mounted) {
        return;
      }
      await loadOptimizedRoute(true);
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [isLiveConnected, loadOptimizedRoute, user]);

  useEffect(() => {
    if (isLiveConnected) {
      setIsRefreshing(false);
      setIsRouteRefreshing(false);
    }
  }, [isLiveConnected]);

  async function handleUpdate(route: Route) {
    const next = nextStatus(route.status);
    if (!next) {
      return;
    }

    setUpdatingOrderId(route.orderId);
    setError(null);
    try {
      await client.updateDeliveryStatus(route.orderId, next);
      if (!user) {
        return;
      }
      const [fresh] = await Promise.all([
        client.getCourierActiveDeliveries(user.id),
        loadOptimizedRoute(true)
      ]);
      setRoutes(fresh);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update delivery status");
    } finally {
      setUpdatingOrderId(null);
    }
  }

  const totalRevenue = useMemo(
    () => routes.reduce((sum, route) => sum + route.total, 0),
    [routes]
  );

  return (
    <section className="animate-fade-in space-y-4 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-float backdrop-blur-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">My Deliveries</h2>
          <p className="text-sm text-slate-500">
            {routes.length} active orders, ${totalRevenue.toFixed(2)} total
          </p>
        </div>
        <span className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          {isLiveConnected ? "Live WS" : isRefreshing ? "Polling..." : "Polling fallback (2s)"}
        </span>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="skeleton h-72" />
          <div className="skeleton h-72" />
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-100 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Optimized Route</h3>
            <p className="text-xs text-slate-500">
              Ordered stops, timeline ETA and total delivery duration.
            </p>
          </div>
          <span className="rounded-xl border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            {isLiveConnected ? "Live (WS)" : isRouteRefreshing ? "Refreshing..." : "Polling (5s)"}
          </span>
        </div>

        {isRouteLoading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="skeleton h-20" />
            <div className="skeleton h-20" />
          </div>
        ) : null}
        {routeError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {routeError}
          </div>
        ) : null}

        {!isRouteLoading && !routeError && optimizedRoute ? (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3 sm:grid-cols-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Stops</p>
                <p className="text-xl font-bold text-slate-900">{optimizedRoute.etaBreakdown.length}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Total duration</p>
                <p className="text-xl font-bold text-slate-900">{optimizedRoute.totalTime} min</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Distance</p>
                <p className="text-xl font-bold text-slate-900">
                  {optimizedRoute.totalDistanceKm.toFixed(1)} km
                </p>
              </div>
            </div>

            {optimizedRoute.etaBreakdown.length ? (
              <ol className="space-y-2">
                {optimizedRoute.etaBreakdown.map((step) => (
                  <li
                    key={`step-${step.orderId}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                        {step.sequence}
                      </span>
                      <div>
                        <p className="font-mono text-xs text-slate-500">{step.orderId}</p>
                        <p className="text-sm text-slate-700">{step.address}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-900">
                        ETA {step.etaMinutes} min
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {step.etaLowerMinutes}-{step.etaUpperMinutes} min • conf {step.etaConfidenceScore.toFixed(0)}%
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No active route steps right now.</p>
            )}
          </div>
        ) : null}
      </section>

      {!isLoading && !routes.length ? (
        <div className="glass-panel rounded-2xl px-6 py-8 text-center">
          <img
            src="/images/empty-deliveries.svg"
            alt="No deliveries"
            className="mx-auto mb-4 h-28 w-auto"
            loading="lazy"
          />
          <p className="text-sm font-semibold text-slate-700">No active deliveries yet</p>
          <p className="mt-1 text-sm text-slate-500">Assigned orders will appear here automatically.</p>
        </div>
      ) : null}

      {!isLoading && routes.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {routes.map((route) => {
            const next = nextStatus(route.status);
            const isUpdating = updatingOrderId === route.orderId;
            return (
              <article
                key={route.id}
                className="overflow-hidden rounded-3xl border border-slate-100 bg-white transition duration-300 hover:-translate-y-1 hover:shadow-float"
              >
                <img
                  src="/images/hero/courier-route.jpg"
                  alt="Route preview"
                  className="h-32 w-full object-cover"
                  loading="lazy"
                />

                <div className="space-y-3 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="font-mono text-xs text-slate-500">Order {route.orderId}</p>
                  <span
                    className={`inline-flex items-center rounded-xl px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-white/80 ${statusClasses(route.status)}`}
                  >
                    {route.status}
                  </span>
                </div>

                <div className="space-y-1 text-sm text-slate-700">
                  <p>
                    <span className="font-medium text-slate-500">Address:</span> {route.address}
                  </p>
                  <p>
                    <span className="font-medium text-slate-500">Total:</span> ${route.total.toFixed(2)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">ETA</p>
                    <p className="text-lg font-bold text-slate-900">{route.etaMinutes} min</p>
                    <p className="text-[11px] text-slate-500">
                      {route.etaLowerMinutes}-{route.etaUpperMinutes} min
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Route distance</p>
                    <p className="text-lg font-bold text-slate-900">{resolveRouteDistanceKm(route)} km</p>
                    <p className="text-[11px] text-slate-500">
                      conf {route.etaConfidenceScore.toFixed(0)}%
                    </p>
                  </div>
                </div>

                <ul className="mt-1 space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  {route.items.map((item) => (
                    <li key={`${route.id}-${item.productId}`}>
                      {item.name} x{item.quantity}
                    </li>
                  ))}
                </ul>

                <button
                  className="mt-1 w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={!next || isUpdating}
                  onClick={() => handleUpdate(route)}
                >
                  {isUpdating ? "Updating..." : actionLabel(route.status)}
                </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
