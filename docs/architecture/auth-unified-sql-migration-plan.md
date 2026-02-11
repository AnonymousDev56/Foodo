# SQL Migration Plan: Unified Auth + Email Verification

## Status

Planning finalized. No migration applied yet.

## Objectives

- Add support for user profile (`name`) and six-digit code email verification.
- Preserve compatibility with existing auth and seeded users.
- Use additive, reversible-safe schema evolution.

## Current Baseline

Existing schema (`infra/postgres/migrations/001_init.sql`) includes:

- `users(id, email, password, role, created_at, updated_at)`
- `sessions(...)`

No profile name, no email verification data.

## Proposed Migration Sequence

## Migration 002: Add user profile + verification fields

DDL (additive):

1. `ALTER TABLE users ADD COLUMN name TEXT;`
2. `ALTER TABLE users ADD COLUMN is_email_verified BOOLEAN NOT NULL DEFAULT FALSE;`
3. `ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMPTZ;`
4. `ALTER TABLE users ADD COLUMN verification_sent_at TIMESTAMPTZ;` (optional)
5. `ALTER TABLE users ADD COLUMN created_by_admin_id TEXT REFERENCES users(id);` (optional audit for admin-created Courier/Admin)
6. `CREATE INDEX idx_users_role_verified ON users(role, is_email_verified);`

Backfill:

1. For existing rows, set `name` from email local-part if null.
2. Mark existing seeded users as verified:
   - `is_email_verified = TRUE`
   - `email_verified_at = NOW()`

Post-backfill tightening:

- Optionally enforce `name` non-null for new writes at service layer first.
- DB-level `NOT NULL` for `name` only after rollout stabilizes.

## Migration 003: Verification challenges table

Create table `email_verifications`:

- `id TEXT PRIMARY KEY`
- `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `email_snapshot TEXT NOT NULL`
- `channel TEXT NOT NULL DEFAULT 'email'`
- `code_hash TEXT NOT NULL` (hash of six-digit code)
- `expires_at TIMESTAMPTZ NOT NULL`
- `consumed_at TIMESTAMPTZ`
- `attempts INTEGER NOT NULL DEFAULT 0`
- `max_attempts INTEGER NOT NULL DEFAULT 5`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Indexes:

- `idx_email_verifications_user_id` on `(user_id)`
- `idx_email_verifications_expires_at` on `(expires_at)`
- Partial index for active verification rows:
  - `(user_id, expires_at)` where `consumed_at IS NULL`

Constraints:

- Optional uniqueness policy to keep one active challenge per user/email.
- Add check/validation at service layer that code is exactly 6 digits before hashing.

## Migration 004 (optional): Password storage hardening

Current passwords are plain text in DB. For safe auth expansion:

- Add `password_hash TEXT`
- Backfill from existing passwords during controlled migration job
- Switch auth reads to hash
- Remove plain password column in later major migration (not in this rollout)

Note: This step is strongly recommended for production security, but can be staged separately to reduce blast radius.

## Role Policy Enforcement

- Public signup path writes only `role='Customer'`.
- Creation of `Courier` or `Admin` records is allowed only from admin-authorized service path.
- DB-level `CHECK` can enforce allowed enum values, while access policy remains at service layer.

## Data Retention & Cleanup

- Periodic cleanup job:
  - Delete expired verification rows older than retention window (e.g. 7-30 days).
- Keep audit-safe minimal metadata where needed.

## Rollout Safety Rules

- No destructive change in initial rollout.
- No table/column rename required in first phase.
- Existing login/me queries must continue to work after migration.
- Existing seeded accounts must remain login-capable immediately.
- Unverified accounts must be denied token issuance when `EMAIL_VERIFICATION_REQUIRED=true`.

## Rollback Strategy (Schema)

Schema rollback is logical (feature flags) first:

1. Disable unified auth and verification flags.
2. Keep additive columns/tables in place (do not drop immediately).

Physical rollback (drop columns/tables) only after full postmortem and explicit downtime window.

## Validation Checklist Before Apply

- Migration dry-run on local copy.
- Verify seed users still log in.
- Verify `register/login/me` unchanged responses.
- Verify indexes created successfully.
- Verify verification table write/read throughput under rate-limit tests.
