export type Role = "Customer" | "Courier" | "Admin";
export type AdminRole = "Admin";

export interface User {
  id: string;
  email: string;
  role: Role;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  imageUrl?: string;
}

export interface ProductInput {
  name: string;
  category: string;
  price: number;
  stock: number;
  imageUrl?: string;
}

export interface CategoryInput {
  name: string;
}

export type ProductSort = "price_asc" | "price_desc";

export interface ProductsQuery {
  category?: string;
  sort?: ProductSort;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
}

export type DeliveryStatus = "assigned" | "cooking" | "delivery" | "done";

export interface Courier {
  id: string;
  email: string;
  name: string;
  lat: number;
  lng: number;
  isAvailable: boolean;
}

export interface Route {
  id: string;
  orderId: string;
  courierId: string;
  courierName: string;
  address: string;
  etaMinutes: number;
  etaLowerMinutes: number;
  etaUpperMinutes: number;
  etaConfidenceScore: number;
  routeSequence: number;
  routeTotalTimeMinutes: number;
  routeDistanceKm: number;
  status: DeliveryStatus;
  total: number;
  items: CreateOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface RouteStep {
  orderId: string;
  address: string;
  etaMinutes: number;
  etaLowerMinutes: number;
  etaUpperMinutes: number;
  etaConfidenceScore: number;
  sequence: number;
}

export interface OptimizedRoute {
  courierId: string;
  steps: RouteStep[];
  totalTime: number;
  totalTimeLower: number;
  totalTimeUpper: number;
  confidenceScore: number;
  totalDistanceKm: number;
}

export interface OptimizedCourierRouteResponse {
  courierId: string;
  assignedOrders: Route[];
  optimizedRoute: OptimizedRoute;
  etaBreakdown: RouteStep[];
  totalTime: number;
  totalDistanceKm: number;
  recalculatedAt: string;
  algorithm: "greedy" | "tsp-lite";
}

export interface CourierStats {
  courierId: string;
  courierName: string;
  activeCount: number;
  completedCount: number;
  avgDeliveryMinutes: number;
}

export interface DeliveryStats {
  activeRoutes: number;
  completedRoutes: number;
  averageEtaMinutes: number;
  couriers: CourierStats[];
}

export interface DashboardTopProduct {
  name: string;
  count: number;
}

export interface DashboardSeriesPoint {
  hour: string;
  value: number;
}

export interface AdminDashboardMetrics {
  activeOrders: number;
  completedToday: number;
  averageEta: number;
  activeCouriers: number;
  revenueToday: number;
  avgRouteLength: number;
  avgEtaAccuracy: number;
  optimizedAssignments: Array<{
    orderId: string;
    courierId: string;
    courierName: string;
    address: string;
    lat: number;
    lng: number;
    etaMinutes: number;
    etaLowerMinutes: number;
    etaUpperMinutes: number;
    etaConfidenceScore: number;
    sequence: number;
    status: DeliveryStatus;
  }>;
  topProducts: DashboardTopProduct[];
  ordersPerHour: DashboardSeriesPoint[];
  revenuePerHour: DashboardSeriesPoint[];
  updatedAt: string;
}

export interface AdminDashboardLiveMessage {
  type: "dashboardUpdate";
  data: AdminDashboardMetrics;
}

export type OrderStatus = "pending" | "cooking" | "delivery" | "done";

export const ORDER_STATUS_SEQUENCE: OrderStatus[] = ["pending", "cooking", "delivery", "done"];

export interface CreateOrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface CreateOrderPayload {
  items: CreateOrderItem[];
}

export interface OrderItem extends CreateOrderItem {
  lineTotal: number;
}

export interface Order {
  id: string;
  userId: string;
  status: OrderStatus;
  items: OrderItem[];
  total: number;
  createdAt: string;
  updatedAt: string;
  address?: string;
  lat?: number;
  lng?: number;
  delivery?: {
    courierId: string;
    courierName: string;
    address: string;
    etaMinutes: number;
    etaLowerMinutes?: number;
    etaUpperMinutes?: number;
    etaConfidenceScore?: number;
    status: DeliveryStatus;
    updatedAt: string;
  };
}

export interface OrderLiveMessage {
  type: "order.updated";
  emittedAt: string;
  order: Order;
}

export interface DeliveryLiveMessage {
  type: "delivery.updated";
  emittedAt: string;
  route: Route;
}

export interface OrderFilters {
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
  minTotal?: number;
  maxTotal?: number;
}

export type RecommendationReason = "history" | "together" | "popular";

export interface RecommendedProduct extends Product {
  score: number;
  reason: RecommendationReason;
}

export interface RecommendationsQuery {
  productId?: string;
  viewedProductIds?: string[];
  limit?: number;
  weights?: Partial<RecommendationWeights>;
}

export interface RecommendationWeights {
  history: number;
  together: number;
  popular: number;
}

export interface AssignDeliveryPayload {
  orderId: string;
  userId: string;
  address: string;
  lat: number;
  lng: number;
  total: number;
  items: CreateOrderItem[];
}

export interface ManualAssignDeliveryPayload extends AssignDeliveryPayload {
  courierId: string;
}

export interface StockDecrementItem {
  productId: string;
  quantity: number;
}

export interface FoodoClientConfig {
  ordersApiUrl?: string;
  warehouseApiUrl?: string;
  deliveryApiUrl?: string;
  getAccessToken?: () => string | null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

function normalizeLoopbackBaseUrl(baseUrl: string) {
  if (typeof window === "undefined") {
    return baseUrl.replace(/\/+$/, "");
  }

  try {
    const parsed = new URL(baseUrl);
    const browserHost = window.location.hostname;
    if (LOOPBACK_HOSTS.has(parsed.hostname) && LOOPBACK_HOSTS.has(browserHost)) {
      parsed.hostname = browserHost;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return baseUrl.replace(/\/+$/, "");
  }
}

function toLoopbackAlt(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
      return parsed.toString().replace(/\/+$/, "");
    }
    if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
      return parsed.toString().replace(/\/+$/, "");
    }
    return null;
  } catch {
    return null;
  }
}

