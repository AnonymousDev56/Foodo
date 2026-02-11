import { useEffect, useMemo, useState } from "react";
import type { Courier, Order, OrderFilters, OrderStatus } from "@foodo/shared-types";
import { useFoodoClient } from "../api/foodo.client";
import { useOrdersLive } from "../orders/useOrdersLive";

const ORDER_STATUSES: OrderStatus[] = ["pending", "cooking", "delivery", "done"];

function statusClasses(status: OrderStatus) {
  if (status === "pending") {
    return "bg-amber-100 text-amber-800";
  }
  if (status === "cooking") {
    return "bg-orange-100 text-orange-800";
  }
  if (status === "delivery") {
    return "bg-sky-100 text-sky-800";
  }
  return "bg-emerald-100 text-emerald-800";
}

function initialsFromText(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function orderMatchesFilters(order: Order, filters: OrderFilters) {
  if (filters.status && order.status !== filters.status) {
    return false;
  }
  if (typeof filters.minTotal === "number" && order.total < filters.minTotal) {
    return false;
  }
  if (typeof filters.maxTotal === "number" && order.total > filters.maxTotal) {
    return false;
  }
  if (filters.dateFrom) {
    const dateFrom = new Date(filters.dateFrom);
    if (!Number.isNaN(dateFrom.valueOf()) && new Date(order.createdAt) < dateFrom) {
      return false;
    }
  }
  if (filters.dateTo) {
    const dateTo = new Date(filters.dateTo);
    if (!Number.isNaN(dateTo.valueOf()) && new Date(order.createdAt) > dateTo) {
      return false;
    }
  }
  return true;
}

function upsertOrders(current: Order[], updated: Order, filters: OrderFilters) {
  const index = current.findIndex((item) => item.id === updated.id);
  const matches = orderMatchesFilters(updated, filters);
  if (!matches) {
    if (index === -1) {
      return current;
    }
    return current.filter((item) => item.id !== updated.id);
  }

  if (index === -1) {
    return [updated, ...current].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const next = [...current];
  next[index] = updated;
  return next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function OrdersPage() {
  const client = useFoodoClient();

  const [orders, setOrders] = useState<Order[]>([]);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minTotal, setMinTotal] = useState("");
  const [maxTotal, setMaxTotal] = useState("");
  const [activeFilters, setActiveFilters] = useState<OrderFilters>({});

  const [adminStatus, setAdminStatus] = useState<OrderStatus>("pending");
  const [manualCourierId, setManualCourierId] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingDetail, setIsRefreshingDetail] = useState(false);
  const [isFallbackRefreshing, setIsFallbackRefreshing] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isManualAssigning, setIsManualAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftFilters = useMemo<OrderFilters>(() => {
    const next: OrderFilters = {};
    if (statusFilter !== "all") {
      next.status = statusFilter;
    }
    if (dateFrom) {
      next.dateFrom = dateFrom;
    }
    if (dateTo) {
      next.dateTo = dateTo;
    }
    if (minTotal) {
      next.minTotal = Number(minTotal);
    }
    if (maxTotal) {
      next.maxTotal = Number(maxTotal);
    }
    return next;
  }, [dateFrom, dateTo, maxTotal, minTotal, statusFilter]);
  const { isConnected: isOrdersLiveConnected } = useOrdersLive({
    enabled: true,
    onOrderUpdated: (order) => {
      const matchesFilters = orderMatchesFilters(order, activeFilters);
      setOrders((current) => upsertOrders(current, order, activeFilters));
      if (selectedOrderId === order.id) {
        if (!matchesFilters) {
          setSelectedOrderId(null);
          setSelectedOrder(null);
          return;
        }
        setSelectedOrder(order);
        setAdminStatus(order.status);
        if (order.delivery?.courierId) {
          setManualCourierId(order.delivery.courierId);
        }
      }
    }
  });

  async function loadOrders(nextFilters: OrderFilters) {
    const data = await client.getAdminOrders(nextFilters);
    setOrders(data);

    if (!data.length) {
      setSelectedOrderId(null);
      setSelectedOrder(null);
      return;
    }

    const currentId = selectedOrderId && data.some((item) => item.id === selectedOrderId)
      ? selectedOrderId
      : data[0].id;

    setSelectedOrderId(currentId);
  }

  async function loadCouriers() {
    const data = await client.getCouriers();
    setCouriers(data);
    if (!manualCourierId && data.length) {
      setManualCourierId(data[0].id);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      setIsLoading(true);
      setError(null);
      try {
        await Promise.all([loadOrders(activeFilters), loadCouriers()]);
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load orders");
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

  useEffect(() => {
    let mounted = true;

    async function loadDetails() {
      if (!selectedOrderId) {
        setSelectedOrder(null);
        return;
      }

      setIsRefreshingDetail(true);
      try {
        const data = await client.getOrderById(selectedOrderId);
        if (mounted) {
          setSelectedOrder(data);
          setAdminStatus(data.status);
          if (data.delivery?.courierId) {
            setManualCourierId(data.delivery.courierId);
          }
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load order details");
        }
      } finally {
        if (mounted) {
          setIsRefreshingDetail(false);
        }
      }
    }

    void loadDetails();

    return () => {
      mounted = false;
    };
  }, [client, selectedOrderId]);

  useEffect(() => {
    if (isOrdersLiveConnected) {
      return;
    }

    let mounted = true;
    const timer = window.setInterval(async () => {
      setIsFallbackRefreshing(true);
      try {
        const data = await client.getAdminOrders(activeFilters);
        if (!mounted) {
          return;
        }

        setOrders(data);
        if (!data.length) {
          setSelectedOrderId(null);
          setSelectedOrder(null);
          return;
        }

        const currentId =
          selectedOrderId && data.some((item) => item.id === selectedOrderId)
            ? selectedOrderId
            : data[0].id;

        setSelectedOrderId(currentId);
        const currentOrder = data.find((item) => item.id === currentId);
        if (currentOrder) {
          setSelectedOrder(currentOrder);
          setAdminStatus(currentOrder.status);
          if (currentOrder.delivery?.courierId) {
            setManualCourierId(currentOrder.delivery.courierId);
          }
        }
      } catch {
        // Silent on periodic fallback polling.
      } finally {
        if (mounted) {
          setIsFallbackRefreshing(false);
        }
      }
    }, 2000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [activeFilters, client, isOrdersLiveConnected, selectedOrderId]);

  useEffect(() => {
    if (isOrdersLiveConnected) {
      setIsFallbackRefreshing(false);
    }
  }, [isOrdersLiveConnected]);

  async function applyFilters() {
    setActiveFilters(draftFilters);
    setIsLoading(true);
    setError(null);
    try {
      await loadOrders(draftFilters);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to apply filters");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshAll() {
    setIsLoading(true);
    setError(null);
    try {
      await Promise.all([loadOrders(activeFilters), loadCouriers()]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to refresh orders");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAdminStatusUpdate() {
    if (!selectedOrder) {
      return;
    }

    setIsUpdatingStatus(true);
    setError(null);
    try {
      await client.updateOrderStatusByAdmin(selectedOrder.id, adminStatus);
      await refreshAll();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update status");
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  async function handleManualAssign() {
    if (!selectedOrder || !manualCourierId) {
      return;
    }

    if (
      selectedOrder.address === undefined ||
      selectedOrder.lat === undefined ||
      selectedOrder.lng === undefined
    ) {
      setError("Order does not have delivery coordinates");
      return;
    }

    setIsManualAssigning(true);
    setError(null);
    try {
      await client.assignDeliveryManual({
        orderId: selectedOrder.id,
        userId: selectedOrder.userId,
        address: selectedOrder.address,
        lat: selectedOrder.lat,
        lng: selectedOrder.lng,
        total: selectedOrder.total,
        courierId: manualCourierId,
        items: selectedOrder.items.map((item) => ({
          productId: item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity
        }))
      });

      await refreshAll();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Failed to assign courier");
    } finally {
      setIsManualAssigning(false);
    }
  }

  return (
    <section className="animate-fade-in space-y-4 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-float backdrop-blur-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Orders Management</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            {isOrdersLiveConnected
              ? "Live WS"
              : isFallbackRefreshing
                ? "Polling..."
                : "Polling fallback (2s)"}
          </span>
          <button
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card"
            type="button"
            onClick={refreshAll}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="glass-panel grid gap-3 rounded-2xl p-3 md:grid-cols-5">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Status</span>
          <select
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | OrderStatus)}
          >
            <option value="all">All</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Date from</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Date to</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Min total</span>
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
            type="number"
            min="0"
            step="0.01"
            value={minTotal}
            onChange={(event) => setMinTotal(event.target.value)}
            placeholder="0"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-600">Max total</span>
          <div className="flex gap-2">
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 outline-none ring-brand-200 focus:ring"
              type="number"
              min="0"
              step="0.01"
              value={maxTotal}
              onChange={(event) => setMaxTotal(event.target.value)}
              placeholder="999"
            />
            <button
              className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700"
              type="button"
              onClick={applyFilters}
            >
              Apply
            </button>
          </div>
        </label>
      </div>

      {isLoading ? (
        <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
          <div className="skeleton h-72" />
          <div className="skeleton h-72" />
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/80 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">Order</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const selected = order.id === selectedOrderId;
                return (
                  <tr
                    key={order.id}
                    className={`cursor-pointer border-t border-slate-100 transition duration-200 hover:bg-slate-50/80 ${selected ? "bg-brand-50/70" : "bg-white"}`}
                    onClick={() => setSelectedOrderId(order.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                          {initialsFromText(order.userId) || "US"}
                        </span>
                        <div>
                          <p className="font-mono text-xs text-slate-700">{order.id.slice(0, 12)}...</p>
                          <p className="text-xs text-slate-500">{order.userId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-xl px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-white/80 ${statusClasses(order.status)}`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">${order.total.toFixed(2)}</td>
                    <td className="px-4 py-3 text-xs">{new Date(order.createdAt).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!orders.length && !isLoading ? (
            <div className="px-4 py-8 text-center">
              <img src="/images/empty-table.svg" alt="No orders" className="mx-auto mb-3 h-24 w-auto" loading="lazy" />
              <p className="text-sm font-medium text-slate-700">No orders found for selected filters.</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4">
          <h3 className="text-lg font-extrabold tracking-tight text-slate-900">Order Details</h3>
          {isRefreshingDetail ? <p className="text-sm text-slate-500">Refreshing details...</p> : null}

          {!selectedOrder ? <p className="text-sm text-slate-500">Select order from the table.</p> : null}

          {selectedOrder ? (
            <>
              <div className="space-y-1 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-sm text-slate-700">
                <p><span className="font-medium text-slate-500">Customer:</span> {selectedOrder.userId}</p>
                <p><span className="font-medium text-slate-500">Address:</span> {selectedOrder.address ?? "-"}</p>
                <p>
                  <span className="font-medium text-slate-500">Courier:</span>{" "}
                  {selectedOrder.delivery ? selectedOrder.delivery.courierName : "Not assigned"}
                </p>
                <p>
                  <span className="font-medium text-slate-500">ETA:</span>{" "}
                  {selectedOrder.delivery ? `${selectedOrder.delivery.etaMinutes} min` : "-"}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">Items</p>
                <ul className="space-y-1 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-sm text-slate-700">
                  {selectedOrder.items.map((item) => (
                    <li key={`${selectedOrder.id}-${item.productId}`}>
                      {item.name} x{item.quantity} = ${item.lineTotal.toFixed(2)}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-100 bg-white p-3">
                <p className="text-sm font-semibold text-slate-800">Admin status override</p>
                <div className="flex gap-2">
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-200 focus:ring"
                    value={adminStatus}
                    onChange={(event) => setAdminStatus(event.target.value as OrderStatus)}
                  >
                    {ORDER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 disabled:opacity-60"
                    type="button"
                    onClick={handleAdminStatusUpdate}
                    disabled={isUpdatingStatus}
                  >
                    {isUpdatingStatus ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-100 bg-white p-3">
                <p className="text-sm font-semibold text-slate-800">Manual courier assignment</p>
                <div className="flex gap-2">
                  <select
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-200 focus:ring"
                    value={manualCourierId}
                    onChange={(event) => setManualCourierId(event.target.value)}
                  >
                    {couriers.map((courier) => (
                      <option key={courier.id} value={courier.id}>
                        {courier.name} ({courier.isAvailable ? "free" : "busy"})
                      </option>
                    ))}
                  </select>
                  <button
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card disabled:opacity-60"
                    type="button"
                    onClick={handleManualAssign}
                    disabled={isManualAssigning || !manualCourierId}
                  >
                    {isManualAssigning ? "Assigning..." : "Assign"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
