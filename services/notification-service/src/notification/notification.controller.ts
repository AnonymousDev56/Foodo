import { Controller, Get, Inject } from "@nestjs/common";
import { NotificationService } from "./notification.service";

@Controller("notifications")
export class NotificationController {
  private readonly notificationService: NotificationService;

  constructor(@Inject(NotificationService) notificationService: NotificationService) {
    this.notificationService = notificationService;
  }

  @Get("ping")
  ping() {
    return this.notificationService.ping();
  }
}
