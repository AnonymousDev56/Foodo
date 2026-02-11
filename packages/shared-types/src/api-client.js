"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoodoClient = exports.ORDER_STATUS_SEQUENCE = void 0;
exports.createFoodoClient = createFoodoClient;
exports.ORDER_STATUS_SEQUENCE = ["pending", "cooking", "delivery", "done"];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
function normalizeLoopbackBaseUrl(baseUrl) {
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
    }
    catch {
        return baseUrl.replace(/\/+$/, "");
    }
}
function toLoopbackAlt(baseUrl) {
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
    }
    catch {
        return null;
    }
}
function getBaseUrlCandidates(baseUrl) {
    const primary = normalizeLoopbackBaseUrl(baseUrl);
    const alt = toLoopbackAlt(primary);
    return alt && alt !== primary ? [primary, alt] : [primary];
}
function getErrorMessage(payload) {
    if (!payload || typeof payload !== "object") {
        return "Request failed";
    }
    const maybeMessage = payload.message;
    if (Array.isArray(maybeMessage)) {
        return maybeMessage.join(", ");
    }
    if (typeof maybeMessage === "string") {
        return maybeMessage;
    }
    return "Request failed";
}
class FoodoClient {
    ordersApiUrl;
    warehouseApiUrl;
    deliveryApiUrl;
    getAccessToken;
    constructor(config) {
        this.ordersApiUrl = config.ordersApiUrl ?? "http://localhost:3002";
        this.warehouseApiUrl = config.warehouseApiUrl ?? "http://localhost:3003";
        this.deliveryApiUrl = config.deliveryApiUrl ?? "http://localhost:3004";
        this.getAccessToken = config.getAccessToken;
    }
    getProducts(query) {
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
        return this.request(this.warehouseApiUrl, path);
    }
    getProductById(productId) {
        return this.request(this.warehouseApiUrl, `/products/${productId}`);
    }
    createProduct(payload) {
        return this.request(this.warehouseApiUrl, "/products", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    updateProduct(productId, payload) {
        return this.request(this.warehouseApiUrl, `/products/${productId}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        });
    }
    deleteProduct(productId) {
        return this.request(this.warehouseApiUrl, `/products/${productId}`, {
            method: "DELETE"
        });
    }
    getCategories() {
        return this.request(this.warehouseApiUrl, "/categories");
    }
    createCategory(payload) {
        return this.request(this.warehouseApiUrl, "/categories", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    renameCategory(currentName, payload) {
        return this.request(this.warehouseApiUrl, `/categories/${encodeURIComponent(currentName)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        });
    }
    deleteCategory(name) {
        return this.request(this.warehouseApiUrl, `/categories/${encodeURIComponent(name)}`, {
            method: "DELETE"
        });
    }
    decrementStock(items) {
        return this.request(this.warehouseApiUrl, "/stock/decrement", {
            method: "POST",
            body: JSON.stringify({ items })
        });
    }
    createOrder(payload) {
        return this.request(this.ordersApiUrl, "/orders", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    getMyOrders() {
        return this.request(this.ordersApiUrl, "/orders/my");
    }
    getOrderById(id) {
        return this.request(this.ordersApiUrl, `/orders/${id}`);
    }
    getRecommendations(query) {
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
        return this.request(this.ordersApiUrl, path);
    }
    getAdminOrders(filters) {
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
        return this.request(this.ordersApiUrl, path);
    }
    getAdminDashboardMetrics() {
        return this.request(this.ordersApiUrl, "/admin/dashboard-metrics");
    }
    updateOrderStatus(id, status) {
        return this.request(this.ordersApiUrl, `/orders/${id}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        });
    }
    updateOrderStatusByAdmin(id, status) {
        return this.request(this.ordersApiUrl, `/orders/${id}/admin-status`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        });
    }
    assignDelivery(payload) {
        return this.request(this.deliveryApiUrl, "/delivery/assign", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    assignDeliveryManual(payload) {
        return this.request(this.deliveryApiUrl, "/delivery/assign/manual", {
            method: "POST",
            body: JSON.stringify(payload)
        });
    }
    getDeliveryByOrder(orderId) {
        return this.request(this.deliveryApiUrl, `/delivery/${orderId}`);
    }
    getCourierActiveDeliveries(courierId) {
        return this.request(this.deliveryApiUrl, `/delivery/courier/${courierId}/active`);
    }
    getActiveDeliveries() {
        return this.request(this.deliveryApiUrl, "/delivery/active");
    }
    getCouriers() {
        return this.request(this.deliveryApiUrl, "/delivery/couriers");
    }
    getDeliveryStats() {
        return this.request(this.deliveryApiUrl, "/delivery/stats");
    }
    updateDeliveryStatus(orderId, status) {
        return this.request(this.deliveryApiUrl, `/delivery/${orderId}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        });
    }
    async request(baseUrl, path, init) {
        const token = this.getAccessToken?.();
        const baseUrls = getBaseUrlCandidates(baseUrl);
        let response = null;
        let networkError = null;
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
            }
            catch (error) {
                networkError = error;
            }
        }
        if (!response) {
            throw networkError instanceof Error ? networkError : new Error("Failed to fetch");
        }
        if (!response.ok) {
            let payload;
            try {
                payload = await response.json();
            }
            catch {
                throw new Error(`HTTP ${response.status}`);
            }
            throw new Error(getErrorMessage(payload));
        }
        return (await response.json());
    }
}
exports.FoodoClient = FoodoClient;
function createFoodoClient(config) {
    return new FoodoClient(config);
}
