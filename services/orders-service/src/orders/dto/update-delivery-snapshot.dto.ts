import { Type } from "class-transformer";
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";

export const DELIVERY_SNAPSHOT_STATUSES = ["assigned", "cooking", "delivery", "done"] as const;

export class UpdateDeliverySnapshotDto {
  @IsString()
  courierId!: string;

  @IsString()
  courierName!: string;

  @IsString()
  address!: string;

  @IsInt()
  @Min(1)
  @Max(240)
  @Type(() => Number)
  etaMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  @Type(() => Number)
  etaLowerMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(300)
  @Type(() => Number)
  etaUpperMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  etaConfidenceScore?: number;

  @IsIn(DELIVERY_SNAPSHOT_STATUSES)
  status!: (typeof DELIVERY_SNAPSHOT_STATUSES)[number];

  @IsString()
  updatedAt!: string;
}
