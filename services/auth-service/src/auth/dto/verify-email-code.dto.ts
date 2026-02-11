import { IsEmail, Matches } from "class-validator";

export class VerifyEmailCodeDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/)
  code!: string;
}
