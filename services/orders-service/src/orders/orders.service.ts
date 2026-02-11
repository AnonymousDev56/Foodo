import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException
} from "@nestjs/common";
import { createDatabaseClient } from "@foodo/shared-db";
import amqplib, {
  type Channel,
  type ChannelModel,
  type ConsumeMessage
} from "amqplib";
import { randomUUID } from "node:crypto";
import {
  CreateOrderDto,
  type CreateOrderItemDto
} from "./dto/create-order.dto";
import type { UpdateDeliverySnapshotDto } from "./dto/update-delivery-snapshot.dto";
import type { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { DashboardMetricsService } from "./dashboard-metrics.service";
import {
  OrdersRepository,
  type AdminOrderFilters,
  type RecommendationFactRow
} from "./orders.repository";

type OrderStatus = UpdateOrderStatusDto["status"];
type DeliveryStatus = "assigned" | "cooking" | "delivery" | "done";

interface AuthPayload {
  sub: string;
  role?: string;
}

interface MockLocation {
  address: string;
  lat: number;
  lng: number;
}

interface OrderAssignedEvent {
  orderId: string;
  courierId: string;
  courierName: string;
  address: string;
  etaMinutes: number;
  etaLowerMinutes?: number;
  etaUpperMinutes?: number;
  etaConfidenceScore?: number;
  status: DeliveryStatus;
  updatedAt: string;
}

interface DeliveryUpdatedEvent {
  orderId: string;
  courierId: string;
  courierName: string;
  address: string;
  etaMinutes: number;
  etaLowerMinutes?: number;
  etaUpperMinutes?: number;
  etaConfidenceScore?: number;
  status: DeliveryStatus;
  updatedAt: string;
}

interface RecommendationsQuery {
  productId?: string;
  viewedProductIds?: string[];
  limit?: number;
  weights?: Partial<RecommendationWeights>;
}

type RecommendationReason = "history" | "together" | "popular";

interface RecommendationWeights {
  history: number;
  together: number;
  popular: number;
}

interface WarehouseProduct {
  id: string;
  name: string;
  price: number;
  category: string;
  stock: number;
  imageUrl?: string;
}

interface RecommendationOrderGroup {
  userId: string;
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
  }>;
}

export interface RecommendedProduct extends WarehouseProduct {
  score: number;
  reason: RecommendationReason;
}

export type OrderUpdatedListener = (order: OrderRecord) => void;

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://foodo:foodo@localhost:5672";
const EVENTS_EXCHANGE = "foodo.events";
const ORDERS_QUEUE = "orders-service.events";
const DELIVERY_API_URL = process.env.DELIVERY_API_URL ?? "http://localhost:3004";
const WAREHOUSE_API_URL = process.env.WAREHOUSE_API_URL ?? "http://localhost:3003";
const parsedHistoryWeight = Number(process.env.RECOMMEND_WEIGHT_HISTORY ?? 2);
const parsedTogetherWeight = Number(process.env.RECOMMEND_WEIGHT_TOGETHER ?? 4);
const parsedPopularWeight = Number(process.env.RECOMMEND_WEIGHT_POPULAR ?? 1);
const RECOMMENDATION_DEFAULT_WEIGHTS: RecommendationWeights = {
  history: Number.isFinite(parsedHistoryWeight) ? parsedHistoryWeight : 2,
  together: Number.isFinite(parsedTogetherWeight) ? parsedTogetherWeight : 4,
  popular: Number.isFinite(parsedPopularWeight) ? parsedPopularWeight : 1
};
const EVENTS = {
  ORDER_CREATED: "order.created",
  ORDER_ASSIGNED: "order.assigned",
  ORDER_ASSIGNED_MANUAL: "order.assigned.manual",
  ORDER_DONE: "order.done",
  DELIVERY_UPDATED: "delivery.updated"
} as const;

