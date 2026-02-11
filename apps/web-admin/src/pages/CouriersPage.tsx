import { useEffect, useMemo, useState } from "react";
import type { Courier, DeliveryStats, Order, Route } from "@foodo/shared-types";
import { useFoodoClient } from "../api/foodo.client";

function initialsFromName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function CouriersPage() {
  const client = useFoodoClient();

  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [activeRoutes, setActiveRoutes] = useState<Route[]>([]);
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);

  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedCourierId, setSelectedCourierId] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    const [couriersData, activeData, statsData, ordersData] = await Promise.all([
      client.getCouriers(),
      client.getActiveDeliveries(),
      client.getDeliveryStats(),
      client.getAdminOrders()
    ]);

    setCouriers(couriersData);
    setActiveRoutes(activeData);
    setStats(statsData);
    setOrders(ordersData.filter((order) => order.status !== "done"));

    if (!selectedCourierId && couriersData.length) {
      setSelectedCourierId(couriersData[0].id);
    }

    if (!selectedOrderId && ordersData.length) {
      setSelectedOrderId(ordersData.find((item) => item.status !== "done")?.id ?? "");
    }
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      setIsLoading(true);
      setError(null);
      try {
        await loadAll();
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load courier data");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void bootstrap();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      await loadAll();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to refresh courier data");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleManualAssign() {
    if (!selectedOrder || !selectedCourierId) {
      return;
    }

    if (
      selectedOrder.address === undefined ||
      selectedOrder.lat === undefined ||
      selectedOrder.lng === undefined
    ) {
      setError("Selected order has no delivery coordinates");
      return;
    }

    setIsAssigning(true);
    setError(null);
    try {
      await client.assignDeliveryManual({
        orderId: selectedOrder.id,
        userId: selectedOrder.userId,
        address: selectedOrder.address,
        lat: selectedOrder.lat,
        lng: selectedOrder.lng,
        total: selectedOrder.total,
        courierId: selectedCourierId,
        items: selectedOrder.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity
        }))
      });

      await refresh();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Failed to assign courier");
    } finally {
      setIsAssigning(false);
    }
  }

  return (
    <section className="animate-fade-in space-y-4 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-float backdrop-blur-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Courier Management</h2>
        <button
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card"
          type="button"
          onClick={refresh}
        >
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <article className="glass-panel rounded-2xl p-4 transition duration-300 hover:-translate-y-1 hover:shadow-card">
          <p className="text-xs uppercase tracking-wide text-slate-500">Active routes</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{stats?.activeRoutes ?? 0}</p>
        </article>
        <article className="glass-panel rounded-2xl p-4 transition duration-300 hover:-translate-y-1 hover:shadow-card">
          <p className="text-xs uppercase tracking-wide text-slate-500">Completed routes</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{stats?.completedRoutes ?? 0}</p>
        </article>
        <article className="glass-panel rounded-2xl p-4 transition duration-300 hover:-translate-y-1 hover:shadow-card">
          <p className="text-xs uppercase tracking-wide text-slate-500">Average ETA</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{stats?.averageEtaMinutes ?? 0} min</p>
        </article>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4">
          <h3 className="text-lg font-extrabold tracking-tight text-slate-900">Manual assignment</h3>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Order</span>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
              value={selectedOrderId}
              onChange={(event) => setSelectedOrderId(event.target.value)}
            >
              {!orders.length ? <option value="">No active orders</option> : null}
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.id.slice(0, 12)}... ({order.status}) ${order.total.toFixed(2)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-600">Courier</span>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
              value={selectedCourierId}
              onChange={(event) => setSelectedCourierId(event.target.value)}
            >
              {!couriers.length ? <option value="">No couriers</option> : null}
              {couriers.map((courier) => (
                <option key={courier.id} value={courier.id}>
                  {courier.name} ({courier.isAvailable ? "free" : "busy"})
                </option>
              ))}
            </select>
          </label>

          {selectedOrder ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p><span className="font-medium text-slate-500">Address:</span> {selectedOrder.address ?? "-"}</p>
              <p><span className="font-medium text-slate-500">Items:</span> {selectedOrder.items.length}</p>
              <p><span className="font-medium text-slate-500">Total:</span> ${selectedOrder.total.toFixed(2)}</p>
            </div>
          ) : null}

          <button
              className="w-full rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card disabled:opacity-60"
              type="button"
              onClick={handleManualAssign}
              disabled={!selectedOrder || !selectedCourierId || isAssigning}
          >
            {isAssigning ? "Assigning..." : "Assign courier"}
          </button>
        </div>

        <div className="space-y-3">
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Courier</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Active</th>
                  <th className="px-4 py-3 font-semibold">Completed</th>
                </tr>
              </thead>
              <tbody>
                {couriers.map((courier) => {
                  const courierStat = stats?.couriers.find((item) => item.courierId === courier.id);
                  return (
                    <tr key={courier.id} className="border-t border-slate-100 transition duration-200 hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                            {initialsFromName(courier.name) || "CO"}
                          </span>
                          <div>
                            <p className="font-medium text-slate-800">{courier.name}</p>
                            <p className="text-xs text-slate-500">{courier.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-xl px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-white/80 ${courier.isAvailable ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                        >
                          {courier.isAvailable ? "free" : "busy"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{courierStat?.activeCount ?? 0}</td>
                      <td className="px-4 py-3">{courierStat?.completedCount ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Courier</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">ETA</th>
                </tr>
              </thead>
              <tbody>
                {activeRoutes.map((route) => (
                  <tr key={route.id} className="border-t border-slate-100 transition duration-200 hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-mono text-xs">{route.orderId.slice(0, 12)}...</td>
                    <td className="px-4 py-3">{route.courierName}</td>
                    <td className="px-4 py-3">{route.status}</td>
                    <td className="px-4 py-3">{route.etaMinutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!activeRoutes.length ? (
              <div className="px-4 py-8 text-center">
                <img src="/images/empty-table.svg" alt="No active deliveries" className="mx-auto mb-3 h-24 w-auto" loading="lazy" />
                <p className="text-sm font-medium text-slate-700">No active deliveries.</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
