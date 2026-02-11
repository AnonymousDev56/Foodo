import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException
} from "@nestjs/common";
import { createDatabaseClient } from "@foodo/shared-db";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { AdminCreateUserDto } from "./dto/admin-create-user.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ResendVerificationDto } from "./dto/resend-verification.dto";
import { SignupDto } from "./dto/signup.dto";
import { UpdatePasswordDto } from "./dto/update-password.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { VerifyEmailCodeDto } from "./dto/verify-email-code.dto";
import { AuthRepository, type AuthUserRecord } from "./auth.repository";
import type { Role } from "./roles";

interface AuthJwtPayload {
  sub: string;
}

export interface SignupResult {
  userId: string;
  email: string;
  role: Role;
  verificationRequired: boolean;
  devVerificationCode?: string;
}

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly db = createDatabaseClient("auth-service");
  private readonly repository = new AuthRepository(this.db);
  private readonly jwtService: JwtService;
  private readonly verificationCodeTtlMinutes = this.parsePositiveInteger(
    process.env.EMAIL_VERIFICATION_CODE_TTL_MINUTES,
    10
  );
  private readonly verificationResendCooldownSeconds = this.parsePositiveInteger(
    process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    30
  );
  private readonly verificationMaxAttempts = this.parsePositiveInteger(
    process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS,
    5
  );
  private readonly emailVerificationEnabled = this.parseBoolean(
    process.env.EMAIL_VERIFICATION_ENABLED,
    true
  );
  private readonly emailVerificationRequired = this.parseBoolean(
    process.env.EMAIL_VERIFICATION_REQUIRED,
    true
  );
  private readonly exposeDevVerificationCode = this.parseBoolean(
    process.env.AUTH_DEV_EXPOSE_VERIFICATION_CODE,
    process.env.NODE_ENV !== "production"
  );

  constructor(@Inject(JwtService) jwtService: JwtService) {
    this.jwtService = jwtService;
  }

  async onModuleInit() {
    await this.db.init();
  }

  async onModuleDestroy() {
    await this.db.close();
  }

  async register(dto: RegisterDto) {
    const email = this.normalizeEmail(dto.email);
    const exists = await this.repository.findByEmail(email);
    if (exists) {
      throw new ConflictException("User already exists");
    }

    const user = await this.repository.createUser({
      id: randomUUID(),
      email,
      password: dto.password,
      role: "Customer",
      name: this.normalizeName(dto.name) ?? this.defaultNameFromEmail(email),
      isEmailVerified: true,
      emailVerifiedAt: new Date()
    });
    return this.createAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.repository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (user.password !== dto.password) {
      throw new UnauthorizedException("Invalid credentials");
    }
    if (this.emailVerificationEnabled && this.emailVerificationRequired && !user.isEmailVerified) {
      throw new ForbiddenException({
        error: "EMAIL_NOT_VERIFIED",
        message: "Email verification required"
      });
    }

    return this.createAuthResponse(user);
  }

  async signup(dto: SignupDto): Promise<SignupResult> {
    const email = this.normalizeEmail(dto.email);
    const exists = await this.repository.findByEmail(email);
    if (exists) {
      throw new ConflictException("User already exists");
    }

    const verificationRequired = this.emailVerificationEnabled;
    let devVerificationCode: string | undefined;
    const userId = randomUUID();

    const user = await this.repository.withTransaction(async (tx) => {
      const created = await tx.createUser({
        id: userId,
        email,
        password: dto.password,
        role: "Customer",
        name: this.normalizeName(dto.name) ?? this.defaultNameFromEmail(email),
        isEmailVerified: !verificationRequired,
        emailVerifiedAt: verificationRequired ? null : new Date()
      });

      if (verificationRequired) {
        devVerificationCode = await this.issueVerificationCode(created, tx);
      }

      return created;
    });

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      verificationRequired,
      ...this.maybeExposeVerificationCode(devVerificationCode)
    };
  }

  async createUserByAdmin(
    dto: AdminCreateUserDto,
    authorization?: string
  ): Promise<SignupResult> {
    const actor = await this.requireUserFromAuthorization(authorization);
    if (actor.role !== "Admin") {
      throw new ForbiddenException("Admin role is required");
    }

    const email = this.normalizeEmail(dto.email);
    const exists = await this.repository.findByEmail(email);
    if (exists) {
      throw new ConflictException("User already exists");
    }

    const verificationRequired = this.emailVerificationEnabled;
    let devVerificationCode: string | undefined;

    const user = await this.repository.withTransaction(async (tx) => {
      const created = await tx.createUser({
        id: randomUUID(),
        email,
        password: dto.password,
        role: dto.role,
        name: this.normalizeName(dto.name) ?? this.defaultNameFromEmail(email),
        isEmailVerified: !verificationRequired,
        emailVerifiedAt: verificationRequired ? null : new Date(),
        createdByAdminId: actor.id
      });

      if (verificationRequired) {
        devVerificationCode = await this.issueVerificationCode(created, tx);
      }

      return created;
    });

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      verificationRequired,
      ...this.maybeExposeVerificationCode(devVerificationCode)
    };
  }

  async resendVerificationCode(dto: ResendVerificationDto) {
    if (!this.emailVerificationEnabled) {
      return { accepted: true };
    }

    const email = this.normalizeEmail(dto.email);
    const user = await this.repository.findByEmail(email);
    if (!user || user.isEmailVerified) {
      return { accepted: true };
    }

    const active = await this.repository.findLatestActiveVerificationForUser(user.id);
    if (active) {
      const elapsedMs = Date.now() - this.toDate(active.createdAt).getTime();
      if (elapsedMs < this.verificationResendCooldownSeconds * 1000) {
        return { accepted: true };
      }
    }

    const verificationCode = await this.issueVerificationCode(user, this.repository);
    return {
      accepted: true,
      ...this.maybeExposeVerificationCode(verificationCode)
    };
  }

  async verifyEmailCode(dto: VerifyEmailCodeDto) {
    if (!this.emailVerificationEnabled) {
      return { verified: true };
    }

    const email = this.normalizeEmail(dto.email);
    const user = await this.repository.findByEmail(email);
    if (!user) {
      throw new BadRequestException("Invalid or expired verification code");
    }
    if (user.isEmailVerified) {
      return { verified: true };
    }

    const challenge = await this.repository.findLatestActiveVerificationForUser(user.id);
    if (!challenge) {
      throw new BadRequestException("Invalid or expired verification code");
    }

    const now = Date.now();
    if (this.toDate(challenge.expiresAt).getTime() <= now) {
      await this.repository.consumeVerification(challenge.id);
      throw new BadRequestException("Invalid or expired verification code");
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      await this.repository.consumeVerification(challenge.id);
      throw new BadRequestException("Invalid or expired verification code");
    }

    const requestedHash = this.hashVerificationCode(dto.code);
    if (!this.safeHashEqual(requestedHash, challenge.codeHash)) {
      const updated = await this.repository.incrementVerificationAttempts(challenge.id);
      if (updated && updated.attempts >= updated.maxAttempts) {
        await this.repository.consumeVerification(updated.id);
      }
      throw new BadRequestException("Invalid or expired verification code");
    }

    await this.repository.withTransaction(async (tx) => {
      await tx.consumeVerification(challenge.id);
      await tx.markUserVerified(user.id);
    });

    return { verified: true };
  }

  async me(authorization?: string) {
    const user = await this.requireUserFromAuthorization(authorization);
    return this.toPublicUser(user);
  }

  async profile(authorization?: string) {
    const user = await this.requireUserFromAuthorization(authorization);
    return this.toPublicUser(user);
  }

  async updateProfile(dto: UpdateProfileDto, authorization?: string) {
    const user = await this.requireUserFromAuthorization(authorization);
    const normalizedName = this.normalizeName(dto.name);
    if (!normalizedName) {
      throw new BadRequestException("Name is required");
    }

    const updated = await this.repository.updateUserName(user.id, normalizedName);
    if (!updated) {
      throw new UnauthorizedException("User not found");
    }

    return this.toPublicUser(updated);
  }

  async updatePassword(dto: UpdatePasswordDto, authorization?: string) {
    const user = await this.requireUserFromAuthorization(authorization);
    if (user.password !== dto.currentPassword) {
      throw new UnauthorizedException("Invalid current password");
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException("New password must be different");
    }

    await this.repository.updateUserPassword(user.id, dto.newPassword);
    return { updated: true };
  }

  private async createAuthResponse(user: AuthUserRecord) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role
    });

    return {
      accessToken,
      user: this.toPublicUser(user)
    };
  }

  private toPublicUser(user: AuthUserRecord) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      isEmailVerified: user.isEmailVerified,
      emailVerifiedAt: user.emailVerifiedAt
    };
  }

  private async requireUserFromAuthorization(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    try {
      const payload = await this.jwtService.verifyAsync<AuthJwtPayload>(token);
      const user = await this.repository.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException("User not found");
      }

      return user;
    } catch {
      throw new UnauthorizedException("Invalid token");
    }
  }

  private async issueVerificationCode(user: AuthUserRecord, repository: AuthRepository) {
    const code = this.generateVerificationCode();
    const codeHash = this.hashVerificationCode(code);
    const expiresAt = new Date(Date.now() + this.verificationCodeTtlMinutes * 60 * 1000);

    await repository.invalidateActiveVerifications(user.id);
    await repository.createEmailVerification({
      id: randomUUID(),
      userId: user.id,
      emailSnapshot: user.email,
      codeHash,
      expiresAt,
      maxAttempts: this.verificationMaxAttempts
    });
    await repository.touchVerificationSentAt(user.id);

    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[auth-service] verification code for ${user.email}: ${code} (ttl=${this.verificationCodeTtlMinutes}m)`
      );
    } else {
      console.log(`[auth-service] verification challenge created for ${user.email}`);
    }

    return code;
  }

  private normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }

  private normalizeName(value?: string | null) {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private defaultNameFromEmail(email: string) {
    const localPart = email.split("@")[0] ?? "user";
    return localPart.replace(/[._-]+/g, " ").trim() || "User";
  }

  private parseBoolean(value: string | undefined, fallback: boolean) {
    if (value === undefined) {
      return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    return fallback;
  }

  private parsePositiveInteger(value: string | undefined, fallback: number) {
    if (!value) {
      return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private generateVerificationCode() {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
  }

  private hashVerificationCode(code: string) {
    return createHash("sha256").update(code).digest("hex");
  }

  private safeHashEqual(left: string, right: string) {
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");
    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private toDate(value: string | Date) {
    return value instanceof Date ? value : new Date(value);
  }

  private maybeExposeVerificationCode(code?: string) {
    if (!code || !this.exposeDevVerificationCode) {
      return {};
    }
    return { devVerificationCode: code };
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization) {
      return null;
    }

    const [type, token] = authorization.split(" ");
    if (type !== "Bearer" || !token) {
      return null;
    }

    return token;
  }
}
