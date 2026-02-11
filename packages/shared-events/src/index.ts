export const EVENTS = {
  ORDER_CREATED: "order.created",
  ORDER_ASSIGNED: "order.assigned",
  ORDER_ASSIGNED_MANUAL: "order.assigned.manual",
  ORDER_DONE: "order.done",
  DELIVERY_UPDATED: "delivery.updated",
  STOCK_LOW: "stock.low"
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
