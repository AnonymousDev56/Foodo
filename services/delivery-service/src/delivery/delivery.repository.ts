import type { DatabaseClient } from "@foodo/shared-db";
import { randomUUID } from "node:crypto";
import type { Courier } from "./models/courier.model";
import type { DeliveryRoute, DeliveryStatus } from "./models/delivery-route.model";

interface CourierRow {
  id: string;
  email: string;
  name: string;
  lat: number;
  lng: number;
  isAvailable: boolean;
  etaBiasFactor: number;
  etaReliabilityScore: number;
  completedDeliveries: number;
  activeCount: number;
  completedCount: number;
}

interface RouteRow {
  id: string;
  orderId: string;
  userId: string;
  courierId: string;
  courierName: string;
  address: string;
  lat: number;
  lng: number;
  etaMinutes: number;
  etaLowerMinutes: number;
  etaUpperMinutes: number;
  etaConfidenceScore: number;
  routeSequence: number;
  routeTotalTimeMinutes: number;
  routeDistanceKm: number;
  status: DeliveryStatus;
  total: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  completedAt: string | Date | null;
}

interface RouteItemRow {
  orderId: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

function toIso(value: string | Date | null | undefined) {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class DeliveryRepository {
  constructor(private readonly db: DatabaseClient) {}

  async getRouteByOrder(orderId: string) {
    const routes = await this.loadRoutes("WHERE dr.order_id = $1", [orderId]);
    return routes[0] ?? null;
  }

  async getRoutes(options?: { courierId?: string; activeOnly?: boolean }) {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options?.courierId) {
      params.push(options.courierId);
      where.push(`dr.courier_id = $${params.length}`);
    }

    if (options?.activeOnly) {
      where.push(`dr.status <> 'done'`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return this.loadRoutes(whereSql, params);
  }

  async listCouriersWithCounts() {
    const result = await this.db.query<CourierRow>(
      `SELECT
         c.id,
         c.email,
         c.name,
         c.lat,
         c.lng,
         c.is_available AS "isAvailable",
         c.eta_bias_factor::float8 AS "etaBiasFactor",
         c.eta_reliability_score::float8 AS "etaReliabilityScore",
         c.completed_deliveries::int AS "completedDeliveries",
         COUNT(dr.id) FILTER (WHERE dr.status <> 'done')::int AS "activeCount",
         COUNT(dr.id) FILTER (WHERE dr.status = 'done')::int AS "completedCount"
       FROM couriers c
       LEFT JOIN delivery_routes dr ON dr.courier_id = c.id
       GROUP BY c.id
       ORDER BY c.name ASC`
    );

    return result.rows.map((row) => ({
      courier: {
        id: row.id,
        email: row.email,
        name: row.name,
        lat: Number(row.lat),
        lng: Number(row.lng),
        isAvailable: Boolean(row.isAvailable),
        etaBiasFactor: Number(row.etaBiasFactor ?? 1),
        etaReliabilityScore: Number(row.etaReliabilityScore ?? 80),
        completedDeliveries: Number(row.completedDeliveries ?? 0)
      } satisfies Courier,
      activeCount: Number(row.activeCount),
      completedCount: Number(row.completedCount)
    }));
  }

  async getCourierById(courierId: string) {
    const rows = await this.listCouriersWithCounts();
    return rows.find((row) => row.courier.id === courierId) ?? null;
  }

  async setCourierAvailability(courierId: string, isAvailable: boolean) {
    await this.db.query(
      `UPDATE couriers
       SET is_available = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [courierId, isAvailable]
    );
  }

  async updateCourierPosition(courierId: string, lat: number, lng: number) {
    await this.db.query(
      `UPDATE couriers\n       SET lat = $2,\n           lng = $3,\n           updated_at = NOW()\n       WHERE id = $1`,
      [courierId, lat, lng]
    );
  }

  async createRoute(input: {
    orderId: string;
    userId: string;
    courierId: string;
    courierName: string;
    address: string;
    lat: number;
    lng: number;
    etaMinutes: number;
    etaLowerMinutes: number;
    etaUpperMinutes: number;
    etaConfidenceScore: number;
    routeSequence: number;
    routeTotalTimeMinutes: number;
    routeDistanceKm: number;
    status: DeliveryStatus;
    total: number;
    createdAt: string;
    updatedAt: string;
  }) {
    await this.db.query(
      `INSERT INTO delivery_routes (
         id,
         order_id,
         user_id,
         courier_id,
         courier_name,
         address,
         lat,
         lng,
         eta_minutes,
         eta_lower_minutes,
         eta_upper_minutes,
         eta_confidence_score,
         route_sequence,
         route_total_time_minutes,
         route_distance_km,
         status,
         total,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::timestamptz, $19::timestamptz)`,
      [
        randomUUID(),
        input.orderId,
        input.userId,
        input.courierId,
        input.courierName,
        input.address,
        input.lat,
        input.lng,
        input.etaMinutes,
        input.etaLowerMinutes,
        input.etaUpperMinutes,
        input.etaConfidenceScore,
        input.routeSequence,
        input.routeTotalTimeMinutes,
        input.routeDistanceKm,
        input.status,
        input.total,
        input.createdAt,
        input.updatedAt
      ]
    );

    return this.getRouteByOrder(input.orderId);
  }

  async reassignRoute(
    orderId: string,
    input: {
      courierId: string;
      courierName: string;
      etaMinutes: number;
      etaLowerMinutes: number;
      etaUpperMinutes: number;
      etaConfidenceScore: number;
      routeSequence: number;
      routeTotalTimeMinutes: number;
      routeDistanceKm: number;
      updatedAt: string;
    }
  ) {
    await this.db.query(
      `UPDATE delivery_routes
       SET courier_id = $2,
           courier_name = $3,
           eta_minutes = $4,
           eta_lower_minutes = $5,
           eta_upper_minutes = $6,
           eta_confidence_score = $7,
           route_sequence = $8,
           route_total_time_minutes = $9,
           route_distance_km = $10,
           updated_at = $11::timestamptz
       WHERE order_id = $1`,
      [
        orderId,
        input.courierId,
        input.courierName,
        input.etaMinutes,
        input.etaLowerMinutes,
        input.etaUpperMinutes,
        input.etaConfidenceScore,
        input.routeSequence,
        input.routeTotalTimeMinutes,
        input.routeDistanceKm,
        input.updatedAt
      ]
    );

    return this.getRouteByOrder(orderId);
  }

  async applyRouteOptimization(
    courierId: string,
    updates: Array<{
      orderId: string;
      etaMinutes: number;
      etaLowerMinutes: number;
      etaUpperMinutes: number;
      etaConfidenceScore: number;
      routeSequence: number;
      routeTotalTimeMinutes: number;
      routeDistanceKm: number;
    }>,
    updatedAt: string
  ) {
    if (!updates.length) {
      return this.getRoutes({ courierId, activeOnly: true });
    }

    await this.db.transaction(async (tx) => {
      for (const update of updates) {
        await tx.query(
          `UPDATE delivery_routes
           SET eta_minutes = $2,
               eta_lower_minutes = $3,
               eta_upper_minutes = $4,
               eta_confidence_score = $5,
               route_sequence = $6,
               route_total_time_minutes = $7,
               route_distance_km = $8,
               updated_at = $9::timestamptz
           WHERE order_id = $1`,
          [
            update.orderId,
            update.etaMinutes,
            update.etaLowerMinutes,
            update.etaUpperMinutes,
            update.etaConfidenceScore,
            update.routeSequence,
            update.routeTotalTimeMinutes,
            update.routeDistanceKm,
            updatedAt
          ]
        );
      }
    });

    return this.getRoutes({ courierId, activeOnly: true });
  }

  async updateRouteStatus(orderId: string, status: DeliveryStatus, updatedAt: string, completedAt?: string) {
    await this.db.query(
      `UPDATE delivery_routes
       SET status = $2,
           updated_at = $3::timestamptz,
           completed_at = $4::timestamptz
       WHERE order_id = $1`,
      [orderId, status, updatedAt, completedAt ?? null]
    );

    return this.getRouteByOrder(orderId);
  }

  async refreshCourierCalibration(courierId: string) {
    const result = await this.db.query<{
      completedCount: number;
      biasFactor: number;
      reliabilityScore: number;
    }>(
       `WITH recent_routes AS (
          SELECT
            eta_minutes::float8 AS predicted_minutes,
            EXTRACT(EPOCH FROM (completed_at - created_at)) / 60.0 AS actual_minutes
          FROM delivery_routes
         WHERE courier_id = $1
           AND status = 'done'
           AND completed_at IS NOT NULL
         ORDER BY completed_at DESC
         LIMIT 80
       ),
       metrics AS (
         SELECT
           COUNT(*)::int AS completed_count,
           COALESCE(
             AVG(
               CASE
                 WHEN predicted_minutes > 0 THEN actual_minutes / predicted_minutes
                 ELSE 1
               END
             ),
             1
           )::float8 AS bias_factor,
           COALESCE(
             100 - AVG(
               ABS(actual_minutes - predicted_minutes) / GREATEST(actual_minutes, 1) * 100
             ),
             80
           )::float8 AS reliability_score
         FROM recent_routes
       )
       SELECT
         completed_count AS "completedCount",
         GREATEST(0.75, LEAST(1.45, bias_factor))::float8 AS "biasFactor",
         GREATEST(35, LEAST(99, reliability_score))::float8 AS "reliabilityScore"
       FROM metrics`,
      [courierId]
    );

    const row = result.rows[0];
    const completedCount = Number(row?.completedCount ?? 0);
    const biasFactor = Number(row?.biasFactor ?? 1);
    const reliabilityScore = Number(row?.reliabilityScore ?? 80);

    await this.db.query(
      `UPDATE couriers
       SET eta_bias_factor = $2,
           eta_reliability_score = $3,
           completed_deliveries = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [courierId, biasFactor, reliabilityScore, completedCount]
    );

    return {
      completedCount,
      biasFactor,
      reliabilityScore
    };
  }

  private async loadRoutes(whereSql: string, params: Array<string | number>) {
    const routesResult = await this.db.query<RouteRow>(
      `SELECT
         dr.id,
         dr.order_id AS "orderId",
         dr.user_id AS "userId",
         dr.courier_id AS "courierId",
         dr.courier_name AS "courierName",
         dr.address,
         dr.lat,
         dr.lng,
         dr.eta_minutes AS "etaMinutes",
         dr.eta_lower_minutes AS "etaLowerMinutes",
         dr.eta_upper_minutes AS "etaUpperMinutes",
         dr.eta_confidence_score::float8 AS "etaConfidenceScore",
         dr.route_sequence AS "routeSequence",
         dr.route_total_time_minutes AS "routeTotalTimeMinutes",
         dr.route_distance_km::float8 AS "routeDistanceKm",
         dr.status,
         dr.total::float8 AS total,
         dr.created_at AS "createdAt",
         dr.updated_at AS "updatedAt",
         dr.completed_at AS "completedAt"
       FROM delivery_routes dr
       ${whereSql}
       ORDER BY dr.created_at DESC`,
      params
    );

    if (!routesResult.rows.length) {
      return [];
    }

    const orderIds = routesResult.rows.map((row) => row.orderId);
    const itemsResult = await this.db.query<RouteItemRow>(
      `SELECT
         oi.order_id AS "orderId",
         oi.product_id AS "productId",
         oi.name,
         oi.price::float8 AS price,
         oi.quantity
       FROM order_items oi
       WHERE oi.order_id = ANY($1::text[])
       ORDER BY oi.order_id ASC`,
      [orderIds]
    );

    const itemsByOrder = new Map<string, DeliveryRoute["items"]>();
    for (const row of itemsResult.rows) {
      if (!itemsByOrder.has(row.orderId)) {
        itemsByOrder.set(row.orderId, []);
      }
      itemsByOrder.get(row.orderId)!.push({
        productId: row.productId,
        name: row.name,
        price: Number(row.price),
        quantity: Number(row.quantity)
      });
    }

    return routesResult.rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      userId: row.userId,
      courierId: row.courierId,
      courierName: row.courierName,
      address: row.address,
      lat: Number(row.lat),
      lng: Number(row.lng),
      etaMinutes: Number(row.etaMinutes),
      etaLowerMinutes: Number(row.etaLowerMinutes),
      etaUpperMinutes: Number(row.etaUpperMinutes),
      etaConfidenceScore: Number(row.etaConfidenceScore),
      routeSequence: Number(row.routeSequence),
      routeTotalTimeMinutes: Number(row.routeTotalTimeMinutes),
      routeDistanceKm: Number(row.routeDistanceKm),
      status: row.status,
      total: Number(row.total),
      items: itemsByOrder.get(row.orderId) ?? [],
      createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
      updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
      completedAt: toIso(row.completedAt)
    }));
  }
}