const MOCK_LOCATIONS: MockLocation[] = [
  {
    address: "221B Baker Street, London",
    lat: 40.7282,
    lng: -73.7949
  },
  {
    address: "742 Evergreen Terrace, Springfield",
    lat: 40.706,
    lng: -73.9969
  },
  {
    address: "12 Grimmauld Place, London",
    lat: 40.7484,
    lng: -73.9857
  },
  {
    address: "31 Spooner Street, Quahog",
    lat: 40.73,
    lng: -74.08
  }
];

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
  address: string;
  lat: number;
  lng: number;
  items: OrderItem[];
  total: number;
  createdAt: string;
  updatedAt: string;
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

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersService.name);
  private readonly db = createDatabaseClient("orders-service");
  private readonly repository = new OrdersRepository(this.db);
  private rabbitConnection: ChannelModel | null = null;
  private rabbitChannel: Channel | null = null;
  private readonly orderUpdatedListeners = new Set<OrderUpdatedListener>();

  private readonly allowedTransitions: Record<OrderStatus, OrderStatus | null> = {
    pending: "cooking",
    cooking: "delivery",
    delivery: "done",
    done: null
  };

  constructor(
    @Inject(DashboardMetricsService)
    private readonly dashboardMetricsService: DashboardMetricsService
  ) {}

  async onModuleInit() {
    await this.db.init();
    await this.initRabbitMq();
  }

  async onModuleDestroy() {
    await this.rabbitChannel?.close().catch(() => undefined);
    await this.rabbitConnection?.close().catch(() => undefined);
    await this.db.close();
  }

  async create(dto: CreateOrderDto, authorization?: string) {
    const userId = this.extractUserId(authorization);

    if (!dto.items.length) {
      throw new BadRequestException("Order must contain at least one item");
    }

    await this.decrementWarehouseStock(dto.items);

    const location = this.pickMockLocation();
    const items = dto.items.map((item) => this.toOrderItem(item));
    const total = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const now = new Date().toISOString();

    const created = await this.repository.createOrder({
      id: randomUUID(),
      userId,
      status: "pending",
      address: location.address,
      lat: location.lat,
      lng: location.lng,
      items,
      total: Number(total.toFixed(2)),
      createdAt: now,
      updatedAt: now
    });

    if (!created) {
      throw new BadRequestException("Failed to create order");
    }

    this.emitOrderUpdated(created);

    const published = await this.publishEvent(EVENTS.ORDER_CREATED, {
      orderId: created.id,
      userId: created.userId,
      address: created.address,
      lat: created.lat,
      lng: created.lng,
      total: created.total,
      items: created.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity
      }))
    });

    if (!published) {
      await this.fallbackAssign(created);
    }

    return created;
  }

  async myOrders(authorization?: string) {
    const auth = this.extractAuthPayload(authorization);

    if (auth.role === "Admin") {
      return this.repository.listOrders();
    }

    return this.repository.listOrders({ userId: auth.sub });
  }

  async getById(id: string, authorization?: string) {
    const auth = this.extractAuthPayload(authorization);
    const order = await this.repository.getOrderById(id);

    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (auth.role !== "Admin" && order.userId !== auth.sub) {
      throw new NotFoundException("Order not found");
    }

    return order;
  }

  async adminOrders(filters: AdminOrderFilters, authorization?: string) {
    this.requireAdmin(authorization);
    return this.repository.listOrders({ filters });
  }

  async adminDashboardMetrics(authorization?: string) {
    this.requireAdmin(authorization);
    return this.dashboardMetricsService.getMetrics();
  }

  async getRecommendations(query: RecommendationsQuery, authorization?: string) {
    const auth = this.extractAuthPayload(authorization);
    const limit = this.normalizeLimit(query.limit);
    const weights = this.normalizeRecommendationWeights(query.weights);
    const catalog = await this.fetchWarehouseProducts();
    const facts = await this.repository.getRecommendationFacts();
    const orderGroups = this.buildOrderGroups(facts);
    const popularRawScores = this.buildPopularityScores(orderGroups);

    const buildCatalogRecommendations = () =>
      catalog
        .slice()
        .sort((a, b) => {
          if (b.stock !== a.stock) {
            return b.stock - a.stock;
          }
          return a.price - b.price;
        })
        .slice(0, limit)
        .map((product, index): RecommendedProduct => ({
          ...product,
          score: Number((Math.max(1, limit - index) * weights.popular).toFixed(2)),
          reason: "popular"
        }));

    if (!orderGroups.length) {
      return buildCatalogRecommendations();
    }

    const togetherRawScores = new Map<string, number>();
    const historyRawScores = new Map<string, number>();
    const seedProductIds = this.buildSeedProductIds(query.productId, query.viewedProductIds);
    const seedProductIdSet = new Set(seedProductIds);

    if (seedProductIds.length > 0) {
      this.accumulateTogetherScores(orderGroups, seedProductIds, togetherRawScores);
    }

    this.accumulateUserHistoryScores(orderGroups, auth.sub, historyRawScores);

    const allProductIds = new Set<string>([
      ...popularRawScores.keys(),
      ...historyRawScores.keys(),
      ...togetherRawScores.keys()
    ]);

    for (const productId of seedProductIdSet) {
      allProductIds.delete(productId);
    }

    const rankedScores = [...allProductIds].map((productId) => {
      const weightedHistory = (historyRawScores.get(productId) ?? 0) * weights.history;
      const weightedTogether = (togetherRawScores.get(productId) ?? 0) * weights.together;
      const weightedPopular = (popularRawScores.get(productId) ?? 0) * weights.popular;

      return {
        productId,
        totalScore: Number((weightedHistory + weightedTogether + weightedPopular).toFixed(4)),
        reason: this.selectDominantReason({
          history: weightedHistory,
          together: weightedTogether,
          popular: weightedPopular
        })
      };
    });

    const rankedIds = rankedScores
      .filter((item) => item.totalScore > 0)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit)
      .map((item) => item.productId);

    if (!rankedIds.length) {
      return buildCatalogRecommendations();
    }

    const catalogById = new Map(catalog.map((product) => [product.id, product]));
    const nameById = this.buildNameIndex(facts);
    const recommendations: RecommendedProduct[] = [];

    for (const productId of rankedIds) {
      const ranking = rankedScores.find((item) => item.productId === productId);
      const catalogProduct = catalogById.get(productId);
      if (catalogProduct) {
        recommendations.push({
          ...catalogProduct,
          score: Number((ranking?.totalScore ?? 1).toFixed(2)),
          reason: ranking?.reason ?? "popular"
        });
        continue;
      }

      const fallbackName = nameById.get(productId) ?? "Product";
      recommendations.push({
        id: productId,
        name: fallbackName,
        category: "Recommended",
        stock: 0,
        price: 0,
        imageUrl: undefined,
        score: Number((ranking?.totalScore ?? 1).toFixed(2)),
        reason: ranking?.reason ?? "popular"
      });
    }

    return recommendations;
  }

  async updateStatus(id: string, status: OrderStatus) {
    const order = await this.repository.getOrderById(id);
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const expectedNext = this.allowedTransitions[order.status];
    if (order.status === status) {
      return order;
    }
    if (!expectedNext || status !== expectedNext) {
      throw new BadRequestException(
        `Invalid transition: ${order.status} -> ${status}. Allowed next: ${expectedNext ?? "none"}`
      );
    }

    const updatedAt = new Date().toISOString();
    const updated = await this.repository.updateOrderStatus(id, status, updatedAt);
    if (!updated) {
      throw new NotFoundException("Order not found");
    }

    if (status === "done") {
      await this.publishEvent(EVENTS.ORDER_DONE, {
        orderId: updated.id,
        userId: updated.userId,
        total: updated.total,
        updatedAt: updated.updatedAt
      });
    }

    this.emitOrderUpdated(updated);
    return updated;
  }

  async updateStatusByAdmin(id: string, status: OrderStatus, authorization?: string) {
    this.requireAdmin(authorization);

    const order = await this.repository.getOrderById(id);
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    if (order.status === status) {
      return order;
    }

    const updatedAt = new Date().toISOString();
    const updated = await this.repository.updateOrderStatus(id, status, updatedAt);
    if (!updated) {
      throw new NotFoundException("Order not found");
    }

    if (status === "done") {
      await this.publishEvent(EVENTS.ORDER_DONE, {
        orderId: updated.id,
        userId: updated.userId,
        total: updated.total,
        updatedAt: updated.updatedAt
      });
    }

    await this.syncDeliveryStatusByAdmin(updated.id, status);
    this.emitOrderUpdated(updated);

    return updated;
  }

  async syncDeliverySnapshot(id: string, payload: UpdateDeliverySnapshotDto) {
    const order = await this.repository.getOrderById(id);
    if (!order) {
      throw new NotFoundException("Order not found");
    }

    const updated = await this.applyDeliverySnapshot(order, {
      orderId: id,
      ...payload
    });

    if (!updated) {
      throw new NotFoundException("Order not found");
    }

    return updated;
  }

  onOrderUpdated(listener: OrderUpdatedListener) {
    this.orderUpdatedListeners.add(listener);
    return () => {
      this.orderUpdatedListeners.delete(listener);
    };
  }

  private toOrderItem(item: CreateOrderItemDto): OrderItem {
    return {
      productId: item.productId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      lineTotal: Number((item.price * item.quantity).toFixed(2))
    };
  }

  private pickMockLocation() {
    return MOCK_LOCATIONS[Math.floor(Math.random() * MOCK_LOCATIONS.length)];
  }

  private normalizeLimit(limit?: number) {
    if (typeof limit !== "number" || Number.isNaN(limit)) {
      return 4;
    }
    return Math.min(10, Math.max(1, Math.floor(limit)));
  }

  private normalizeRecommendationWeights(weights?: Partial<RecommendationWeights>): RecommendationWeights {
    const normalize = (value: number | undefined, fallback: number) => {
      if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
        return fallback;
      }
      return Number(value.toFixed(3));
    };

    return {
      history: normalize(weights?.history, RECOMMENDATION_DEFAULT_WEIGHTS.history),
      together: normalize(weights?.together, RECOMMENDATION_DEFAULT_WEIGHTS.together),
      popular: normalize(weights?.popular, RECOMMENDATION_DEFAULT_WEIGHTS.popular)
    };
  }

  private buildSeedProductIds(productId?: string, viewedProductIds?: string[]) {
    const result = new Set<string>();
    if (productId) {
      result.add(productId);
    }
    if (Array.isArray(viewedProductIds)) {
      for (const id of viewedProductIds) {
        if (typeof id === "string" && id.trim().length > 0) {
          result.add(id.trim());
        }
      }
    }
    return [...result];
  }

  private buildOrderGroups(facts: RecommendationFactRow[]) {
    const byOrder = new Map<string, RecommendationOrderGroup>();
    for (const fact of facts) {
      if (!byOrder.has(fact.orderId)) {
        byOrder.set(fact.orderId, { userId: fact.userId, items: [] });
      }
      byOrder.get(fact.orderId)!.items.push({
        productId: fact.productId,
        name: fact.name,
        quantity: Number(fact.quantity)
      });
    }

    return [...byOrder.values()];
  }

  private accumulateTogetherScores(
    groups: RecommendationOrderGroup[],
    seedProductIds: string[],
    scoreByProductId: Map<string, number>
  ) {
    const seedSet = new Set(seedProductIds);
    for (const group of groups) {
      const matchedSeedCount = group.items.filter((item) => seedSet.has(item.productId)).length;
      if (!matchedSeedCount) {
        continue;
      }

      for (const item of group.items) {
        if (seedSet.has(item.productId)) {
          continue;
        }
        const increment = item.quantity * matchedSeedCount;
        scoreByProductId.set(
          item.productId,
          (scoreByProductId.get(item.productId) ?? 0) + increment
        );
      }
    }
  }

  private accumulateUserHistoryScores(
    groups: RecommendationOrderGroup[],
    userId: string,
    scoreByProductId: Map<string, number>
  ) {
    for (const group of groups) {
      if (group.userId !== userId) {
        continue;
      }
      for (const item of group.items) {
        scoreByProductId.set(
          item.productId,
          (scoreByProductId.get(item.productId) ?? 0) + item.quantity
        );
      }
    }
  }

  private buildPopularityScores(groups: RecommendationOrderGroup[]) {
    const scores = new Map<string, number>();
    for (const group of groups) {
      for (const item of group.items) {
        scores.set(item.productId, (scores.get(item.productId) ?? 0) + item.quantity);
      }
    }
    return scores;
  }

  private selectDominantReason(weighted: RecommendationWeights): RecommendationReason {
    const entries: Array<{ reason: RecommendationReason; value: number }> = [
      { reason: "history", value: weighted.history },
      { reason: "together", value: weighted.together },
      { reason: "popular", value: weighted.popular }
    ];

    entries.sort((a, b) => b.value - a.value);
    if (entries[0].value <= 0) {
      return "popular";
    }
    return entries[0].reason;
  }

  private buildNameIndex(facts: RecommendationFactRow[]) {
    const nameById = new Map<string, string>();
    for (const fact of facts) {
      if (!nameById.has(fact.productId)) {
        nameById.set(fact.productId, fact.name);
      }
    }
    return nameById;
  }

  private async fetchWarehouseProducts() {
    try {
      const response = await fetch(`${WAREHOUSE_API_URL}/products`);
      if (!response.ok) {
        return [];
      }
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        return [];
      }
      return payload.filter((item): item is WarehouseProduct => {
        if (!item || typeof item !== "object") {
          return false;
        }
        const record = item as Record<string, unknown>;
        return (
          typeof record.id === "string" &&
          typeof record.name === "string" &&
          typeof record.price === "number" &&
          typeof record.category === "string" &&
          typeof record.stock === "number"
        );
      });
    } catch (error) {
      this.logger.warn(`Unable to load products for recommendations: ${(error as Error).message}`);
      return [];
    }
  }

  private async applyDeliverySnapshot(
    currentOrder: OrderRecord,
    payload: OrderAssignedEvent | DeliveryUpdatedEvent
  ) {
    const nextOrderStatus = this.resolveOrderStatusFromDelivery(currentOrder.status, payload.status);
    const updated = await this.repository.applyDeliverySnapshot(
      currentOrder.id,
      {
        courierId: payload.courierId,
        courierName: payload.courierName,
        address: payload.address,
        etaMinutes: payload.etaMinutes,
        etaLowerMinutes: payload.etaLowerMinutes,
        etaUpperMinutes: payload.etaUpperMinutes,
        etaConfidenceScore: payload.etaConfidenceScore,
        status: payload.status,
        updatedAt: payload.updatedAt
      },
      nextOrderStatus,
      payload.updatedAt
    );

    if (updated) {
      this.emitOrderUpdated(updated);
    }

    return updated;
  }

  private resolveOrderStatusFromDelivery(
    currentStatus: OrderStatus,
    deliveryStatus: DeliveryStatus
  ): OrderStatus | null {
    if (deliveryStatus === "cooking" && currentStatus === "pending") {
      return "cooking";
    }

    if (deliveryStatus === "delivery" && (currentStatus === "pending" || currentStatus === "cooking")) {
      return "delivery";
    }

    if (deliveryStatus === "done") {
      return "done";
    }

    return null;
  }

  private async fallbackAssign(order: OrderRecord) {
    try {
      const response = await fetch(`${DELIVERY_API_URL}/delivery/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orderId: order.id,
          userId: order.userId,
          address: order.address,
          lat: order.lat,
          lng: order.lng,
          total: order.total,
          items: order.items.map((item) => ({
            productId: item.productId,
            name: item.name,
            price: item.price,
            quantity: item.quantity
          }))
        })
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
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

      await this.applyDeliverySnapshot(order, {
        orderId: order.id,
        courierId: payload.courierId,
        courierName: payload.courierName,
        address: payload.address,
        etaMinutes: payload.etaMinutes,
        etaLowerMinutes: payload.etaLowerMinutes,
        etaUpperMinutes: payload.etaUpperMinutes,
        etaConfidenceScore: payload.etaConfidenceScore,
        status: payload.status,
        updatedAt: payload.updatedAt
      });
    } catch (error) {
      this.logger.warn(`Fallback delivery assignment failed: ${(error as Error).message}`);
    }
  }

  private emitOrderUpdated(order: OrderRecord) {
    this.dashboardMetricsService.invalidate();
    for (const listener of this.orderUpdatedListeners) {
      try {
        listener(order);
      } catch (error) {
        this.logger.warn(`Order update listener failed: ${(error as Error).message}`);
      }
    }
  }

  private async decrementWarehouseStock(items: CreateOrderItemDto[]) {
    try {
      const response = await fetch(`${WAREHOUSE_API_URL}/stock/decrement`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity
          }))
        })
      });

      if (response.ok) {
        return;
      }

      let message = `Warehouse stock update failed (HTTP ${response.status})`;
      try {
        const payload = (await response.json()) as { message?: string | string[] };
        if (Array.isArray(payload.message)) {
          message = payload.message.join(", ");
        } else if (typeof payload.message === "string") {
          message = payload.message;
        }
      } catch {
        // Ignore parsing errors and use fallback message.
      }

      throw new BadRequestException(message);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException("Warehouse service is unavailable");
    }
  }

  private async syncDeliveryStatusByAdmin(orderId: string, status: OrderStatus) {
    if (status === "pending") {
      return;
    }

    try {
      await fetch(`${DELIVERY_API_URL}/delivery/${orderId}/admin-status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync admin delivery status ${orderId} -> ${status}: ${(error as Error).message}`
      );
    }
  }

  private async initRabbitMq() {
    try {
      const connection = await amqplib.connect(RABBITMQ_URL);
      const channel = await connection.createChannel();
      this.rabbitConnection = connection;
      this.rabbitChannel = channel;
      await this.rabbitChannel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: false });
      await this.rabbitChannel.assertQueue(ORDERS_QUEUE, { durable: false });
      await this.rabbitChannel.bindQueue(ORDERS_QUEUE, EVENTS_EXCHANGE, EVENTS.ORDER_ASSIGNED);
      await this.rabbitChannel.bindQueue(ORDERS_QUEUE, EVENTS_EXCHANGE, EVENTS.ORDER_ASSIGNED_MANUAL);
      await this.rabbitChannel.bindQueue(ORDERS_QUEUE, EVENTS_EXCHANGE, EVENTS.DELIVERY_UPDATED);

      await this.rabbitChannel.consume(ORDERS_QUEUE, async (message) => {
        await this.handleEventsMessage(message);
      });

      this.logger.log("RabbitMQ connected for orders-service");
    } catch (error) {
      this.logger.warn(`RabbitMQ disabled for orders-service: ${(error as Error).message}`);
      this.rabbitConnection = null;
      this.rabbitChannel = null;
    }
  }

  private async handleEventsMessage(message: ConsumeMessage | null) {
    if (!message || !this.rabbitChannel) {
      return;
    }

    try {
      const payload = JSON.parse(message.content.toString("utf8")) as Record<string, unknown>;
      const eventName = message.fields.routingKey;
      const orderId = String(payload.orderId ?? "");

      if (!orderId) {
        this.rabbitChannel.ack(message);
        return;
      }

      if (eventName === EVENTS.ORDER_ASSIGNED || eventName === EVENTS.ORDER_ASSIGNED_MANUAL) {
        const currentOrder = await this.repository.getOrderById(orderId);
        if (currentOrder) {
          await this.applyDeliverySnapshot(currentOrder, payload as unknown as OrderAssignedEvent);
        }
      }

      if (eventName === EVENTS.DELIVERY_UPDATED) {
        const currentOrder = await this.repository.getOrderById(orderId);
        if (currentOrder) {
          await this.applyDeliverySnapshot(currentOrder, payload as unknown as DeliveryUpdatedEvent);
        }
      }

      this.rabbitChannel.ack(message);
    } catch (error) {
      this.logger.error(`Failed to process event message: ${(error as Error).message}`);
      this.rabbitChannel.ack(message);
    }
  }

  private async publishEvent(eventName: string, payload: Record<string, unknown>) {
    if (!this.rabbitChannel) {
      return false;
    }
    try {
      this.rabbitChannel.publish(
        EVENTS_EXCHANGE,
        eventName,
        Buffer.from(JSON.stringify(payload))
      );
      return true;
    } catch (error) {
      this.logger.warn(`RabbitMQ publish failed (${eventName}): ${(error as Error).message}`);
      return false;
    }
  }

  private requireAdmin(authorization?: string) {
    const payload = this.extractAuthPayload(authorization);
    if (payload.role !== "Admin") {
      throw new UnauthorizedException("Admin role is required");
    }

    return payload;
  }

  private extractUserId(authorization?: string) {
    return this.extractAuthPayload(authorization).sub;
  }

  private extractAuthPayload(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const [, payloadPart] = token.split(".");
    if (!payloadPart) {
      throw new UnauthorizedException("Invalid token");
    }

    try {
      const payloadJson = Buffer.from(payloadPart, "base64url").toString("utf8");
      const payload = JSON.parse(payloadJson) as AuthPayload;
      if (!payload.sub) {
        throw new UnauthorizedException("Token has no subject");
      }

      return payload;
    } catch {
      throw new UnauthorizedException("Invalid token payload");
    }
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization) {
      return null;
    }

    const [type, token] = authorization.split(" ");
    if (type !== "Bearer" || !token) {
      return null;
    }

    return token;
  }
}
