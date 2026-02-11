import { IsEmail, IsIn, IsString, MinLength } from "class-validator";

const ADMIN_CREATABLE_ROLES = ["Courier", "Admin"] as const;

export class AdminCreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsIn(ADMIN_CREATABLE_ROLES)
  role!: (typeof ADMIN_CREATABLE_ROLES)[number];
}
