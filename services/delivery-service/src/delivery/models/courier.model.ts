export interface Courier {
  id: string;
  email: string;
  name: string;
  lat: number;
  lng: number;
  isAvailable: boolean;
  etaBiasFactor: number;
  etaReliabilityScore: number;
  completedDeliveries: number;
}
