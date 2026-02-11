import { Type } from "class-transformer";
import {
  IsArray,
  IsNumber,
  IsString,
  Min,
  ValidateNested
} from "class-validator";

class AssignDeliveryItemDto {
  @IsString()
  productId!: string;

  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class AssignDeliveryDto {
  @IsString()
  orderId!: string;

  @IsString()
  userId!: string;

  @IsString()
  address!: string;

  @Type(() => Number)
  @IsNumber()
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  lng!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  total!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssignDeliveryItemDto)
  items!: AssignDeliveryItemDto[];
}

export type AssignDeliveryItem = AssignDeliveryDto["items"][number];
