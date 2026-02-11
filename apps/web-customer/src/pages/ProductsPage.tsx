import type { Product, ProductSort, RecommendedProduct } from "@foodo/shared-types";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFoodoClient } from "../api/foodo.client";
import { useCart } from "../cart/cart.context";
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

function productDescription(product: Product) {
  return `Fresh ${product.category.toLowerCase()} option, prepared daily.`;
}

function recommendationReasonLabel(reason: RecommendedProduct["reason"]) {
  if (reason === "together") {
    return "Frequently bought together";
  }
  if (reason === "history") {
    return "Based on your order history";
  }
  return "Popular with customers";
}

export function ProductsPage() {
  const client = useFoodoClient();
  const navigate = useNavigate();
  const { items, totalItems, subtotal, addProduct, removeItem, setQuantity, checkout, isCheckingOut } =
    useCart();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sort, setSort] = useState<ProductSort>("price_asc");
  const [isLoading, setIsLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<RecommendedProduct[]>([]);
  const [recommendationContextProduct, setRecommendationContextProduct] = useState<string | null>(null);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(true);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const recommendationWeights = { history: 2, together: 4, popular: 1 } as const;

  useEffect(() => {
    let mounted = true;

    async function loadCategories() {
      try {
        const data = await client.getCategories();
        if (mounted) {
          setCategories(data);
        }
      } catch {
        // Categories are optional for rendering; products list still works.
      }
    }

    void loadCategories();

    return () => {
      mounted = false;
    };
  }, [client]);

  useEffect(() => {
    let mounted = true;

    async function loadProducts() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await client.getProducts({
          category: selectedCategory === "all" ? undefined : selectedCategory,
          sort
        });
        if (mounted) {
          setProducts(data);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load products");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    void loadProducts();

    return () => {
      mounted = false;
    };
  }, [client, selectedCategory, sort]);

  async function loadRecommendations(productId?: string) {
    setIsLoadingRecommendations(true);
    setRecommendationsError(null);
    try {
      const viewedProductIds = getViewedProductIds(6);
      const data = await client.getRecommendations({
        productId,
        viewedProductIds,
        limit: 4,
        weights: recommendationWeights
      });
      setRecommendations(data);
      setRecommendationContextProduct(productId ?? null);
    } catch (loadError) {
      setRecommendationsError(
        loadError instanceof Error ? loadError.message : "Failed to load recommendations"
      );
    } finally {
      setIsLoadingRecommendations(false);
    }
  }

  useEffect(() => {
    void loadRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  async function handleCheckout() {
    setCheckoutError(null);
    try {
      const order = await checkout();
      navigate(`/orders/${order.id}`);
    } catch (checkoutSubmitError) {
      setCheckoutError(
        checkoutSubmitError instanceof Error ? checkoutSubmitError.message : "Checkout failed"
      );
    }
  }

  return (
    <div className="animate-fade-in grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-5 rounded-3xl border border-white/70 bg-white/85 p-5 shadow-float backdrop-blur-sm sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Products</h2>
            <p className="text-sm text-slate-500">Choose favorites and build your order.</p>
          </div>
          <span className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700">
            {products.length} items
          </span>
        </div>

        <div className="glass-panel grid gap-3 rounded-2xl p-3 md:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Category
            </span>
            <select
              id="category-filter"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-200 focus:ring"
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Sort
            </span>
            <select
              id="sort-filter"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-200 focus:ring"
              value={sort}
              onChange={(event) => setSort(event.target.value as ProductSort)}
            >
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </select>
          </label>

          <div className="hidden items-end justify-end md:flex">
            <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
              Premium catalog
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Recommendation Engine</p>
              <h3 className="text-base font-bold text-slate-900">
                {recommendationContextProduct ? "Similar picks" : "Recommended for you"}
              </h3>
            </div>
            <button
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:shadow-card"
              type="button"
              onClick={() => void loadRecommendations()}
            >
              Refresh picks
            </button>
          </div>

          {isLoadingRecommendations ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="skeleton h-40" />
              <div className="skeleton h-40" />
              <div className="skeleton h-40" />
              <div className="skeleton h-40" />
            </div>
          ) : null}

          {!isLoadingRecommendations && recommendationsError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {recommendationsError}
            </div>
          ) : null}

          {!isLoadingRecommendations && !recommendationsError && !recommendations.length ? (
            <p className="text-sm text-slate-500">Recommendations will appear after your first order.</p>
          ) : null}

          {!isLoadingRecommendations && !recommendationsError && recommendations.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recommendations.map((product) => (
                <article
                  key={`recommended-${product.id}`}
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
                    <p className="text-xs text-slate-500">{recommendationReasonLabel(product.reason)}</p>
                    <p className="text-sm font-bold text-slate-900">${product.price.toFixed(2)}</p>
                    <button
                      className="mt-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
                      type="button"
                      onClick={() => {
                        trackProductView(product.id);
                        void loadRecommendations(product.id);
                      }}
                    >
                      More like this
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="skeleton h-72" />
            <div className="skeleton h-72" />
            <div className="skeleton h-72" />
            <div className="skeleton h-72" />
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && !products.length ? (
          <div className="glass-panel rounded-2xl px-6 py-10 text-center">
            <img
              src="/images/empty-orders.svg"
              alt="No products"
              className="mx-auto mb-4 h-28 w-auto opacity-90"
              loading="lazy"
            />
            <p className="text-sm font-semibold text-slate-700">No products found</p>
            <p className="mt-1 text-sm text-slate-500">Try another category or sorting option.</p>
          </div>
        ) : null}

        {!isLoading && !error && products.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {products.map((product, index) => (
              <article
                key={product.id}
                className={`group overflow-hidden rounded-3xl border border-slate-100 bg-white transition duration-300 hover:-translate-y-1.5 hover:shadow-float ${
                  index < 2 ? "animate-fade-in" : "animate-fade-in-delayed"
                }`}
              >
                <img
                  src={resolveProductImage(product)}
                  alt={product.name}
                  className="h-52 w-full object-cover transition duration-300 group-hover:scale-105"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.src = "/images/product-fallback.svg";
                  }}
                />

                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{product.name}</h3>
                      <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
                        {product.category}
                      </p>
                    </div>
                    <span className="text-2xl font-extrabold text-slate-900">${product.price.toFixed(2)}</span>
                  </div>

                  <p className="text-sm leading-relaxed text-slate-500">{productDescription(product)}</p>

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="rounded-lg bg-slate-100 px-2 py-1">Stock: {product.stock}</span>
                    <button
                      className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        trackProductView(product.id);
                        addProduct(product);
                        void loadRecommendations(product.id);
                      }}
                      type="button"
                      disabled={product.stock <= 0}
                    >
                      Add to cart
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <aside className="glass-panel h-fit rounded-3xl p-5 xl:sticky xl:top-24">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Cart</h2>
          <span className="rounded-xl border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            {totalItems} items
          </span>
        </div>

        {!items.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-6 text-center">
            <svg
              className="mx-auto mb-3 h-8 w-8 text-slate-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path
                d="M3 5H5L7.2 14.4a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L20 8H7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="9" cy="19" r="1.6" />
              <circle cx="17" cy="19" r="1.6" />
            </svg>
            <p className="text-sm font-medium text-slate-700">Your cart is empty</p>
            <p className="mt-1 text-xs text-slate-500">Add products to continue checkout.</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.productId} className="rounded-2xl border border-slate-200 bg-white/85 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                  <p className="text-xs text-slate-500">${item.price.toFixed(2)} each</p>
                </div>
                <button
                  className="text-xs font-medium text-accent-700 transition hover:text-accent-800"
                  onClick={() => removeItem(item.productId)}
                  type="button"
                >
                  Remove
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white">
                  <button
                    className="px-2.5 py-1.5 text-sm text-slate-600 transition hover:text-slate-900"
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity - 1)}
                  >
                    -
                  </button>
                  <span className="px-2 py-1 text-xs font-semibold text-slate-700">{item.quantity}</span>
                  <button
                    className="px-2.5 py-1.5 text-sm text-slate-600 transition hover:text-slate-900"
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity + 1)}
                  >
                    +
                  </button>
                </div>
                <p className="text-sm font-semibold text-slate-900">
                  ${(item.price * item.quantity).toFixed(2)}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Subtotal</span>
            <span className="text-xl font-bold text-slate-900">${subtotal.toFixed(2)}</span>
          </div>
          {checkoutError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {checkoutError}
            </div>
          ) : null}
          <button
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={handleCheckout}
            disabled={!items.length || isCheckingOut}
          >
            {isCheckingOut ? "Creating order..." : "Checkout"}
          </button>
        </div>
      </aside>
    </div>
  );
}
