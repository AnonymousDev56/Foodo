import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { createDatabaseClient } from "@foodo/shared-db";
import amqplib, {
  type Channel,
  type ChannelModel,
  type ConsumeMessage
} from "amqplib";
import type { AssignDeliveryDto } from "./dto/assign-delivery.dto";
import type { AssignManualDeliveryDto } from "./dto/assign-manual-delivery.dto";
import type { UpdateDeliveryAdminStatusDto } from "./dto/update-delivery-admin-status.dto";
import type { UpdateDeliveryStatusDto } from "./dto/update-delivery-status.dto";
import { DeliveryRepository } from "./delivery.repository";
import type { Courier } from "./models/courier.model";
import type { DeliveryRoute, DeliveryStatus } from "./models/delivery-route.model";
import {
  RouteOptimizerService,
  type OptimizedRouteResult,
  type OptimizerMode
} from "./route-optimizer/optimizer.service";

interface OrderCreatedEvent extends AssignDeliveryDto {}

interface CalibrationSnapshot {
  biasFactor: number;
  reliabilityScore: number;
}

interface CalibratedRouteStep {
  orderId: string;
  sequence: number;
  etaMinutes: number;
  etaLowerMinutes: number;
  etaUpperMinutes: number;
  etaConfidenceScore: number;
  routeDistanceKm: number;
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

export interface CourierOptimizedRouteResponse {
  courierId: string;
  assignedOrders: DeliveryRoute[];
  optimizedRoute: OptimizedRoute;
  etaBreakdown: RouteStep[];
  totalTime: number;
  totalDistanceKm: number;
  recalculatedAt: string;
  algorithm: OptimizerMode;
}

export interface RecalculateEtaResponse {
  route: DeliveryRoute;
  optimizedRoute: CourierOptimizedRouteResponse;
}

export type RouteUpdatedListener = (route: DeliveryRoute) => void;

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://foodo:foodo@localhost:5672";
const EVENTS_EXCHANGE = "foodo.events";
const DELIVERY_QUEUE = "delivery-service.events";
const ORDERS_API_URL = process.env.ORDERS_API_URL ?? "http://localhost:3002";
const EVENTS = {
  ORDER_CREATED: "order.created",
  ORDER_ASSIGNED: "order.assigned",
  ORDER_ASSIGNED_MANUAL: "order.assigned.manual",
  DELIVERY_UPDATED: "delivery.updated"
} as const;

@Injectable()
export class DeliveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryService.name);
  private readonly db = createDatabaseClient("delivery-service");
  private readonly repository = new DeliveryRepository(this.db);
  private rabbitConnection: ChannelModel | null = null;
  private rabbitChannel: Channel | null = null;
  private readonly routeUpdatedListeners = new Set<RouteUpdatedListener>();

  constructor(private readonly routeOptimizer: RouteOptimizerService) {}

  async onModuleInit() {
    await this.db.init();
    await this.initRabbitMq();
    await this.refreshCourierAvailability();
  }

  async onModuleDestroy() {
    await this.rabbitChannel?.close().catch(() => undefined);
    await this.rabbitConnection?.close().catch(() => undefined);
    await this.db.close();
  }

  async assign(payload: AssignDeliveryDto) {
    return this.assignInternal(payload, { mode: "auto" });
  }

  async assignManual(payload: AssignManualDeliveryDto) {
    return this.assignInternal(payload, { mode: "manual", courierId: payload.courierId });
  }

  async byOrder(orderId: string) {
    const route = await this.repository.getRouteByOrder(orderId);
    if (!route) {
      throw new NotFoundException("Delivery route not found");
    }

    return route;
  }

  async getOptimizedRoute(courierId: string, rawMode?: string) {
    await this.refreshCourierAvailability();
    const mode = this.parseOptimizerMode(rawMode);

    return this.safeRecalculateCourierRoute(courierId, "api:get-route", { mode });
  }

  async recalculateEta(orderId: string, rawMode?: string): Promise<RecalculateEtaResponse> {
    const route = await this.repository.getRouteByOrder(orderId);
    if (!route) {
      throw new NotFoundException("Delivery route not found");
    }

    const mode = this.parseOptimizerMode(rawMode);
    const optimizedRoute = await this.safeRecalculateCourierRoute(
      route.courierId,
      `api:recalculate:${orderId}`,
      { mode }
    );

    const refreshed = await this.repository.getRouteByOrder(orderId);
    if (!refreshed) {
      throw new NotFoundException("Delivery route not found");
    }

    return {
      route: refreshed,
      optimizedRoute
    };
  }

  async courierActive(courierId: string) {
    await this.refreshCourierAvailability();
    return this.repository.getRoutes({ courierId, activeOnly: true });
  }

  async activeRoutes() {
    await this.refreshCourierAvailability();
    return this.repository.getRoutes({ activeOnly: true });
  }

  async getCouriers() {
    await this.refreshCourierAvailability();
    const couriers = await this.repository.listCouriersWithCounts();
    return couriers.map((item) => item.courier).sort((a, b) => a.name.localeCompare(b.name));
  }

  async stats() {
    await this.refreshCourierAvailability();

    const routes = await this.repository.getRoutes();
    const activeRoutes = routes.filter((route) => route.status !== "done");
    const completedRoutes = routes.filter((route) => route.status === "done");

    const averageEtaMinutes = activeRoutes.length
      ? Number(
          (
            activeRoutes.reduce((sum, route) => sum + route.etaMinutes, 0) /
            activeRoutes.length
          ).toFixed(2)
        )
      : 0;

    const couriers = await this.repository.listCouriersWithCounts();
    const courierStats = couriers.map((courierInfo) => {
      const courierCompleted = completedRoutes.filter(
        (route) => route.courierId === courierInfo.courier.id
      );

      const avgDeliveryMinutes = courierCompleted.length
        ? Number(
            (
              courierCompleted.reduce((sum, route) => {
                const end = new Date(route.completedAt ?? route.updatedAt).valueOf();
                const start = new Date(route.createdAt).valueOf();
                const durationMinutes = Math.max(0, Math.round((end - start) / 60000));
                return sum + durationMinutes;
              }, 0) / courierCompleted.length
            ).toFixed(2)
          )
        : 0;

      return {
        courierId: courierInfo.courier.id,
        courierName: courierInfo.courier.name,
        activeCount: courierInfo.activeCount,
        completedCount: courierInfo.completedCount,
        avgDeliveryMinutes
      };
    });

    return {
      activeRoutes: activeRoutes.length,
      completedRoutes: completedRoutes.length,
      averageEtaMinutes,
      couriers: courierStats
    };
  }

  async updateStatus(orderId: string, status: UpdateDeliveryStatusDto["status"]) {
    const route = await this.repository.getRouteByOrder(orderId);
    if (!route) {
      throw new NotFoundException("Delivery route not found");
    }

    const updated = await this.setRouteStatus(route, status, {
      force: false,
      syncOrder: true
    });

    return updated;
  }

  async updateStatusByAdmin(orderId: string, status: UpdateDeliveryAdminStatusDto["status"]) {
    const route = await this.repository.getRouteByOrder(orderId);
    if (!route) {
      throw new NotFoundException("Delivery route not found");
    }

    const updated = await this.setRouteStatus(route, status, {
      force: true,
      syncOrder: false
    });

    return updated;
  }

  onRouteUpdated(listener: RouteUpdatedListener) {
    this.routeUpdatedListeners.add(listener);
    return () => {
      this.routeUpdatedListeners.delete(listener);
    };
  }

  private async assignInternal(
    payload: AssignDeliveryDto,
    options: { mode: "auto" | "manual"; courierId?: string }
  ) {
    const now = new Date().toISOString();
    const eventName =
      options.mode === "manual" ? EVENTS.ORDER_ASSIGNED_MANUAL : EVENTS.ORDER_ASSIGNED;

    const existing = await this.repository.getRouteByOrder(payload.orderId);
    if (existing) {
      if (existing.status === "done") {
        throw new BadRequestException("Cannot reassign completed delivery");
      }

      if (options.mode === "manual") {
        const manualCourier = await this.getCourierById(options.courierId);
        const previousCourierId = existing.courierId;
        const updated = await this.repository.reassignRoute(existing.orderId, {
          courierId: manualCourier.id,
          courierName: manualCourier.name,
          etaMinutes: existing.etaMinutes,
          etaLowerMinutes: existing.etaLowerMinutes,
          etaUpperMinutes: existing.etaUpperMinutes,
          etaConfidenceScore: existing.etaConfidenceScore,
          routeSequence: 1,
          routeTotalTimeMinutes: 0,
          routeDistanceKm: 0,
          updatedAt: now
        });

        if (!updated) {
          throw new NotFoundException("Delivery route not found");
        }

        await this.refreshCourierAvailability();
        await this.safeRecalculateCourierRoute(manualCourier.id, "assign:manual");

        if (previousCourierId !== manualCourier.id) {
          await this.safeRecalculateCourierRoute(previousCourierId, "assign:manual:previous");
        }

        const finalRoute = (await this.repository.getRouteByOrder(updated.orderId)) ?? updated;
        await this.publishEvent(eventName, this.toRouteEventPayload(finalRoute));
        await this.syncOrderDeliverySnapshot(finalRoute);
        this.emitRouteUpdated(finalRoute);

        return finalRoute;
      }

      return existing;
    }

    const courier =
      options.mode === "manual"
        ? await this.getCourierById(options.courierId)
        : await this.pickNearestFreeCourier(payload.lat, payload.lng);

    const seedEta = this.randomEtaMinutes();
    const created = await this.repository.createRoute({
      orderId: payload.orderId,
      userId: payload.userId,
      courierId: courier.id,
      courierName: courier.name,
      address: payload.address,
      lat: payload.lat,
      lng: payload.lng,
      etaMinutes: seedEta,
      etaLowerMinutes: Math.max(1, seedEta - 2),
      etaUpperMinutes: seedEta + 2,
      etaConfidenceScore: 76,
      routeSequence: 1,
      routeTotalTimeMinutes: 0,
      routeDistanceKm: 0,
      status: "cooking",
      total: payload.total,
      createdAt: now,
      updatedAt: now
    });

    if (!created) {
      throw new BadRequestException("Failed to create delivery route");
    }

    await this.refreshCourierAvailability();
    await this.safeRecalculateCourierRoute(courier.id, "assign:auto");

    const finalRoute = (await this.repository.getRouteByOrder(created.orderId)) ?? created;

    await this.publishEvent(eventName, this.toRouteEventPayload(finalRoute));
    await this.syncOrderDeliverySnapshot(finalRoute);
    await this.syncOrderStatus(finalRoute.orderId, "cooking");
    this.emitRouteUpdated(finalRoute);

    return finalRoute;
  }

  private async setRouteStatus(
    route: DeliveryRoute,
    status: DeliveryStatus,
    options: { force: boolean; syncOrder: boolean }
  ) {
    const nextMap: Record<DeliveryStatus, DeliveryStatus | null> = {
      assigned: "cooking",
      cooking: "delivery",
      delivery: "done",
      done: null
    };

    if (!options.force) {
      const expected = nextMap[route.status];
      if (route.status !== status && expected !== status) {
        throw new BadRequestException(
          `Invalid delivery transition: ${route.status} -> ${status}. Allowed next: ${expected ?? "none"}`
        );
      }
    }

    const updatedAt = new Date().toISOString();
    const completedAt = status === "done" ? updatedAt : undefined;
    const updated = await this.repository.updateRouteStatus(route.orderId, status, updatedAt, completedAt);
    if (!updated) {
      throw new NotFoundException("Delivery route not found");
    }

    if (status === "done") {
      await this.repository.updateCourierPosition(updated.courierId, updated.lat, updated.lng);
    }

    await this.refreshCourierAvailability();

    if (status === "done") {
      const calibration = await this.repository.refreshCourierCalibration(updated.courierId);
      this.logger.debug(
        `Courier calibration updated ${updated.courierId}: bias=${calibration.biasFactor.toFixed(3)}, reliability=${calibration.reliabilityScore.toFixed(1)} (${calibration.completedCount} completed)`
      );
    }

    await this.publishEvent(EVENTS.DELIVERY_UPDATED, this.toRouteEventPayload(updated));

    await this.syncOrderDeliverySnapshot(updated);
    if (options.syncOrder && (status === "cooking" || status === "delivery" || status === "done")) {
      await this.syncOrderStatus(updated.orderId, status);
    }
    this.emitRouteUpdated(updated);

    await this.safeRecalculateCourierRoute(updated.courierId, `status:${updated.orderId}:${status}`, {
      skipPublishOrderId: status === "done" ? undefined : updated.orderId
    });

    const finalRoute = await this.repository.getRouteByOrder(route.orderId);
    if (!finalRoute) {
      throw new NotFoundException("Delivery route not found");
    }

    return finalRoute;
  }

  private parseOptimizerMode(rawMode?: string): OptimizerMode | undefined {
    if (rawMode === "greedy" || rawMode === "tsp-lite") {
      return rawMode;
    }
    return undefined;
  }

  private async safeRecalculateCourierRoute(
    courierId: string,
    reason: string,
    options?: {
      mode?: OptimizerMode;
      skipPublishOrderId?: string;
    }
  ) {
    try {
      return await this.recalculateCourierRoute(courierId, reason, options);
    } catch (error) {
      this.logger.warn(
        `Route optimization failed for courier ${courierId} (${reason}): ${(error as Error).message}`
      );
      return this.recalculateCourierRouteFallback(courierId, reason, options);
    }
  }

  private async recalculateCourierRoute(
    courierId: string,
    reason: string,
    options?: {
      mode?: OptimizerMode;
      skipPublishOrderId?: string;
    }
  ): Promise<CourierOptimizedRouteResponse> {
    const courierInfo = await this.repository.getCourierById(courierId);
    if (!courierInfo) {
      throw new NotFoundException("Courier not found");
    }

    const activeRoutes = await this.repository.getRoutes({ courierId, activeOnly: true });
    const now = new Date().toISOString();

    if (!activeRoutes.length) {
      this.logger.debug(`Route optimization skipped for courier ${courierId} (${reason}): no active routes`);
      return {
        courierId,
        assignedOrders: [],
        optimizedRoute: {
          courierId,
          steps: [],
          totalTime: 0,
          totalTimeLower: 0,
          totalTimeUpper: 0,
          confidenceScore: Number(courierInfo.courier.etaReliabilityScore.toFixed(2)),
          totalDistanceKm: 0
        },
        etaBreakdown: [],
        totalTime: 0,
        totalDistanceKm: 0,
        recalculatedAt: now,
        algorithm: options?.mode ?? "greedy"
      };
    }

    const optimization = this.routeOptimizer.optimize({
      courierId,
      courierPosition: {
        lat: courierInfo.courier.lat,
        lng: courierInfo.courier.lng
      },
      stops: activeRoutes.map((route) => ({
        orderId: route.orderId,
        address: route.address,
        lat: route.lat,
        lng: route.lng,
        status: route.status
      })),
      mode: options?.mode
    });

    const calibration: CalibrationSnapshot = {
      biasFactor: courierInfo.courier.etaBiasFactor,
      reliabilityScore: courierInfo.courier.etaReliabilityScore
    };
    const calibratedSteps = this.calibrateOptimization(optimization, calibration);
    await this.applyOptimizationUpdates(courierId, optimization, calibratedSteps, now);

    const refreshed = await this.repository.getRoutes({ courierId, activeOnly: true });
    const orderedRoutes = this.sortRoutesBySequence(refreshed);
    const optimizedRoute = this.toOptimizedRouteResponse(
      courierId,
      orderedRoutes,
      optimization,
      calibratedSteps,
      calibration.reliabilityScore,
      now
    );

    this.logger.debug(
      `Route optimized (${optimization.algorithm}) for courier ${courierId}: ${orderedRoutes.length} stops, ${optimizedRoute.totalTime} min, ${optimizedRoute.totalDistanceKm.toFixed(2)} km, bias=${calibration.biasFactor.toFixed(3)}, reliability=${calibration.reliabilityScore.toFixed(1)} [${reason}]`
    );

    for (const route of orderedRoutes) {
      if (options?.skipPublishOrderId && route.orderId === options.skipPublishOrderId) {
        continue;
      }

      await this.publishEvent(EVENTS.DELIVERY_UPDATED, this.toRouteEventPayload(route));
      await this.syncOrderDeliverySnapshot(route);
      this.emitRouteUpdated(route);
    }

    return optimizedRoute;
  }

  private async recalculateCourierRouteFallback(
    courierId: string,
    reason: string,
    options?: {
      skipPublishOrderId?: string;
    }
  ): Promise<CourierOptimizedRouteResponse> {
    const activeRoutes = await this.repository.getRoutes({ courierId, activeOnly: true });
    const orderedByCreation = [...activeRoutes].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );

    const fallbackSteps: RouteStep[] = [];
    const updates: Array<{
      orderId: string;
      etaMinutes: number;
      etaLowerMinutes: number;
      etaUpperMinutes: number;
      etaConfidenceScore: number;
      routeSequence: number;
      routeTotalTimeMinutes: number;
      routeDistanceKm: number;
    }> = [];

    let totalTime = 0;
    let totalDistance = 0;
    const fallbackConfidence = 68;

    orderedByCreation.forEach((route, index) => {
      const hopMinutes = 5 + index * 2;
      const hopDistance = Number((0.9 + index * 0.6).toFixed(2));
      totalTime += hopMinutes;
      totalDistance += hopDistance;
      const etaLowerMinutes = Math.max(1, Math.round(totalTime * 0.85));
      const etaUpperMinutes = Math.max(etaLowerMinutes, Math.round(totalTime * 1.2));

      fallbackSteps.push({
        orderId: route.orderId,
        address: route.address,
        etaMinutes: totalTime,
        etaLowerMinutes,
        etaUpperMinutes,
        etaConfidenceScore: fallbackConfidence,
        sequence: index + 1
      });

      updates.push({
        orderId: route.orderId,
        etaMinutes: totalTime,
        etaLowerMinutes,
        etaUpperMinutes,
        etaConfidenceScore: fallbackConfidence,
        routeSequence: index + 1,
        routeTotalTimeMinutes: totalTime,
        routeDistanceKm: Number(totalDistance.toFixed(2))
      });
    });

    const updatedAt = new Date().toISOString();
    await this.repository.applyRouteOptimization(courierId, updates, updatedAt);

    const refreshed = await this.repository.getRoutes({ courierId, activeOnly: true });
    const orderedRoutes = this.sortRoutesBySequence(refreshed);

    for (const route of orderedRoutes) {
      if (options?.skipPublishOrderId && route.orderId === options.skipPublishOrderId) {
        continue;
      }

      await this.publishEvent(EVENTS.DELIVERY_UPDATED, this.toRouteEventPayload(route));
      await this.syncOrderDeliverySnapshot(route);
      this.emitRouteUpdated(route);
    }

    this.logger.debug(
      `Route fallback applied for courier ${courierId}: ${orderedRoutes.length} stops [${reason}]`
    );

    return {
      courierId,
      assignedOrders: orderedRoutes,
      optimizedRoute: {
        courierId,
        steps: fallbackSteps,
        totalTime,
        totalTimeLower: Math.max(1, Math.round(totalTime * 0.85)),
        totalTimeUpper: Math.max(1, Math.round(totalTime * 1.2)),
        confidenceScore: fallbackConfidence,
        totalDistanceKm: Number(totalDistance.toFixed(2))
      },
      etaBreakdown: fallbackSteps,
      totalTime,
      totalDistanceKm: Number(totalDistance.toFixed(2)),
      recalculatedAt: updatedAt,
      algorithm: "greedy"
    };
  }

  private async applyOptimizationUpdates(
    courierId: string,
    optimization: OptimizedRouteResult,
    calibratedSteps: CalibratedRouteStep[],
    updatedAt: string
  ) {
    const totalTime = calibratedSteps.length
      ? calibratedSteps[calibratedSteps.length - 1].etaMinutes
      : optimization.totalTime;
    const updates = calibratedSteps.map((step) => ({
      orderId: step.orderId,
      etaMinutes: step.etaMinutes,
      etaLowerMinutes: step.etaLowerMinutes,
      etaUpperMinutes: step.etaUpperMinutes,
      etaConfidenceScore: step.etaConfidenceScore,
      routeSequence: step.sequence,
      routeTotalTimeMinutes: totalTime,
      routeDistanceKm: step.routeDistanceKm
    }));

    await this.repository.applyRouteOptimization(courierId, updates, updatedAt);
  }

  private toOptimizedRouteResponse(
    courierId: string,
    orderedRoutes: DeliveryRoute[],
    optimization: OptimizedRouteResult,
    calibratedSteps: CalibratedRouteStep[],
    reliabilityScore: number,
    recalculatedAt: string
  ): CourierOptimizedRouteResponse {
    const routeByOrderId = new Map(orderedRoutes.map((route) => [route.orderId, route]));
    const calibratedByOrderId = new Map(
      calibratedSteps.map((step) => [step.orderId, step])
    );

    const steps = optimization.steps.map((step) => {
      const persisted = routeByOrderId.get(step.orderId);
      const calibrated = calibratedByOrderId.get(step.orderId);
      return {
        orderId: step.orderId,
        address: step.address,
        etaMinutes: persisted?.etaMinutes ?? calibrated?.etaMinutes ?? step.etaMinutes,
        etaLowerMinutes:
          persisted?.etaLowerMinutes ??
          calibrated?.etaLowerMinutes ??
          Math.max(1, step.etaMinutes - 2),
        etaUpperMinutes:
          persisted?.etaUpperMinutes ??
          calibrated?.etaUpperMinutes ??
          Math.max(1, step.etaMinutes + 3),
        etaConfidenceScore:
          persisted?.etaConfidenceScore ??
          calibrated?.etaConfidenceScore ??
          Number(reliabilityScore.toFixed(2)),
        sequence: persisted?.routeSequence ?? step.sequence
      };
    });

    const totalTime = steps.length ? steps[steps.length - 1].etaMinutes : 0;
    const totalTimeLower = steps.length ? steps[steps.length - 1].etaLowerMinutes : 0;
    const totalTimeUpper = steps.length ? steps[steps.length - 1].etaUpperMinutes : 0;

    return {
      courierId,
      assignedOrders: orderedRoutes,
      optimizedRoute: {
        courierId,
        steps,
        totalTime,
        totalTimeLower,
        totalTimeUpper,
        confidenceScore: Number(reliabilityScore.toFixed(2)),
        totalDistanceKm: optimization.totalDistanceKm
      },
      etaBreakdown: steps,
      totalTime,
      totalDistanceKm: optimization.totalDistanceKm,
      recalculatedAt,
      algorithm: optimization.algorithm
    };
  }

  private calibrateOptimization(
    optimization: OptimizedRouteResult,
    calibration: CalibrationSnapshot
  ): CalibratedRouteStep[] {
    let cumulativeDistance = 0;
    const spreadRatio = this.estimateEtaSpreadRatio(calibration.reliabilityScore);

    return optimization.steps.map((step) => {
      const calibratedEta = Math.max(1, Math.round(step.etaMinutes * calibration.biasFactor));
      const etaLowerMinutes = Math.max(
        1,
        Math.round(calibratedEta * (1 - spreadRatio))
      );
      const etaUpperMinutes = Math.max(
        etaLowerMinutes,
        Math.round(calibratedEta * (1 + spreadRatio))
      );
      const etaConfidenceScore = Number(
        Math.max(30, Math.min(99, calibration.reliabilityScore - (step.sequence - 1) * 1.6)).toFixed(2)
      );

      cumulativeDistance += step.distanceKm;

      return {
        orderId: step.orderId,
        sequence: step.sequence,
        etaMinutes: calibratedEta,
        etaLowerMinutes,
        etaUpperMinutes,
        etaConfidenceScore,
        routeDistanceKm: Number(cumulativeDistance.toFixed(2))
      };
    });
  }

  private estimateEtaSpreadRatio(reliabilityScore: number) {
    const normalized = Math.max(0, Math.min(100, reliabilityScore));
    const spread = (100 - normalized) / 250 + 0.1;
    return Math.max(0.08, Math.min(0.32, spread));
  }

  private sortRoutesBySequence(routes: DeliveryRoute[]) {
    return [...routes].sort((a, b) => {
      if (a.routeSequence !== b.routeSequence) {
        return a.routeSequence - b.routeSequence;
      }

      if (a.etaMinutes !== b.etaMinutes) {
        return a.etaMinutes - b.etaMinutes;
      }

      return a.createdAt.localeCompare(b.createdAt);
    });
  }

  private toRouteEventPayload(route: DeliveryRoute) {
    return {
      orderId: route.orderId,
      courierId: route.courierId,
      courierName: route.courierName,
      address: route.address,
      etaMinutes: route.etaMinutes,
      etaLowerMinutes: route.etaLowerMinutes,
      etaUpperMinutes: route.etaUpperMinutes,
      etaConfidenceScore: route.etaConfidenceScore,
      routeSequence: route.routeSequence,
      routeTotalTimeMinutes: route.routeTotalTimeMinutes,
      routeDistanceKm: route.routeDistanceKm,
      status: route.status,
      updatedAt: route.updatedAt
    };
  }

  private async getCourierById(courierId?: string) {
    if (!courierId) {
      throw new NotFoundException("Courier not found");
    }

    const courier = await this.repository.getCourierById(courierId);
    if (!courier) {
      throw new NotFoundException("Courier not found");
    }

    return courier.courier;
  }

  private async pickNearestFreeCourier(targetLat: number, targetLng: number) {
    const couriers = await this.repository.listCouriersWithCounts();
    if (!couriers.length) {
      throw new BadRequestException("No couriers available");
    }

    const freeCouriers = couriers.filter((courierInfo) => courierInfo.activeCount === 0);
    const pool = freeCouriers.length ? freeCouriers : couriers;

    return pool
      .map((item) => item.courier)
      .reduce((best, current) => {
        const currentDistance = this.distance(current.lat, current.lng, targetLat, targetLng);
        const bestDistance = this.distance(best.lat, best.lng, targetLat, targetLng);
        return currentDistance < bestDistance ? current : best;
      });
  }

  private distance(aLat: number, aLng: number, bLat: number, bLng: number) {
    const dx = aLat - bLat;
    const dy = aLng - bLng;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private randomEtaMinutes() {
    return Math.floor(Math.random() * 11) + 5;
  }

  private async refreshCourierAvailability() {
    const couriers = await this.repository.listCouriersWithCounts();
    for (const item of couriers) {
      const nextAvailability = item.activeCount === 0;
      if (item.courier.isAvailable !== nextAvailability) {
        await this.repository.setCourierAvailability(item.courier.id, nextAvailability);
      }
    }
  }

  private async syncOrderStatus(orderId: string, status: "cooking" | "delivery" | "done") {
    try {
      await fetch(`${ORDERS_API_URL}/orders/${orderId}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync order status ${orderId} -> ${status}: ${(error as Error).message}`
      );
    }
  }

  private async syncOrderDeliverySnapshot(route: DeliveryRoute) {
    try {
      await fetch(`${ORDERS_API_URL}/orders/${route.orderId}/delivery-snapshot`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          courierId: route.courierId,
          courierName: route.courierName,
          address: route.address,
          etaMinutes: route.etaMinutes,
          etaLowerMinutes: route.etaLowerMinutes,
          etaUpperMinutes: route.etaUpperMinutes,
          etaConfidenceScore: route.etaConfidenceScore,
          status: route.status,
          updatedAt: route.updatedAt
        })
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync order delivery snapshot ${route.orderId}: ${(error as Error).message}`
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
      await this.rabbitChannel.assertQueue(DELIVERY_QUEUE, { durable: false });
      await this.rabbitChannel.bindQueue(
        DELIVERY_QUEUE,
        EVENTS_EXCHANGE,
        EVENTS.ORDER_CREATED
      );

      await this.rabbitChannel.consume(DELIVERY_QUEUE, async (message) => {
        await this.handleOrderCreatedMessage(message);
      });

      this.logger.log("RabbitMQ connected for delivery-service");
    } catch (error) {
      this.logger.warn(
        `RabbitMQ disabled for delivery-service: ${(error as Error).message}`
      );
      this.rabbitConnection = null;
      this.rabbitChannel = null;
    }
  }

  private async handleOrderCreatedMessage(message: ConsumeMessage | null) {
    if (!message || !this.rabbitChannel) {
      return;
    }

    try {
      const payload = JSON.parse(message.content.toString("utf8")) as OrderCreatedEvent;
      await this.assignInternal(payload, { mode: "auto" });
      this.rabbitChannel.ack(message);
    } catch (error) {
      this.logger.error(
        `Failed to process order.created event: ${(error as Error).message}`
      );
      this.rabbitChannel.ack(message);
    }
  }

  private async publishEvent(eventName: string, payload: Record<string, unknown>) {
    if (!this.rabbitChannel) {
      return;
    }
    try {
      this.rabbitChannel.publish(
        EVENTS_EXCHANGE,
        eventName,
        Buffer.from(JSON.stringify(payload))
      );
    } catch (error) {
      this.logger.warn(`RabbitMQ publish failed (${eventName}): ${(error as Error).message}`);
    }
  }

  private emitRouteUpdated(route: DeliveryRoute) {
    for (const listener of this.routeUpdatedListeners) {
      try {
        listener(route);
      } catch (error) {
        this.logger.warn(`Route update listener failed: ${(error as Error).message}`);
      }
    }
  }
}
