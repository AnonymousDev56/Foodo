import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { WarehouseModule } from "./warehouse/warehouse.module";

@Module({
  imports: [WarehouseModule],
  controllers: [AppController]
})
export class AppModule {}
