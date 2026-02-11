import type { Order } from "@foodo/shared-types";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFoodoClient } from "../api/foodo.client";
import { useOrdersLive } from "../orders/useOrdersLive";

function statusClasses(status: Order["status"]) {
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

export function OrdersPage() {
  const client = useFoodoClient();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onOrderUpdated = useCallback((updatedOrder: Order) => {
    setOrders((prev) => {
      const current = prev.find((order) => order.id === updatedOrder.id);
      if (!current) {
        return [updatedOrder, ...prev].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      }
      return prev
        .map((order) => (order.id === updatedOrder.id ? updatedOrder : order))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    });
    setError(null);
  }, []);
  const { isConnected: isLiveConnected } = useOrdersLive({
    enabled: true,
    onOrderUpdated
  });

  useEffect(() => {
    let mounted = true;

    async function loadOrders() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await client.getMyOrders();
        if (mounted) {
          setOrders(data);
        }
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

    void loadOrders();

    return () => {
      mounted = false;
    };
  }, [client]);

  return (
    <section className="animate-fade-in rounded-3xl border border-white/70 bg-white/85 p-5 shadow-float backdrop-blur-sm sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">My Orders</h2>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-xl px-2.5 py-1 text-xs font-semibold ${
              isLiveConnected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {isLiveConnected ? "Live WS" : "Offline WS"}
          </span>
          <Link className="text-sm font-semibold text-brand-700 transition hover:text-brand-800" to="/products">
            Back to products
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {!isLoading && !error && !orders.length ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-8 text-center">
          <img src="/images/empty-orders.svg" alt="No orders" className="mx-auto mb-4 h-28 w-auto" loading="lazy" />
          <p className="text-sm font-semibold text-slate-700">No orders yet</p>
          <p className="mt-1 text-sm text-slate-500">Place your first order from the catalog.</p>
        </div>
      ) : null}

      {!isLoading && !error && orders.length ? (
        <div className="space-y-3">
          {orders.map((order) => (
            <article
              key={order.id}
              className="rounded-2xl border border-slate-100 bg-white p-4 transition duration-300 hover:-translate-y-1 hover:shadow-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Order ID</p>
                  <p className="font-mono text-xs text-slate-700">{order.id}</p>
                </div>
                <span
                  className={`rounded-xl px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-white/80 ${statusClasses(order.status)}`}
                >
                  {order.status}
                </span>
              </div>

              <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-3">
                <p>Items: {order.items.length}</p>
                <p>Total: ${order.total.toFixed(2)}</p>
                <p>{new Date(order.createdAt).toLocaleString()}</p>
              </div>

              <div className="mt-3">
                <Link className="text-sm font-semibold text-brand-700 transition hover:text-brand-800" to={`/orders/${order.id}`}>
                  Open details
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
