import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { NotificationModule } from "./notification/notification.module";

@Module({
  imports: [NotificationModule],
  controllers: [AppController]
})
export class AppModule {}
