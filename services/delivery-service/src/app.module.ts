import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { DeliveryModule } from "./delivery/delivery.module";

@Module({
  imports: [DeliveryModule],
  controllers: [AppController]
})
export class AppModule {}
