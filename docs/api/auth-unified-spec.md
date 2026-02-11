# API Spec: Unified Auth + Email Verification

## Version

Draft v2 (planning finalized, no implementation yet)

## Goals

- Add unified signup/login flow via gateway entrypoints.
- Keep existing API contract stable for current apps and bots.
- Add email verification and profile update endpoints.
- Keep token transport Bearer-only (no cookies).

## Compatibility Contract

These endpoints MUST remain operational:

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

Token format remains JWT Bearer with payload containing:

- `sub` (string, required)
- `role` (string, required)

## Public Gateway Routes (UI)

- `GET /login` -> unified login page
- `GET /signup` -> unified signup page
- `GET /verify-email` -> verification landing page

Role redirects after login:

- Customer -> `/app/customer`
- Courier -> `/app/courier`
- Admin -> `/app/admin`

## API Endpoints (Auth Domain)

### 1) Signup (new unified flow)

`POST /auth/signup`

Request:

```json
{
  "email": "user@example.com",
  "password": "string >= 6",
  "name": "John Doe"
}
```

Notes:

- Self-signup always creates role `Customer`.
- Any public `role` field must be ignored or rejected.

Response (`201`):

```json
{
  "userId": "uuid-or-text-id",
  "email": "user@example.com",
  "role": "Customer",
  "verificationRequired": true
}
```

Errors:

- `400` validation error
- `409` email already exists
- `429` signup rate-limited

### 1.1) Admin-only user creation (for Courier/Admin)

`POST /auth/admin/users`

Auth:

- Requires Bearer token with role `Admin`.

Request:

```json
{
  "email": "courier@example.com",
  "password": "string >= 6",
  "name": "Courier Name",
  "role": "Courier"
}
```

Allowed roles:

- `Courier`
- `Admin`

Response (`201`):

```json
{
  "userId": "uuid-or-text-id",
  "email": "courier@example.com",
  "role": "Courier",
  "verificationRequired": true
}
```

### 2) Login (unified)

`POST /auth/login` (compatible extension) or `POST /auth/login-unified` (alias)

Request:

```json
{
  "email": "user@example.com",
  "password": "password"
}
```

Successful response (`200`):

```json
{
  "accessToken": "jwt",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "role": "Customer"
  }
}
```

Email-not-verified response (`403` when required):

```json
{
  "error": "EMAIL_NOT_VERIFIED",
  "message": "Email verification required"
}
```

Token transport notes:

- API response returns JWT access token.
- Frontend stores Bearer token client-side and performs redirect by role.
- No HTTP-only cookies, no server session cookies.

### 3) Request verification (resend)

`POST /auth/verify-email/resend`

Request:

```json
{
  "email": "user@example.com"
}
```

Response (`202`):

```json
{
  "accepted": true
}
```

Notes:

- Always returns generic success to avoid email enumeration.
- Cooldown + rate limit applied.

### 4) Verify email (numeric code only)

- `POST /auth/verify-email/code`

Request:

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

Response (`200`):

```json
{
  "verified": true
}
```

Errors:

- `400` invalid/expired code
- `429` attempts exceeded

### 5) Profile read/update

Read:

- `GET /auth/profile` (or compatible alias to `/auth/me`)

Update name:

- `PATCH /auth/profile`

Request:

```json
{
  "name": "New Name"
}
```

Change password:

- `PATCH /auth/profile/password`

Request:

```json
{
  "currentPassword": "old",
  "newPassword": "new>=6"
}
```

Responses:

- `200` updated profile
- `401` invalid token/current password
- `400` validation failed

## Headers

- Auth-required endpoints: `Authorization: Bearer <token>`

## Rate Limits (minimum baseline)

- `/auth/signup`: 5/min per IP
- `/auth/login`: 10/min per IP + user key
- `/auth/verify-email/resend`: 3/10min per email
- `/auth/verify-email*`: 10/10min per email/user

## Idempotency and Security Notes

- Verification consume action must be idempotent (second submit returns safe result).
- Store only hashed verification code.
- Avoid exposing whether email exists in resend endpoint.
- Keep error bodies stable for existing clients.
- Six-digit code must have TTL (for example 10 minutes) and attempt limits.

## Backward Compatibility Test Cases

- Existing customer register/login/me flow continues unchanged.
- Existing courier/admin login remains unchanged.
- Existing Telegram bot login flow remains unchanged.