function getBaseUrlCandidates(baseUrl: string) {
  const primary = normalizeLoopbackBaseUrl(baseUrl);
  const alt = toLoopbackAlt(primary);
  return alt && alt !== primary ? [primary, alt] : [primary];
}

function getErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "Request failed";
  }

  const maybeMessage = (payload as { message?: unknown }).message;
  if (Array.isArray(maybeMessage)) {
    return maybeMessage.join(", ");
  }

  if (typeof maybeMessage === "string") {
    return maybeMessage;
  }

  return "Request failed";
}

export class FoodoClient {
  private readonly ordersApiUrl: string;
  private readonly warehouseApiUrl: string;
  private readonly deliveryApiUrl: string;
  private readonly getAccessToken?: () => string | null;

  constructor(config: FoodoClientConfig) {
    this.ordersApiUrl = config.ordersApiUrl ?? "http://localhost:3002";
    this.warehouseApiUrl = config.warehouseApiUrl ?? "http://localhost:3003";
    this.deliveryApiUrl = config.deliveryApiUrl ?? "http://localhost:3004";
    this.getAccessToken = config.getAccessToken;
  }

  getProducts(query?: ProductsQuery) {
    const params = new URLSearchParams();
    if (query?.category) {
      params.set("category", query.category);
    }
    if (query?.sort) {
      params.set("sort", query.sort);
    }
    if (query?.minPrice !== undefined) {
      params.set("minPrice", String(query.minPrice));
    }
    if (query?.maxPrice !== undefined) {
      params.set("maxPrice", String(query.maxPrice));
    }
    if (query?.inStock !== undefined) {
      params.set("inStock", String(query.inStock));
    }

    const search = params.toString();
    const path = search ? `/products?${search}` : "/products";
    return this.request<Product[]>(this.warehouseApiUrl, path);
  }

  getProductById(productId: string) {
    return this.request<Product>(this.warehouseApiUrl, `/products/${productId}`);
  }

  createProduct(payload: ProductInput) {
    return this.request<Product>(this.warehouseApiUrl, "/products", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  updateProduct(productId: string, payload: Partial<ProductInput>) {
    return this.request<Product>(this.warehouseApiUrl, `/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  deleteProduct(productId: string) {
    return this.request<{ deleted: true; id: string }>(this.warehouseApiUrl, `/products/${productId}`, {
      method: "DELETE"
    });
  }

  getCategories() {
    return this.request<string[]>(this.warehouseApiUrl, "/categories");
  }

  createCategory(payload: CategoryInput) {
    return this.request<string[]>(this.warehouseApiUrl, "/categories", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  renameCategory(currentName: string, payload: CategoryInput) {
    return this.request<string[]>(
      this.warehouseApiUrl,
      `/categories/${encodeURIComponent(currentName)}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload)
      }
    );
  }

