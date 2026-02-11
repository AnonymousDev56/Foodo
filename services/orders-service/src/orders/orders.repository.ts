import type { DatabaseClient, DbExecutor } from "@foodo/shared-db";
import { randomUUID } from "node:crypto";
import type { UpdateDeliverySnapshotDto } from "./dto/update-delivery-snapshot.dto";
import type { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import type { OrderRecord } from "./orders.service";

type OrderStatus = UpdateOrderStatusDto["status"];

export interface AdminOrderFilters {
  status?: OrderStatus;
  dateFrom?: string;
  dateTo?: string;
  minTotal?: number;
  maxTotal?: number;
}

export interface CreateOrderInput {
  id: string;
  userId: string;
  status: OrderStatus;
  address: string;
  lat: number;
  lng: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
    lineTotal: number;
  }>;
}

export interface RecommendationFactRow {
  orderId: string;
  userId: string;
  productId: string;
  name: string;
  quantity: number;
}

interface OrderRow {
  id: string;
  userId: string;
  status: OrderStatus;
  address: string;
  lat: number;
  lng: number;
  total: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  deliveryCourierId: string | null;
  deliveryCourierName: string | null;
  deliveryAddress: string | null;
  deliveryEtaMinutes: number | null;
  deliveryEtaLowerMinutes: number | null;
  deliveryEtaUpperMinutes: number | null;
  deliveryEtaConfidenceScore: number | null;
  deliveryStatus: "assigned" | "cooking" | "delivery" | "done" | null;
  deliveryUpdatedAt: string | Date | null;
}

interface OrderItemRow {
  orderId: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  lineTotal: number;
}

