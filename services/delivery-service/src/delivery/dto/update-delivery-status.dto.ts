import { IsIn } from "class-validator";

export const DELIVERY_STATUSES = ["cooking", "delivery", "done"] as const;

export class UpdateDeliveryStatusDto {
  @IsIn(DELIVERY_STATUSES)
  status!: (typeof DELIVERY_STATUSES)[number];
}
