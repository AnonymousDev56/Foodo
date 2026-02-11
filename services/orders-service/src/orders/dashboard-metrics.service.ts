import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createDatabaseClient } from "@foodo/shared-db";

interface SingleValueRow {
  value: number;
}

interface TopProductRow {
  name: string;
  count: number;
}

interface HourlyRow {
  hour: string;
  orders: number;
  revenue: number;
}

interface AssignmentRow {
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
  status: "assigned" | "cooking" | "delivery" | "done";
}

export interface DashboardTopProduct {
  name: string;
  count: number;
}

export interface DashboardSeriesPoint {
  hour: string;
  value: number;
}

export interface DashboardMetricsSnapshot {
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
    status: "assigned" | "cooking" | "delivery" | "done";
  }>;
  topProducts: DashboardTopProduct[];
  ordersPerHour: DashboardSeriesPoint[];
  revenuePerHour: DashboardSeriesPoint[];
  updatedAt: string;
}

const DEFAULT_TTL_MS = 4_000;
const MIN_TTL_MS = 2_000;
const MAX_TTL_MS = 5_000;

function normalizeTtlMs(raw: string | undefined) {
  const numeric = Number(raw ?? DEFAULT_TTL_MS);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_TTL_MS;
  }

  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.floor(numeric)));
}

