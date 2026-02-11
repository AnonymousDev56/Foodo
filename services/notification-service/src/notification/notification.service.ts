import { Injectable } from "@nestjs/common";

@Injectable()
export class NotificationService {
  ping() {
    return {
      message: "Notification service scaffolded"
    };
  }
}
