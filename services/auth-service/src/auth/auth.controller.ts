import { Body, Controller, Get, Headers, Inject, Patch, Post } from "@nestjs/common";
import { AdminCreateUserDto } from "./dto/admin-create-user.dto";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { SignupDto } from "./dto/signup.dto";
import { UpdatePasswordDto } from "./dto/update-password.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { VerifyEmailCodeDto } from "./dto/verify-email-code.dto";

@Controller("auth")
export class AuthController {
  private readonly authService: AuthService;

  constructor(@Inject(AuthService) authService: AuthService) {
    this.authService = authService;
  }

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("login-unified")
  loginUnified(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("signup")
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post("admin/users")
  createUserByAdmin(
    @Body() dto: AdminCreateUserDto,
    @Headers("authorization") authorization?: string
  ) {
    return this.authService.createUserByAdmin(dto, authorization);
  }

  @Post("verify-email/resend")
  resendVerificationCode(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationCode(dto);
  }

  @Post("verify-email/code")
  verifyEmailCode(@Body() dto: VerifyEmailCodeDto) {
    return this.authService.verifyEmailCode(dto);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.me(authorization);
  }

  @Get("profile")
  profile(@Headers("authorization") authorization?: string) {
    return this.authService.profile(authorization);
  }

  @Patch("profile")
  updateProfile(
    @Body() dto: UpdateProfileDto,
    @Headers("authorization") authorization?: string
  ) {
    return this.authService.updateProfile(dto, authorization);
  }

  @Patch("profile/password")
  updatePassword(
    @Body() dto: UpdatePasswordDto,
    @Headers("authorization") authorization?: string
  ) {
    return this.authService.updatePassword(dto, authorization);
  }
}
