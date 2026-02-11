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
    status: DeliveryStatus;
    total: number;
    items: CreateOrderItem[];
    createdAt: string;
    updatedAt: string;
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
export declare const ORDER_STATUS_SEQUENCE: OrderStatus[];
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
export declare class FoodoClient {
    private readonly ordersApiUrl;
    private readonly warehouseApiUrl;
    private readonly deliveryApiUrl;
    private readonly getAccessToken?;
    constructor(config: FoodoClientConfig);
    getProducts(query?: ProductsQuery): Promise<Product[]>;
    getProductById(productId: string): Promise<Product>;
    createProduct(payload: ProductInput): Promise<Product>;
    updateProduct(productId: string, payload: Partial<ProductInput>): Promise<Product>;
    deleteProduct(productId: string): Promise<{
        deleted: true;
        id: string;
    }>;
    getCategories(): Promise<string[]>;
    createCategory(payload: CategoryInput): Promise<string[]>;
    renameCategory(currentName: string, payload: CategoryInput): Promise<string[]>;
    deleteCategory(name: string): Promise<string[]>;
    decrementStock(items: StockDecrementItem[]): Promise<Product[]>;
    createOrder(payload: CreateOrderPayload): Promise<Order>;
    getMyOrders(): Promise<Order[]>;
    getOrderById(id: string): Promise<Order>;
    getRecommendations(query?: RecommendationsQuery): Promise<RecommendedProduct[]>;
    getAdminOrders(filters?: OrderFilters): Promise<Order[]>;
    getAdminDashboardMetrics(): Promise<AdminDashboardMetrics>;
    updateOrderStatus(id: string, status: OrderStatus): Promise<Order>;
    updateOrderStatusByAdmin(id: string, status: OrderStatus): Promise<Order>;
    assignDelivery(payload: AssignDeliveryPayload): Promise<Route>;
    assignDeliveryManual(payload: ManualAssignDeliveryPayload): Promise<Route>;
    getDeliveryByOrder(orderId: string): Promise<Route>;
    getCourierActiveDeliveries(courierId: string): Promise<Route[]>;
    getActiveDeliveries(): Promise<Route[]>;
    getCouriers(): Promise<Courier[]>;
    getDeliveryStats(): Promise<DeliveryStats>;
    updateDeliveryStatus(orderId: string, status: DeliveryStatus): Promise<Route>;
    private request;
}
export declare function createFoodoClient(config: FoodoClientConfig): FoodoClient;
