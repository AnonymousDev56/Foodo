import { Module } from "@nestjs/common";
import { DeliveryController } from "./delivery.controller";
import { DeliveryService } from "./delivery.service";
import { RouteOptimizerService } from "./route-optimizer/optimizer.service";

@Module({
  controllers: [DeliveryController],
  providers: [DeliveryService, RouteOptimizerService]
})
export class DeliveryModule {}
