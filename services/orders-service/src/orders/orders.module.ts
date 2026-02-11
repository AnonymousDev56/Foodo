import { Module } from "@nestjs/common";
import { DashboardMetricsService } from "./dashboard-metrics.service";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, DashboardMetricsService],
  exports: [OrdersService, DashboardMetricsService]
})
export class OrdersModule {}
