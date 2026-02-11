import { IsIn } from "class-validator";

export const ORDER_STATUSES = ["pending", "cooking", "delivery", "done"] as const;

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES)
  status!: (typeof ORDER_STATUSES)[number];
}
