import type { DbExecutor } from "@foodo/shared-db";
import type { Role } from "./roles";

type TimestampLike = string | Date;

export interface AuthUserRecord {
  id: string;
  email: string;
  password: string;
  role: Role;
  name: string | null;
  isEmailVerified: boolean;
  emailVerifiedAt: TimestampLike | null;
  verificationSentAt: TimestampLike | null;
  createdByAdminId: string | null;
}

interface CreateAuthUserInput {
  id: string;
  email: string;
  password: string;
  role: Role;
  name?: string | null;
  isEmailVerified?: boolean;
  emailVerifiedAt?: Date | null;
  createdByAdminId?: string | null;
}

export interface EmailVerificationRecord {
  id: string;
  userId: string;
  emailSnapshot: string;
  codeHash: string;
  expiresAt: TimestampLike;
  consumedAt: TimestampLike | null;
  attempts: number;
  maxAttempts: number;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

interface CreateEmailVerificationInput {
  id: string;
  userId: string;
  emailSnapshot: string;
  codeHash: string;
  expiresAt: Date;
  maxAttempts?: number;
}

export class AuthRepository {
  constructor(private readonly db: DbExecutor) {}

  async withTransaction<T>(fn: (txRepo: AuthRepository) => Promise<T>) {
    const dbWithTx = this.db as DbExecutor & {
      transaction?: <U>(txFn: (tx: DbExecutor) => Promise<U>) => Promise<U>;
    };
    if (!dbWithTx.transaction) {
      return fn(this);
    }

    return dbWithTx.transaction((tx) => fn(new AuthRepository(tx)));
  }

  async findByEmail(email: string) {
    const result = await this.db.query<AuthUserRecord>(
      `SELECT id,
              email,
              password,
              role,
              name,
              is_email_verified AS "isEmailVerified",
              email_verified_at AS "emailVerifiedAt",
              verification_sent_at AS "verificationSentAt",
              created_by_admin_id AS "createdByAdminId"
         FROM users
        WHERE email = $1
        LIMIT 1`,
      [email]
    );

    return result.rows[0] ?? null;
  }

  async findById(id: string) {
    const result = await this.db.query<AuthUserRecord>(
      `SELECT id,
              email,
              password,
              role,
              name,
              is_email_verified AS "isEmailVerified",
              email_verified_at AS "emailVerifiedAt",
              verification_sent_at AS "verificationSentAt",
              created_by_admin_id AS "createdByAdminId"
         FROM users
        WHERE id = $1
        LIMIT 1`,
      [id]
    );

    return result.rows[0] ?? null;
  }

  async createUser(input: CreateAuthUserInput) {
    const result = await this.db.query<AuthUserRecord>(
      `INSERT INTO users (
          id,
          email,
          password,
          role,
          name,
          is_email_verified,
          email_verified_at,
          created_by_admin_id
        )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id,
                 email,
                 password,
                 role,
                 name,
                 is_email_verified AS "isEmailVerified",
                 email_verified_at AS "emailVerifiedAt",
                 verification_sent_at AS "verificationSentAt",
                 created_by_admin_id AS "createdByAdminId"`,
      [
        input.id,
        input.email,
        input.password,
        input.role,
        input.name ?? null,
        input.isEmailVerified ?? false,
        input.emailVerifiedAt ?? null,
        input.createdByAdminId ?? null
      ]
    );

    return result.rows[0];
  }

  async updateUserName(userId: string, name: string) {
    const result = await this.db.query<AuthUserRecord>(
      `UPDATE users
          SET name = $2,
              updated_at = NOW()
        WHERE id = $1
      RETURNING id,
                email,
                password,
                role,
                name,
                is_email_verified AS "isEmailVerified",
                email_verified_at AS "emailVerifiedAt",
                verification_sent_at AS "verificationSentAt",
                created_by_admin_id AS "createdByAdminId"`,
      [userId, name]
    );

    return result.rows[0] ?? null;
  }

  async updateUserPassword(userId: string, password: string) {
    const result = await this.db.query<AuthUserRecord>(
      `UPDATE users
          SET password = $2,
              updated_at = NOW()
        WHERE id = $1
      RETURNING id,
                email,
                password,
                role,
                name,
                is_email_verified AS "isEmailVerified",
                email_verified_at AS "emailVerifiedAt",
                verification_sent_at AS "verificationSentAt",
                created_by_admin_id AS "createdByAdminId"`,
      [userId, password]
    );

    return result.rows[0] ?? null;
  }

  async markUserVerified(userId: string) {
    const result = await this.db.query<AuthUserRecord>(
      `UPDATE users
          SET is_email_verified = TRUE,
              email_verified_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
      RETURNING id,
                email,
                password,
                role,
                name,
                is_email_verified AS "isEmailVerified",
                email_verified_at AS "emailVerifiedAt",
                verification_sent_at AS "verificationSentAt",
                created_by_admin_id AS "createdByAdminId"`,
      [userId]
    );

    return result.rows[0] ?? null;
  }

  async touchVerificationSentAt(userId: string) {
    await this.db.query(
      `UPDATE users
          SET verification_sent_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [userId]
    );
  }

  async createEmailVerification(input: CreateEmailVerificationInput) {
    const result = await this.db.query<EmailVerificationRecord>(
      `INSERT INTO email_verifications (
          id,
          user_id,
          email_snapshot,
          code_hash,
          expires_at,
          max_attempts
        )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id,
                 user_id AS "userId",
                 email_snapshot AS "emailSnapshot",
                 code_hash AS "codeHash",
                 expires_at AS "expiresAt",
                 consumed_at AS "consumedAt",
                 attempts,
                 max_attempts AS "maxAttempts",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [
        input.id,
        input.userId,
        input.emailSnapshot,
        input.codeHash,
        input.expiresAt,
        input.maxAttempts ?? 5
      ]
    );

    return result.rows[0];
  }

  async findLatestActiveVerificationForUser(userId: string) {
    const result = await this.db.query<EmailVerificationRecord>(
      `SELECT id,
              user_id AS "userId",
              email_snapshot AS "emailSnapshot",
              code_hash AS "codeHash",
              expires_at AS "expiresAt",
              consumed_at AS "consumedAt",
              attempts,
              max_attempts AS "maxAttempts",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
         FROM email_verifications
        WHERE user_id = $1
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );

    return result.rows[0] ?? null;
  }

  async invalidateActiveVerifications(userId: string) {
    await this.db.query(
      `UPDATE email_verifications
          SET consumed_at = NOW(),
              updated_at = NOW()
        WHERE user_id = $1
          AND consumed_at IS NULL`,
      [userId]
    );
  }

  async incrementVerificationAttempts(id: string) {
    const result = await this.db.query<EmailVerificationRecord>(
      `UPDATE email_verifications
          SET attempts = attempts + 1,
              updated_at = NOW()
        WHERE id = $1
      RETURNING id,
                user_id AS "userId",
                email_snapshot AS "emailSnapshot",
                code_hash AS "codeHash",
                expires_at AS "expiresAt",
                consumed_at AS "consumedAt",
                attempts,
                max_attempts AS "maxAttempts",
                created_at AS "createdAt",
                updated_at AS "updatedAt"`,
      [id]
    );

    return result.rows[0] ?? null;
  }

  async consumeVerification(id: string) {
    await this.db.query(
      `UPDATE email_verifications
          SET consumed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
          AND consumed_at IS NULL`,
      [id]
    );
  }
}
