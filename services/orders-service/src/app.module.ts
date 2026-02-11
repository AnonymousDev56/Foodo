import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { OrdersModule } from "./orders/orders.module";

@Module({
  imports: [OrdersModule],
  controllers: [AppController]
})
export class AppModule {}
