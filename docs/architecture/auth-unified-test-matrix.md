# Test Matrix: Unified Auth Rollout

## Status

Planning finalized matrix. To be automated during implementation.

## Legend

- Priority: `P0` critical, `P1` high, `P2` medium
- Type: `E2E`, `API`, `Integration`, `Security`, `Regression`

## Matrix

| ID | Priority | Type | Area | Scenario | Expected |
|---|---|---|---|---|---|
| AUTH-001 | P0 | API | Compatibility | `POST /auth/login` with existing seeded user | 200 + valid `accessToken` + user role |
| AUTH-002 | P0 | API | Compatibility | `GET /auth/me` with existing token | 200 + same user |
| AUTH-003 | P0 | API | Compatibility | `POST /auth/register` old flow | Works unchanged |
| AUTH-004 | P0 | E2E | Unified Signup | `/signup` creates account and requires verification | Verification required response |
| AUTH-004A | P0 | API | Role Policy | Public signup with `role=Admin` or `role=Courier` | 400/403 or ignored to `Customer` only |
| AUTH-005 | P0 | E2E | Verification | Valid six-digit verification code | Account becomes verified |
| AUTH-006 | P0 | E2E | Verification | Expired six-digit verification code | 400/410 with stable error |
| AUTH-007 | P0 | E2E | Unified Login | Verified user logs in at `/login` | Redirect by role to `/app/*` |
| AUTH-007A | P0 | E2E | Verification Gate | Unverified user attempts login | 403 `EMAIL_NOT_VERIFIED`, no token issued |
| AUTH-008 | P0 | E2E | Role Redirect | Customer/Courier/Admin login | Redirect to correct app path |
| AUTH-009 | P0 | Regression | Existing Apps | Legacy direct app login pages still work (dev ports) | No regressions |
| AUTH-010 | P0 | Regression | WS Auth | Orders WS and delivery WS with JWT | Connection accepted (role-based behavior unchanged) |
| AUTH-011 | P0 | Regression | Bots | Customer/courier/admin Telegram bot login | Still works |
| AUTH-012 | P1 | API | Profile | `PATCH /auth/profile` update name | 200 + updated profile |
| AUTH-013 | P1 | API | Profile | `PATCH /auth/profile/password` with correct current password | 200 success |
| AUTH-014 | P1 | API | Profile | Password change with invalid current password | 401/400 stable error |
| AUTH-014A | P1 | API | Admin Provisioning | Admin creates Courier/Admin user via admin endpoint | 201 + target role set correctly |
| AUTH-014B | P1 | API | Admin Provisioning | Non-admin tries to create Courier/Admin | 403 forbidden |
| AUTH-015 | P1 | Security | Verification | Reuse consumed verification code | Safe failure, no state corruption |
| AUTH-016 | P1 | Security | Abuse Control | Resend verification spam | 429 rate limit |
| AUTH-017 | P1 | Security | Enumeration | Resend endpoint for unknown email | Generic response (no leakage) |
| AUTH-018 | P1 | Integration | Gateway | `/login` and `/signup` served through gateway | 200 + correct assets/routes |
| AUTH-019 | P1 | Integration | Gateway Routing | `/app/customer`, `/app/courier`, `/app/admin` deep links | Correct SPA fallback and app load |
| AUTH-020 | P1 | Regression | Admin/Courier Guards | Wrong role token in app | Rejected by app guard |
| AUTH-021 | P2 | Performance | Auth API | Login under moderate burst | Stable latency and no error spikes |
| AUTH-022 | P2 | Observability | Logs/Metrics | signup/login/verify events emitted | Logs + counters visible |
| AUTH-023 | P2 | Rollback | Flags | Turn off unified flags | Legacy flow operational immediately |

## Smoke Flow (Release Gate)

1. Create new customer via unified signup.
2. Verify email.
3. Login and redirect to `/app/customer`.
4. Confirm unverified login is blocked.
5. Place order and receive updates.
6. Create courier/admin from admin-only flow, then login.
7. Confirm old direct app logins still work.

Release proceeds only if all P0 tests pass and no unresolved P1 blockers remain.
