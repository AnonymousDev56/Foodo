import type { Courier } from "../models/courier.model";

export const COURIER_SEED: Omit<Courier, "isAvailable">[] = [
  {
    id: "courier-1",
    email: "courier1@foodo.local",
    name: "Alex Courier",
    lat: 40.73061,
    lng: -73.935242,
    etaBiasFactor: 1,
    etaReliabilityScore: 80,
    completedDeliveries: 0
  },
  {
    id: "courier-2",
    email: "courier2@foodo.local",
    name: "Mia Rider",
    lat: 40.712776,
    lng: -74.005974,
    etaBiasFactor: 1,
    etaReliabilityScore: 80,
    completedDeliveries: 0
  }
];
