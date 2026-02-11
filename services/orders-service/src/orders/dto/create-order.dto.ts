import { Type } from "class-transformer";
import {
  IsArray,
  IsNumber,
  IsString,
  Min,
  ValidateNested
} from "class-validator";

export class CreateOrderItemDto {
  @IsString()
  productId!: string;

  @IsString()
  name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  price!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
