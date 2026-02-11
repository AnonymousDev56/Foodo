import { IsIn } from "class-validator";

export const DELIVERY_ADMIN_STATUSES = ["assigned", "cooking", "delivery", "done"] as const;

export class UpdateDeliveryAdminStatusDto {
  @IsIn(DELIVERY_ADMIN_STATUSES)
  status!: (typeof DELIVERY_ADMIN_STATUSES)[number];
}
