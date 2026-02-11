import { Controller, Get, Headers, Inject } from "@nestjs/common";
import { OrdersService } from "./orders/orders.service";

@Controller()
export class AppController {
  constructor(@Inject(OrdersService) private readonly ordersService: OrdersService) {}

  @Get("health")
  health() {
    return { service: "orders-service", status: "ok" };
  }

  @Get("admin/dashboard-metrics")
  adminDashboardMetrics(@Headers("authorization") authorization?: string) {
    return this.ordersService.adminDashboardMetrics(authorization);
  }
}
