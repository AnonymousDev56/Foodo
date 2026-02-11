import { IsEmail, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { ROLES } from "../roles";

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: (typeof ROLES)[number];
}
