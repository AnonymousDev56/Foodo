import type { Order, Product, RecommendedProduct } from "@foodo/shared-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useFoodoClient } from "../api/foodo.client";
import { useOrdersLive } from "../orders/useOrdersLive";
import { getViewedProductIds, trackProductView } from "../recommendations/view-history";

const LOCAL_PRODUCT_IMAGE_BY_NAME: Record<string, string> = {
  "classic burger": "/images/products/classic-burger.jpg",
  "double burger": "/images/products/double-burger.jpg",
  "chicken burger": "/images/products/chicken-burger.jpg",
  "pepperoni pizza": "/images/products/pepperoni-pizza.jpg",
  "margherita pizza": "/images/products/margherita-pizza.jpg",
  "bbq pizza": "/images/products/bbq-pizza.jpg",
  "caesar salad": "/images/products/caesar-salad.jpg",
  "greek salad": "/images/products/greek-salad.jpg",
  "tuna salad": "/images/products/tuna-salad.jpg",
  "avocado bowl": "/images/products/avocado-bowl.jpg",
  "sushi set": "/images/products/tuna-salad.jpg"
};

function resolveProductImage(product: Product) {
  const local = LOCAL_PRODUCT_IMAGE_BY_NAME[product.name.toLowerCase()];
  return local ?? product.imageUrl ?? "/images/product-fallback.svg";
}

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

