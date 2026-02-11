import { IsString } from "class-validator";
import { AssignDeliveryDto } from "./assign-delivery.dto";

export class AssignManualDeliveryDto extends AssignDeliveryDto {
  @IsString()
  courierId!: string;
}
