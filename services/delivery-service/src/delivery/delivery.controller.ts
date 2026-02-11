import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { AssignDeliveryDto } from "./dto/assign-delivery.dto";
import { AssignManualDeliveryDto } from "./dto/assign-manual-delivery.dto";
import { UpdateDeliveryAdminStatusDto } from "./dto/update-delivery-admin-status.dto";
import { UpdateDeliveryStatusDto } from "./dto/update-delivery-status.dto";
import { DeliveryService } from "./delivery.service";

@Controller("delivery")
export class DeliveryController {
  private readonly deliveryService: DeliveryService;

  constructor(@Inject(DeliveryService) deliveryService: DeliveryService) {
    this.deliveryService = deliveryService;
  }

  @Post("assign")
  assign(@Body() payload: AssignDeliveryDto) {
    return this.deliveryService.assign(payload);
  }

  @Post("assign/manual")
  assignManual(@Body() payload: AssignManualDeliveryDto) {
    return this.deliveryService.assignManual(payload);
  }

  @Get("active")
  activeRoutes() {
    return this.deliveryService.activeRoutes();
  }

  @Get("stats")
  stats() {
    return this.deliveryService.stats();
  }

  @Get("couriers")
  couriers() {
    return this.deliveryService.getCouriers();
  }

  @Get("courier/:id/active")
  courierActive(@Param("id") courierId: string) {
    return this.deliveryService.courierActive(courierId);
  }

  @Get("route/:courierId")
  optimizedRoute(@Param("courierId") courierId: string, @Query("mode") mode?: string) {
    return this.deliveryService.getOptimizedRoute(courierId, mode);
  }

  @Get(":orderId")
  byOrder(@Param("orderId") orderId: string) {
    return this.deliveryService.byOrder(orderId);
  }

  @Patch(":orderId/status")
  updateStatus(
    @Param("orderId") orderId: string,
    @Body() payload: UpdateDeliveryStatusDto
  ) {
    return this.deliveryService.updateStatus(orderId, payload.status);
  }

  @Patch(":orderId/recalculate-eta")
  recalculateEta(@Param("orderId") orderId: string, @Query("mode") mode?: string) {
    return this.deliveryService.recalculateEta(orderId, mode);
  }

  @Patch(":orderId/admin-status")
  updateStatusByAdmin(
    @Param("orderId") orderId: string,
    @Body() payload: UpdateDeliveryAdminStatusDto
  ) {
    return this.deliveryService.updateStatusByAdmin(orderId, payload.status);
  }
}