export function OrderDetailsPage() {
  const { id } = useParams();
  const client = useFoodoClient();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStatusSyncing, setIsStatusSyncing] = useState(false);
  const [togetherProducts, setTogetherProducts] = useState<RecommendedProduct[]>([]);
  const [isLoadingTogether, setIsLoadingTogether] = useState(false);
  const [togetherError, setTogetherError] = useState<string | null>(null);
  const [togetherSeedLabel, setTogetherSeedLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<Order["status"] | null>(null);
  const statusSyncTimeoutRef = useRef<number | null>(null);
  const togetherSeedRef = useRef<string | null>(null);
  const onOrderUpdated = useCallback(
    (updatedOrder: Order) => {
      if (!id || updatedOrder.id !== id) {
        return;
      }

      const prevStatus = statusRef.current;
      if (prevStatus && prevStatus !== updatedOrder.status) {
        setIsStatusSyncing(true);
        if (statusSyncTimeoutRef.current) {
          window.clearTimeout(statusSyncTimeoutRef.current);
        }
        statusSyncTimeoutRef.current = window.setTimeout(() => {
          setIsStatusSyncing(false);
        }, 800);
      }

      statusRef.current = updatedOrder.status;
      setOrder(updatedOrder);
      setError(null);
    },
    [id]
  );
  const { isConnected: isLiveConnected } = useOrdersLive({
    enabled: Boolean(id),
    onOrderUpdated
  });

  async function loadTogetherRecommendations(nextOrder: Order) {
    if (!nextOrder.items.length) {
      setTogetherProducts([]);
      return;
    }

    const seedItem = nextOrder.items[0];
    const seedKey = `${nextOrder.id}:${nextOrder.items.map((item) => item.productId).join(",")}`;
    if (togetherSeedRef.current === seedKey) {
      return;
    }
    togetherSeedRef.current = seedKey;

    setIsLoadingTogether(true);
    setTogetherError(null);
    setTogetherSeedLabel(seedItem.name);

    try {
      trackProductView(seedItem.productId);
      const data = await client.getRecommendations({
        productId: seedItem.productId,
        viewedProductIds: getViewedProductIds(6),
        limit: 4,
        weights: {
          history: 1,
          together: 6,
          popular: 1
        }
      });

      const orderProductIds = new Set(nextOrder.items.map((item) => item.productId));
      setTogetherProducts(data.filter((item) => !orderProductIds.has(item.id)));
    } catch (loadError) {
      setTogetherError(
        loadError instanceof Error ? loadError.message : "Failed to load together recommendations"
      );
    } finally {
      setIsLoadingTogether(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    async function loadOrder() {
      if (!id) {
        setError("Order id is missing");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const data = await client.getOrderById(id);
        if (mounted) {
          statusRef.current = data.status;
          setOrder(data);
          void loadTogetherRecommendations(data);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load order");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadOrder();

    return () => {
      mounted = false;
    };
  }, [client, id]);

  useEffect(() => {
    if (!id || isLiveConnected) {
      return;
    }

    let mounted = true;
    const interval = window.setInterval(async () => {
      try {
        const latest = await client.getOrderById(id);
        if (!mounted) {
          return;
        }
        onOrderUpdated(latest);
      } catch {
        // Silent fallback polling.
      }
    }, 2500);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      if (statusSyncTimeoutRef.current) {
        window.clearTimeout(statusSyncTimeoutRef.current);
      }
    };
  }, [client, id, isLiveConnected, onOrderUpdated]);

  return (
    <section className="animate-fade-in rounded-3xl border border-white/70 bg-white/85 p-5 shadow-float backdrop-blur-sm sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Order details</h2>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-xl px-2.5 py-1 text-xs font-semibold ${
              isLiveConnected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
            }`}
          >
            {isLiveConnected ? "Live WS" : "Polling fallback"}
          </span>
          <Link className="text-sm font-semibold text-brand-700 transition hover:text-brand-800" to="/orders">
            Back to orders
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="skeleton h-20" />
          <div className="skeleton h-20" />
          <div className="skeleton h-20" />
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {order ? (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="glass-panel rounded-2xl p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Order ID</p>
              <p className="mt-1 font-mono text-xs text-slate-700">{order.id}</p>
            </div>
            <div className="glass-panel rounded-2xl p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Created</p>
              <p className="mt-1 text-sm text-slate-700">{new Date(order.createdAt).toLocaleString()}</p>
            </div>
            <div className="glass-panel rounded-2xl p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
              <p className="mt-1 text-lg font-bold text-slate-900">${order.total.toFixed(2)}</p>
            </div>
            <div className="glass-panel rounded-2xl p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
              <span
                className={`mt-1 inline-flex items-center gap-2 rounded-xl px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-white/80 ${statusClasses(order.status)}`}
              >
                {isStatusSyncing ? (
                  <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                ) : null}
                {order.status}
              </span>
            </div>
            <div className="glass-panel rounded-2xl p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Optimized ETA</p>
              <p className="mt-1 text-sm text-slate-700">
                {order.delivery ? `${order.delivery.etaMinutes} min` : "Waiting for courier assignment"}
              </p>
              {order.delivery?.etaLowerMinutes && order.delivery?.etaUpperMinutes ? (
                <p className="mt-1 text-xs text-slate-500">
                  Range: {order.delivery.etaLowerMinutes}-{order.delivery.etaUpperMinutes} min
                  {order.delivery.etaConfidenceScore !== undefined
                    ? ` • confidence ${order.delivery.etaConfidenceScore.toFixed(0)}%`
                    : ""}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-slate-500">
                Route-aware estimate updates when courier route is recalculated.
              </p>
            </div>
            <div className="glass-panel rounded-2xl p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Courier</p>
              <p className="mt-1 text-sm text-slate-700">
                {order.delivery ? order.delivery.courierName : "Not assigned yet"}
              </p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50/80 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">Product</th>
                  <th className="px-4 py-3 font-semibold">Qty</th>
                  <th className="px-4 py-3 font-semibold">Price</th>
                  <th className="px-4 py-3 font-semibold">Line total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.productId} className="border-t border-slate-100 bg-white transition hover:bg-slate-50/60">
                    <td className="px-4 py-3">{item.name}</td>
                    <td className="px-4 py-3">{item.quantity}</td>
                    <td className="px-4 py-3">${item.price.toFixed(2)}</td>
                    <td className="px-4 py-3">${item.lineTotal.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  Recommendation Engine
                </p>
                <h3 className="text-base font-bold text-slate-900">Frequently bought together</h3>
                <p className="text-xs text-slate-500">
                  {togetherSeedLabel ? `Based on ${togetherSeedLabel}` : "Based on this order"}
                </p>
              </div>
            </div>

            {isLoadingTogether ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="skeleton h-36" />
                <div className="skeleton h-36" />
                <div className="skeleton h-36" />
                <div className="skeleton h-36" />
              </div>
            ) : null}

            {!isLoadingTogether && togetherError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {togetherError}
              </div>
            ) : null}

            {!isLoadingTogether && !togetherError && !togetherProducts.length ? (
              <p className="text-sm text-slate-500">No additional pairs found for this order yet.</p>
            ) : null}

            {!isLoadingTogether && !togetherError && togetherProducts.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {togetherProducts.map((product) => (
                  <article
                    key={`order-together-${product.id}`}
                    className="overflow-hidden rounded-2xl border border-slate-100 bg-white transition duration-300 hover:-translate-y-1 hover:shadow-card"
                  >
                    <img
                      src={resolveProductImage(product)}
                      alt={product.name}
                      className="h-24 w-full object-cover"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.src = "/images/product-fallback.svg";
                      }}
                    />
                    <div className="space-y-1 p-3">
                      <p className="line-clamp-1 text-sm font-semibold text-slate-900">{product.name}</p>
                      <p className="text-xs text-slate-500">${product.price.toFixed(2)}</p>
                      <Link
                        to="/products"
                        className="mt-1 inline-flex rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
                        onClick={() => {
                          trackProductView(product.id);
                        }}
                      >
                        View in catalog
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          <p className="mt-4 text-sm text-slate-500">
            Delivery status is updated by courier panel and synced here automatically.
          </p>
        </>
      ) : null}
    </section>
  );
}
