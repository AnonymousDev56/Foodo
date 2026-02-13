# FOODO

FOODO monorepo:

- Backend microservices: NestJS + TypeScript
- Frontend apps: React + Vite + Tailwind
- Bots: Telegram (customer/courier/admin)
- Infra: PostgreSQL + Redis + RabbitMQ + NGINX gateway
- Monorepo: pnpm workspaces + turborepo

## Dev Mode

```bash
pnpm install
pnpm dev
```

`pnpm dev` loads `.env.local`, can auto-start ngrok, and can sync Telegram webhooks.

## Production Autostart

Single command startup:

```bash
pnpm start:prod
```

`pnpm start:prod` loads `.env.local` (if present), builds images, starts all containers (infra + backend + bots + frontend), then syncs Telegram webhooks.

Alternative (direct compose, same stack):

```bash
docker compose up -d --build
```

Or compatibility path:

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build
```

Stop:

```bash
pnpm stop:prod
```

Logs:

```bash
pnpm logs:prod
pnpm logs:prod orders-service
```

## What starts automatically in prod

- PostgreSQL, Redis, RabbitMQ
- `db-init` init-container:
  - waits for PostgreSQL
  - applies SQL migration `infra/postgres/migrations/001_init.sql`
  - runs idempotent seed data from the same file
- backend services:
  - `auth-service` (`3001`)
  - `orders-service` (`3002`)
  - `warehouse-service` (`3003`)
  - `delivery-service` (`3004`)
  - `notification-service` (`3005`)
- Telegram services:
  - `telegram-bot` (`3006`)
  - `tg-courier-bot` (`3007`)
  - `telegram-router` (`3008`)
  - `tg-admin-bot` (`3009`)
- Frontend services (Vite preview):
  - `web-customer` (`5173`)
  - `web-courier` (`5174`)
  - `web-admin` (`5175`)
- `nginx-gateway` (`8080`) with HTTP + WebSocket proxy

All services have Docker healthchecks.

## Health and verification

Check container state:

```bash
docker compose ps
```

Check FOODO service health endpoints:

```bash
pnpm health
```

Run automated critical smoke flow (login -> order -> courier assignment -> done):

```bash
pnpm smoke:critical
```

## Release Management

Release artifacts and process docs:

- `CHANGELOG.md`
- `docs/release/checklist.md`
- `docs/release/tagging.md`
- `.github/RELEASE_TEMPLATE.md`

Release gate (required before tag):

```bash
pnpm release:check
```

Create release tag (annotated):

```bash
pnpm release:tag -- v0.9.0
git push origin main
git push origin v0.9.0
```

## CI/CD Pipelines

GitHub Actions workflows:

- `CI` (`.github/workflows/ci.yml`)
  - `lint`
  - `typecheck`
  - `build`
  - `smoke-critical`
  - `publish-image` (push to GHCR on `main` and `v*` tags)
- `Deploy (Manual)` (`.github/workflows/deploy.yml`)
  - manual deploy via SSH (`workflow_dispatch`)

Published image format:

- `ghcr.io/<owner>/foodo-monorepo:<tag>`

Manual deploy uses `FOODO_MONOREPO_IMAGE` in compose and expects these repo secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_PATH`
- `GHCR_USERNAME`
- `GHCR_TOKEN`

Check gateway health:

```bash
curl http://127.0.0.1:8080/health
```

Open frontend apps:

- Customer: `http://127.0.0.1:5173`
- Courier: `http://127.0.0.1:5174`
- Admin: `http://127.0.0.1:5175`

Unified gateway entrypoints:

- Login: `http://127.0.0.1:8080/login`
- Signup: `http://127.0.0.1:8080/signup`
- Verify email: `http://127.0.0.1:8080/verify-email`
- Customer app: `http://127.0.0.1:8080/app/customer`
- Courier app: `http://127.0.0.1:8080/app/courier`
- Admin app: `http://127.0.0.1:8080/app/admin`

## Telegram notes

- Bot services auto-start in Docker.
- To process real Telegram updates, tokens must be set in environment (`TELEGRAM_BOT_TOKEN`, `COURIER_TELEGRAM_BOT_TOKEN`, `ADMIN_TELEGRAM_BOT_TOKEN`).
- Router endpoints:
  - `/telegram/customer/webhook`
  - `/telegram/courier/webhook`
  - `/telegram/admin/webhook`

## WSL Docker note

If `docker` is missing in WSL PATH, project scripts use fallback binary:

`/mnt/wsl/docker-desktop/cli-tools/usr/bin/docker`

## Video Demo
https://drive.google.com/file/d/1bP_YlJd8DJY0iUqMatW50SfnRPdxzs-G/view?usp=sharing