  deleteCategory(name: string) {
    return this.request<string[]>(this.warehouseApiUrl, `/categories/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });
  }

  decrementStock(items: StockDecrementItem[]) {
    return this.request<Product[]>(this.warehouseApiUrl, "/stock/decrement", {
      method: "POST",
      body: JSON.stringify({ items })
    });
  }

  createOrder(payload: CreateOrderPayload) {
    return this.request<Order>(this.ordersApiUrl, "/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getMyOrders() {
    return this.request<Order[]>(this.ordersApiUrl, "/orders/my");
  }

  getOrderById(id: string) {
    return this.request<Order>(this.ordersApiUrl, `/orders/${id}`);
  }

  getRecommendations(query?: RecommendationsQuery) {
    const params = new URLSearchParams();
    if (query?.productId) {
      params.set("productId", query.productId);
    }
    if (query?.viewedProductIds?.length) {
      params.set("viewed", query.viewedProductIds.join(","));
    }
    if (query?.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query?.weights?.history !== undefined) {
      params.set("weightHistory", String(query.weights.history));
    }
    if (query?.weights?.together !== undefined) {
      params.set("weightTogether", String(query.weights.together));
    }
    if (query?.weights?.popular !== undefined) {
      params.set("weightPopular", String(query.weights.popular));
    }

    const search = params.toString();
    const path = search ? `/orders/recommendations?${search}` : "/orders/recommendations";
    return this.request<RecommendedProduct[]>(this.ordersApiUrl, path);
  }

  getAdminOrders(filters?: OrderFilters) {
    const params = new URLSearchParams();
    if (filters?.status) {
      params.set("status", filters.status);
    }
    if (filters?.dateFrom) {
      params.set("dateFrom", filters.dateFrom);
    }
    if (filters?.dateTo) {
      params.set("dateTo", filters.dateTo);
    }
    if (filters?.minTotal !== undefined) {
      params.set("minTotal", String(filters.minTotal));
    }
    if (filters?.maxTotal !== undefined) {
      params.set("maxTotal", String(filters.maxTotal));
    }

    const search = params.toString();
    const path = search ? `/orders/admin?${search}` : "/orders/admin";
    return this.request<Order[]>(this.ordersApiUrl, path);
  }

  getAdminDashboardMetrics() {
    return this.request<AdminDashboardMetrics>(this.ordersApiUrl, "/admin/dashboard-metrics");
  }

  updateOrderStatus(id: string, status: OrderStatus) {
    return this.request<Order>(this.ordersApiUrl, `/orders/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  }

  updateOrderStatusByAdmin(id: string, status: OrderStatus) {
    return this.request<Order>(this.ordersApiUrl, `/orders/${id}/admin-status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  }

  assignDelivery(payload: AssignDeliveryPayload) {
    return this.request<Route>(this.deliveryApiUrl, "/delivery/assign", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  assignDeliveryManual(payload: ManualAssignDeliveryPayload) {
    return this.request<Route>(this.deliveryApiUrl, "/delivery/assign/manual", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getDeliveryByOrder(orderId: string) {
    return this.request<Route>(this.deliveryApiUrl, `/delivery/${orderId}`);
  }

  getCourierActiveDeliveries(courierId: string) {
    return this.request<Route[]>(this.deliveryApiUrl, `/delivery/courier/${courierId}/active`);
  }

  getCourierOptimizedRoute(courierId: string, mode?: "greedy" | "tsp-lite") {
    const params = new URLSearchParams();
    if (mode) {
      params.set("mode", mode);
    }
    const search = params.toString();
    const path = search
      ? `/delivery/route/${courierId}?${search}`
      : `/delivery/route/${courierId}`;
    return this.request<OptimizedCourierRouteResponse>(this.deliveryApiUrl, path);
  }

  getActiveDeliveries() {
    return this.request<Route[]>(this.deliveryApiUrl, "/delivery/active");
  }

  getCouriers() {
    return this.request<Courier[]>(this.deliveryApiUrl, "/delivery/couriers");
  }

  getDeliveryStats() {
    return this.request<DeliveryStats>(this.deliveryApiUrl, "/delivery/stats");
  }

  updateDeliveryStatus(orderId: string, status: DeliveryStatus) {
    return this.request<Route>(this.deliveryApiUrl, `/delivery/${orderId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  }

  recalculateDeliveryEta(orderId: string, mode?: "greedy" | "tsp-lite") {
    const params = new URLSearchParams();
    if (mode) {
      params.set("mode", mode);
    }

    const search = params.toString();
    const path = search
      ? `/delivery/${orderId}/recalculate-eta?${search}`
      : `/delivery/${orderId}/recalculate-eta`;

    return this.request<{ route: Route; optimizedRoute: OptimizedCourierRouteResponse }>(
      this.deliveryApiUrl,
      path,
      {
        method: "PATCH"
      }
    );
  }

  private async request<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
    const token = this.getAccessToken?.();
    const baseUrls = getBaseUrlCandidates(baseUrl);
    let response: Response | null = null;
    let networkError: unknown = null;

    for (const candidate of baseUrls) {
      try {
        response = await fetch(`${candidate}${path}`, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(init?.headers ?? {})
          }
        });
        break;
      } catch (error) {
        networkError = error;
      }
    }

    if (!response) {
      throw networkError instanceof Error ? networkError : new Error("Failed to fetch");
    }

    if (!response.ok) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }

      throw new Error(getErrorMessage(payload));
    }

    return (await response.json()) as T;
  }
}

export function createFoodoClient(config: FoodoClientConfig) {
  return new FoodoClient(config);
}
