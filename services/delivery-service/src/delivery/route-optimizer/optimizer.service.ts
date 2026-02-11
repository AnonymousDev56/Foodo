import { Injectable } from "@nestjs/common";
import type { DeliveryStatus } from "../models/delivery-route.model";

export type OptimizerMode = "greedy" | "tsp-lite";

export interface OptimizerStop {
  orderId: string;
  address: string;
  lat: number;
  lng: number;
  status: DeliveryStatus;
}

export interface OptimizerStep extends OptimizerStop {
  etaMinutes: number;
  sequence: number;
  distanceKm: number;
  travelMinutes: number;
  stopMinutes: number;
}

export interface OptimizedRouteResult {
  courierId: string;
  steps: OptimizerStep[];
  totalTime: number;
  totalDistanceKm: number;
  algorithm: OptimizerMode;
}

interface Coordinate {
  lat: number;
  lng: number;
}

interface OptimizeInput {
  courierId: string;
  courierPosition: Coordinate;
  stops: OptimizerStop[];
  mode?: OptimizerMode;
}

const DEFAULT_MODE: OptimizerMode =
  process.env.ROUTE_OPTIMIZER_MODE === "tsp-lite" ? "tsp-lite" : "greedy";
const MAX_TSP_STOPS = 5;
const DEFAULT_SPEED_KMH = 28;

@Injectable()
export class RouteOptimizerService {
  optimize(input: OptimizeInput): OptimizedRouteResult {
    if (!input.stops.length) {
      return {
        courierId: input.courierId,
        steps: [],
        totalTime: 0,
        totalDistanceKm: 0,
        algorithm: this.resolveMode(input.mode, 0)
      };
    }

    const mode = this.resolveMode(input.mode, input.stops.length);
    const orderedStops =
      mode === "tsp-lite"
        ? this.orderStopsByTspLite(input.courierPosition, input.stops)
        : this.orderStopsByGreedy(input.courierPosition, input.stops);

    let currentPosition = input.courierPosition;
    let elapsedMinutes = 0;
    let totalDistanceKm = 0;
    const steps: OptimizerStep[] = [];

    for (const [index, stop] of orderedStops.entries()) {
      const distanceKm = this.distanceKm(currentPosition, stop);
      const travelMinutes = this.estimateTravelMinutes(distanceKm, index);
      const stopMinutes = this.estimateStopMinutes(stop.status);
      elapsedMinutes += travelMinutes + stopMinutes;
      totalDistanceKm += distanceKm;

      steps.push({
        ...stop,
        sequence: index + 1,
        etaMinutes: Math.max(1, elapsedMinutes),
        distanceKm: Number(distanceKm.toFixed(2)),
        travelMinutes,
        stopMinutes
      });

      currentPosition = stop;
    }

    return {
      courierId: input.courierId,
      steps,
      totalTime: Math.max(1, elapsedMinutes),
      totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
      algorithm: mode
    };
  }

  private resolveMode(mode: OptimizerMode | undefined, stopCount: number): OptimizerMode {
    const requested = mode ?? DEFAULT_MODE;
    if (requested === "tsp-lite" && stopCount > MAX_TSP_STOPS) {
      return "greedy";
    }
    return requested;
  }

  private orderStopsByGreedy(start: Coordinate, stops: OptimizerStop[]) {
    const remaining = [...stops];
    const ordered: OptimizerStop[] = [];
    let cursor = start;

    while (remaining.length) {
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const [index, stop] of remaining.entries()) {
        const distance = this.distanceKm(cursor, stop);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }

      const [nearest] = remaining.splice(nearestIndex, 1);
      ordered.push(nearest);
      cursor = nearest;
    }

    return ordered;
  }

  private orderStopsByTspLite(start: Coordinate, stops: OptimizerStop[]) {
    if (stops.length <= 1) {
      return [...stops];
    }

    const permutations = this.permutations(stops);
    let bestRoute = permutations[0];
    let bestDistance = this.routeDistanceKm(start, bestRoute);

    for (const route of permutations.slice(1)) {
      const distance = this.routeDistanceKm(start, route);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestRoute = route;
      }
    }

    return bestRoute;
  }

  private routeDistanceKm(start: Coordinate, route: OptimizerStop[]) {
    let cursor = start;
    let total = 0;
    for (const stop of route) {
      total += this.distanceKm(cursor, stop);
      cursor = stop;
    }
    return total;
  }

  private permutations(stops: OptimizerStop[]): OptimizerStop[][] {
    const result: OptimizerStop[][] = [];
    const used = new Array(stops.length).fill(false);
    const current: OptimizerStop[] = [];

    const backtrack = () => {
      if (current.length === stops.length) {
        result.push([...current]);
        return;
      }

      for (let index = 0; index < stops.length; index += 1) {
        if (used[index]) {
          continue;
        }
        used[index] = true;
        current.push(stops[index]);
        backtrack();
        current.pop();
        used[index] = false;
      }
    };

    backtrack();
    return result;
  }

  private estimateStopMinutes(status: DeliveryStatus) {
    if (status === "assigned") {
      return 3;
    }
    if (status === "cooking") {
      return 4;
    }
    if (status === "delivery") {
      return 2;
    }
    return 1;
  }

  private estimateTravelMinutes(distanceKm: number, sequenceIndex: number) {
    const speedKmh = Math.max(18, DEFAULT_SPEED_KMH - sequenceIndex);
    const travelHours = distanceKm / speedKmh;
    const jitter = sequenceIndex % 2 === 0 ? 1.08 : 0.95;
    return Math.max(1, Math.round(travelHours * 60 * jitter));
  }

  private distanceKm(a: Coordinate, b: Coordinate) {
    // Mock city-grid matrix to emulate traffic and block density without map APIs.
    const latKm = Math.abs(a.lat - b.lat) * 111;
    const lngKm = Math.abs(a.lng - b.lng) * 85;
    const euclideanKm = Math.sqrt(latKm * latKm + lngKm * lngKm);
    const trafficFactor = this.mockTrafficFactor(a, b);
    return Math.max(0.35, Number((euclideanKm * trafficFactor + 0.2).toFixed(3)));
  }

  private mockTrafficFactor(a: Coordinate, b: Coordinate) {
    const cellA = `${Math.round(a.lat * 100)}:${Math.round(a.lng * 100)}`;
    const cellB = `${Math.round(b.lat * 100)}:${Math.round(b.lng * 100)}`;
    const hashBase = `${cellA}|${cellB}`;
    let hash = 0;
    for (let index = 0; index < hashBase.length; index += 1) {
      hash = (hash * 31 + hashBase.charCodeAt(index)) >>> 0;
    }

    const normalized = (hash % 35) / 100; // 0..0.34
    return 0.85 + normalized; // 0.85..1.19
  }
}