@Injectable()
export class DashboardMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly db = createDatabaseClient("orders-service-dashboard");
  private readonly ttlMs = normalizeTtlMs(process.env.DASHBOARD_METRICS_TTL_MS);
  private cache: { expiresAt: number; data: DashboardMetricsSnapshot } | null = null;

  async onModuleInit() {
    await this.db.init();
  }

  async onModuleDestroy() {
    await this.db.close();
  }

  invalidate() {
    // Very short-lived cache. We clear it on every business mutation.
    this.cache = null;
  }

  async getMetrics(options?: { force?: boolean }) {
    const force = options?.force === true;
    const now = Date.now();

    if (!force && this.cache && now < this.cache.expiresAt) {
      return this.cache.data;
    }

    const [
      activeOrdersRow,
      completedTodayRow,
      averageEtaRow,
      activeCouriersRow,
      revenueTodayRow,
      avgRouteLengthRow,
      avgEtaAccuracyRow,
      assignmentsRows,
      topProductsRows,
      hourlyRows
    ] = await Promise.all([
      this.db.query<SingleValueRow>(
        `SELECT COUNT(*)::int AS value
         FROM orders
         WHERE status IN ('pending', 'cooking', 'delivery')`
      ),
      this.db.query<SingleValueRow>(
        `SELECT COUNT(*)::int AS value
         FROM orders
         WHERE status = 'done'
           AND updated_at >= date_trunc('day', NOW())`
      ),
      this.db.query<SingleValueRow>(
        `SELECT COALESCE(ROUND(AVG(eta_minutes)::numeric, 2), 0)::float8 AS value
         FROM delivery_routes
         WHERE status IN ('assigned', 'cooking', 'delivery')`
      ),
      this.db.query<SingleValueRow>(
        `SELECT COUNT(DISTINCT courier_id)::int AS value
         FROM delivery_routes
         WHERE status IN ('assigned', 'cooking', 'delivery')`
      ),
      this.db.query<SingleValueRow>(
        `SELECT COALESCE(ROUND(SUM(total)::numeric, 2), 0)::float8 AS value
         FROM orders
         WHERE status = 'done'
           AND updated_at >= date_trunc('day', NOW())`
      ),
      this.db.query<SingleValueRow>(
        `SELECT COALESCE(ROUND(AVG(route_length)::numeric, 2), 0)::float8 AS value
         FROM (
           SELECT courier_id, MAX(route_distance_km)::float8 AS route_length
           FROM delivery_routes
           WHERE status IN ('assigned', 'cooking', 'delivery')
           GROUP BY courier_id
         ) active_routes`
      ),
      this.db.query<SingleValueRow>(
        `SELECT COALESCE(
            ROUND(
              AVG(
                GREATEST(
                  0,
                  100 - (
                    ABS(actual_minutes - eta_minutes)::numeric
                    / GREATEST(actual_minutes, 1)
                  ) * 100
                )
              )::numeric,
              2
            ),
            0
          )::float8 AS value
         FROM (
           SELECT
             eta_minutes::float8 AS eta_minutes,
             EXTRACT(EPOCH FROM (completed_at - created_at)) / 60.0 AS actual_minutes
           FROM delivery_routes
           WHERE status = 'done'
             AND completed_at IS NOT NULL
             AND completed_at >= NOW() - INTERVAL '24 hours'
         ) completed_routes`
      ),
      this.db.query<AssignmentRow>(
        `SELECT
           order_id AS "orderId",
           courier_id AS "courierId",
           courier_name AS "courierName",
           address,
           lat::float8 AS lat,
           lng::float8 AS lng,
           eta_minutes::int AS "etaMinutes",
           eta_lower_minutes::int AS "etaLowerMinutes",
           eta_upper_minutes::int AS "etaUpperMinutes",
           eta_confidence_score::float8 AS "etaConfidenceScore",
           route_sequence::int AS sequence,
           status
         FROM delivery_routes
         WHERE status IN ('assigned', 'cooking', 'delivery')
         ORDER BY updated_at DESC, route_sequence ASC
         LIMIT 16`
      ),
      this.db.query<TopProductRow>(
        `SELECT
           oi.name,
           SUM(oi.quantity)::int AS count
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY oi.product_id, oi.name
         ORDER BY count DESC, oi.name ASC
         LIMIT 5`
      ),
      this.db.query<HourlyRow>(
        `WITH hours AS (
           SELECT generate_series(
             date_trunc('hour', NOW()) - INTERVAL '11 hours',
             date_trunc('hour', NOW()),
             INTERVAL '1 hour'
           ) AS bucket
         ),
         orders_hour AS (
           SELECT
             date_trunc('hour', created_at) AS bucket,
             COUNT(*)::int AS orders
           FROM orders
           WHERE created_at >= date_trunc('hour', NOW()) - INTERVAL '11 hours'
           GROUP BY 1
         ),
         revenue_hour AS (
           SELECT
             date_trunc('hour', updated_at) AS bucket,
             COALESCE(ROUND(SUM(total)::numeric, 2), 0)::float8 AS revenue
           FROM orders
           WHERE status = 'done'
             AND updated_at >= date_trunc('hour', NOW()) - INTERVAL '11 hours'
           GROUP BY 1
         )
         SELECT
           to_char(hours.bucket, 'HH24:00') AS hour,
           COALESCE(orders_hour.orders, 0)::int AS orders,
           COALESCE(revenue_hour.revenue, 0)::float8 AS revenue
         FROM hours
         LEFT JOIN orders_hour ON orders_hour.bucket = hours.bucket
         LEFT JOIN revenue_hour ON revenue_hour.bucket = hours.bucket
         ORDER BY hours.bucket ASC`
      )
    ]);

    const ordersPerHour = hourlyRows.rows.map((row) => ({
      hour: row.hour,
      value: Number(row.orders)
    }));
    const revenuePerHour = hourlyRows.rows.map((row) => ({
      hour: row.hour,
      value: Number(row.revenue)
    }));

    const snapshot: DashboardMetricsSnapshot = {
      activeOrders: Number(activeOrdersRow.rows[0]?.value ?? 0),
      completedToday: Number(completedTodayRow.rows[0]?.value ?? 0),
      averageEta: Number(averageEtaRow.rows[0]?.value ?? 0),
      activeCouriers: Number(activeCouriersRow.rows[0]?.value ?? 0),
      revenueToday: Number(revenueTodayRow.rows[0]?.value ?? 0),
      avgRouteLength: Number(avgRouteLengthRow.rows[0]?.value ?? 0),
      avgEtaAccuracy: Number(avgEtaAccuracyRow.rows[0]?.value ?? 0),
      optimizedAssignments: assignmentsRows.rows.map((row) => ({
        orderId: row.orderId,
        courierId: row.courierId,
        courierName: row.courierName,
        address: row.address,
        lat: Number(row.lat),
        lng: Number(row.lng),
        etaMinutes: Number(row.etaMinutes),
        etaLowerMinutes: Number(row.etaLowerMinutes),
        etaUpperMinutes: Number(row.etaUpperMinutes),
        etaConfidenceScore: Number(row.etaConfidenceScore),
        sequence: Number(row.sequence),
        status: row.status
      })),
      topProducts: topProductsRows.rows.map((row) => ({
        name: row.name,
        count: Number(row.count)
      })),
      ordersPerHour,
      revenuePerHour,
      updatedAt: new Date().toISOString()
    };

    this.cache = {
      expiresAt: now + this.ttlMs,
      data: snapshot
    };

    return snapshot;
  }
}
