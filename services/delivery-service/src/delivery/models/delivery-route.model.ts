export type DeliveryStatus = "assigned" | "cooking" | "delivery" | "done";

export interface DeliveryItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface DeliveryRoute {
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
  items: DeliveryItem[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
