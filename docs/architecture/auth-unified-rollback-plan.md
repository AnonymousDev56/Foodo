# Rollback Plan: Unified Auth + Email Verification

## Purpose

Provide a fast and safe rollback path if unified auth rollout causes production issues.

## Rollback Triggers

Immediate rollback if any of these happen:

- Login success rate drops below threshold
- Redirect loops or app lockout by role
- Widespread token validation failures on API/WS
- Verification flow blocks legitimate sign-ins unexpectedly
- Critical Telegram bot auth regressions
- Incorrect role provisioning (public users getting privileged roles)

## Rollback Principle

Prefer logical rollback (feature flags + routing) over schema rollback.

## Controls (Must Exist Before Rollout)

- `UNIFIED_AUTH_ENABLED`
- `EMAIL_VERIFICATION_ENABLED`
- `EMAIL_VERIFICATION_REQUIRED`
- `SELF_SIGNUP_ROLE_POLICY=customer-only`
- Legacy login routes kept available

## Fast Rollback Procedure (Target < 10 min)

1. Disable unified flow flags:
   - `UNIFIED_AUTH_ENABLED=false`
   - `EMAIL_VERIFICATION_REQUIRED=false`
   - `SELF_SIGNUP_ROLE_POLICY=customer-only` (keep strict policy if signup remains enabled)
2. Keep verification optional:
   - `EMAIL_VERIFICATION_ENABLED` may remain on for background checks if harmless.
3. Route `/login` and `/signup` back to legacy app login pages or static fallback.
4. Keep existing `/auth/login`, `/auth/register`, `/auth/me` as primary paths.
5. Restart impacted services/gateway.
6. Run smoke checks:
   - customer login
   - courier login
   - admin login
   - `/auth/me`
   - orders/delivery WS connect

## Data Rollback Policy

- Do NOT drop new columns/tables during emergency rollback.
- Additive schema remains inert while flags are off.
- Preserve verification records for diagnostics.
- Do not change password hashing strategy during rollback.

## Communication Plan

- Announce rollback start in incident channel.
- Publish user impact and ETA updates every 15 minutes.
- After restore, publish resolution summary and next steps.

## Post-Rollback Checklist

- Confirm login success and API auth rates normalized.
- Capture failing requests, logs, and metrics snapshot.
- Open follow-up issue with root cause and fix plan.
- Require new canary wave before retrying rollout.

## Rollback Validation Commands (Template)

- `pnpm health`
- Auth checks:
  - `POST /auth/login`
  - `GET /auth/me`
  - `POST /auth/signup` returns `Customer` role only
  - unverified login returns `403 EMAIL_NOT_VERIFIED` only when required flag is on
- Web checks:
  - customer/courier/admin login pages and protected routes
- WS checks:
  - `/orders/ws`
  - `/delivery/ws`