function toIso(value: string | Date | null | undefined) {
  if (!value) {
    return "";
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class OrdersRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createOrder(input: CreateOrderInput) {
    await this.db.transaction(async (tx) => {
      await this.insertOrder(tx, input);
      await this.insertOrderItems(tx, input);
    });

    return this.getOrderById(input.id);
  }

  async getOrderById(id: string) {
    const rows = await this.loadOrders("WHERE o.id = $1", [id]);
    return rows[0] ?? null;
  }

  async listOrders(options?: { userId?: string; filters?: AdminOrderFilters }) {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options?.userId) {
      params.push(options.userId);
      where.push(`o.user_id = $${params.length}`);
    }

    if (options?.filters?.status) {
      params.push(options.filters.status);
      where.push(`o.status = $${params.length}`);
    }

    if (options?.filters?.dateFrom) {
      params.push(options.filters.dateFrom);
      where.push(`o.created_at >= $${params.length}::timestamptz`);
    }

    if (options?.filters?.dateTo) {
      params.push(options.filters.dateTo);
      where.push(`o.created_at <= $${params.length}::timestamptz`);
    }

    if (typeof options?.filters?.minTotal === "number") {
      params.push(options.filters.minTotal);
      where.push(`o.total >= $${params.length}`);
    }

    if (typeof options?.filters?.maxTotal === "number") {
      params.push(options.filters.maxTotal);
      where.push(`o.total <= $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.loadOrders(whereSql, params);
  }

  async updateOrderStatus(orderId: string, status: OrderStatus, updatedAt: string) {
    const result = await this.db.query<{ id: string }>(
      `UPDATE orders
       SET status = $2,
           updated_at = $3::timestamptz,
           delivery_status = CASE
             WHEN delivery_courier_id IS NOT NULL AND $2 <> 'pending' THEN $2
             ELSE delivery_status
           END,
           delivery_updated_at = CASE
             WHEN delivery_courier_id IS NOT NULL AND $2 <> 'pending' THEN $3::timestamptz
             ELSE delivery_updated_at
           END
       WHERE id = $1
       RETURNING id`,
      [orderId, status, updatedAt]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getOrderById(orderId);
  }

  async applyDeliverySnapshot(
    orderId: string,
    payload: UpdateDeliverySnapshotDto,
    nextOrderStatus: OrderStatus | null,
    orderUpdatedAt: string
  ) {
    const result = await this.db.query<{ id: string }>(
      `UPDATE orders
       SET delivery_courier_id = $2,
           delivery_courier_name = $3,
           delivery_address = $4,
           delivery_eta_minutes = $5,
           delivery_eta_lower_minutes = $6,
           delivery_eta_upper_minutes = $7,
           delivery_eta_confidence_score = $8,
           delivery_status = $9,
           delivery_updated_at = $10::timestamptz,
           status = COALESCE($11, status),
           updated_at = $12::timestamptz
       WHERE id = $1
       RETURNING id`,
      [
        orderId,
        payload.courierId,
        payload.courierName,
        payload.address,
        payload.etaMinutes,
        payload.etaLowerMinutes ?? null,
        payload.etaUpperMinutes ?? null,
        payload.etaConfidenceScore ?? null,
        payload.status,
        payload.updatedAt,
        nextOrderStatus,
        orderUpdatedAt
      ]
    );

    if (!result.rows[0]) {
      return null;
    }

    return this.getOrderById(orderId);
  }

  async getRecommendationFacts() {
    const result = await this.db.query<RecommendationFactRow>(
      `SELECT
         oi.order_id AS "orderId",
         o.user_id AS "userId",
         oi.product_id AS "productId",
         oi.name,
         oi.quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id`
    );

    return result.rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity)
    }));
  }

  private async loadOrders(whereSql: string, params: Array<string | number>) {
    const ordersResult = await this.db.query<OrderRow>(
      `SELECT
         o.id,
         o.user_id AS "userId",
         o.status,
         o.address,
         o.lat,
         o.lng,
         o.total::float8 AS total,
         o.created_at AS "createdAt",
         o.updated_at AS "updatedAt",
         o.delivery_courier_id AS "deliveryCourierId",
         o.delivery_courier_name AS "deliveryCourierName",
         o.delivery_address AS "deliveryAddress",
         o.delivery_eta_minutes AS "deliveryEtaMinutes",
         o.delivery_eta_lower_minutes AS "deliveryEtaLowerMinutes",
         o.delivery_eta_upper_minutes AS "deliveryEtaUpperMinutes",
         o.delivery_eta_confidence_score::float8 AS "deliveryEtaConfidenceScore",
         o.delivery_status AS "deliveryStatus",
         o.delivery_updated_at AS "deliveryUpdatedAt"
       FROM orders o
       ${whereSql}
       ORDER BY o.created_at DESC`,
      params
    );

    if (!ordersResult.rows.length) {
      return [];
    }

    const orderIds = ordersResult.rows.map((row) => row.id);
    const itemsResult = await this.db.query<OrderItemRow>(
      `SELECT
         oi.order_id AS "orderId",
         oi.product_id AS "productId",
         oi.name,
         oi.price::float8 AS price,
         oi.quantity,
         oi.line_total::float8 AS "lineTotal"
       FROM order_items oi
       WHERE oi.order_id = ANY($1::text[])
       ORDER BY oi.order_id ASC`,
      [orderIds]
    );

    const itemsByOrder = new Map<string, OrderRecord["items"]>();
    for (const row of itemsResult.rows) {
      if (!itemsByOrder.has(row.orderId)) {
        itemsByOrder.set(row.orderId, []);
      }
      itemsByOrder.get(row.orderId)!.push({
        productId: row.productId,
        name: row.name,
        price: Number(row.price),
        quantity: Number(row.quantity),
        lineTotal: Number(row.lineTotal)
      });
    }

    return ordersResult.rows.map((row) => {
      const delivery = row.deliveryCourierId
        ? {
            courierId: row.deliveryCourierId,
            courierName: row.deliveryCourierName ?? "",
            address: row.deliveryAddress ?? "",
            etaMinutes: Number(row.deliveryEtaMinutes ?? 0),
            etaLowerMinutes: row.deliveryEtaLowerMinutes
              ? Number(row.deliveryEtaLowerMinutes)
              : undefined,
            etaUpperMinutes: row.deliveryEtaUpperMinutes
              ? Number(row.deliveryEtaUpperMinutes)
              : undefined,
            etaConfidenceScore:
              row.deliveryEtaConfidenceScore !== null
                ? Number(row.deliveryEtaConfidenceScore)
                : undefined,
            status: row.deliveryStatus ?? "assigned",
            updatedAt: toIso(row.deliveryUpdatedAt)
          }
        : undefined;

      return {
        id: row.id,
        userId: row.userId,
        status: row.status,
        address: row.address,
        lat: Number(row.lat),
        lng: Number(row.lng),
        total: Number(row.total),
        items: itemsByOrder.get(row.id) ?? [],
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
        delivery
      } as OrderRecord;
    });
  }

  private async insertOrder(executor: DbExecutor, input: CreateOrderInput) {
    await executor.query(
      `INSERT INTO orders (id, user_id, status, address, lat, lng, total, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)`,
      [
        input.id,
        input.userId,
        input.status,
        input.address,
        input.lat,
        input.lng,
        input.total,
        input.createdAt,
        input.updatedAt
      ]
    );
  }

  private async insertOrderItems(executor: DbExecutor, input: CreateOrderInput) {
    for (const item of input.items) {
      await executor.query(
        `INSERT INTO order_items (id, order_id, product_id, name, price, quantity, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), input.id, item.productId, item.name, item.price, item.quantity, item.lineTotal]
      );
    }
  }
}
