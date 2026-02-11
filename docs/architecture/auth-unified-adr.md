# ADR: Unified Auth Through Gateway

## Status

Accepted (planning finalized, implementation pending)

## Date

2026-02-10

## Context

FOODO currently has:

- Separate frontend auth screens per app (`web-customer`, `web-courier`, `web-admin`)
- `auth-service` with `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- JWT-based access token used by backend services and WS channels (claims include `sub`, `role`)
- NGINX gateway as reverse proxy for APIs and WebSocket routes

We need unified login/signup via gateway routes (`/login`, `/signup`) and email verification, while preserving the microservices model and avoiding regressions.

## Decision

Adopt an additive migration strategy with compatibility-first rollout:

1. Keep `auth-service` as the token issuer and identity source.
2. Keep existing auth API contract working (`/auth/register`, `/auth/login`, `/auth/me`).
3. Add unified auth flow through gateway public entrypoints and shared UI auth shell.
4. Add email verification with six-digit numeric code.
5. Add profile update capabilities (`name`, password update flow) in auth layer only.
6. Preserve existing role-based access checks in frontends and services.
7. Introduce feature flags for staged rollout and instant rollback.
8. Enforce role policy:
   - self-signup can create only `Customer`
   - `Courier` and `Admin` can be created only by authenticated `Admin`
9. Block login for unverified users when verification is required.
10. Use Bearer-token flow only (no cookies).

## Scope

In scope:

- Unified gateway auth UX routes and redirects
- Email-based registration with name/password/email
- Email verification (six-digit code)
- Role-based redirects:
  - Customer -> `/app/customer`
  - Courier -> `/app/courier`
  - Admin -> `/app/admin`
- Profile page/update flow

Out of scope:

- Rewriting non-auth business logic in orders/warehouse/delivery
- Replacing JWT with a different auth model
- Breaking existing local dev on direct app ports

## Compatibility Rules (Hard Constraints)

- Existing auth endpoints remain available and behavior-compatible.
- JWT claims must continue to include `sub` and `role`.
- Existing Bearer-token-based API and WebSocket authorization must keep working.
- Telegram bots continue using existing login paths until explicitly migrated.
- Signup endpoint cannot issue privileged roles from public traffic.
- Unverified users cannot obtain access tokens when verification is required.

## Design Notes

- Gateway is single public entrypoint in unified mode; local dev still allows direct app ports.
- New auth fields in DB are additive (no destructive schema changes).
- Verification enforcement can be toggled by flag to avoid hard cutover risk.
- Public signup role is fixed to `Customer`.
- Bearer token is returned by auth API and stored client-side; redirects stay path-based.
- No cookie session is introduced.

## Feature Flags

- `UNIFIED_AUTH_ENABLED` (default `false`)
- `EMAIL_VERIFICATION_ENABLED` (default `false`)
- `EMAIL_VERIFICATION_REQUIRED` (default `false`)
- `SELF_SIGNUP_ROLE_POLICY=customer-only` (fixed)

## Risks

- Redirect loops between gateway and app routes
- Inconsistent token storage across current app auth contexts
- Verification UX edge cases (expired/reused tokens)
- Email provider outages affecting signup completion

## Mitigations

- Compatibility rollout in waves with canary
- Add fallback to legacy auth screens
- Idempotent verification endpoints
- Retry/backoff and resend limits for verification
- Explicit rollback runbook and flags

## Rollout Gate

Implementation starts only after:

- API spec signed off
- SQL migration plan signed off
- Test matrix approved
- Rollback plan approved
