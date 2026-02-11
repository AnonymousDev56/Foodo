# FOODO Architecture Overview

## Monorepo layout

- `apps/*` contains three web clients.
- `services/*` contains backend microservices.
- `packages/*` contains shared contracts and UI primitives.
- `infra/*` contains deployment and runtime infrastructure files.

## Current implementation status

- Stage 1: Monorepo scaffold and local dev runtime.
- Stage 2: Customer auth flow (`register/login/me`) with protected routes.
- Stage 3: Customer catalog, cart, checkout, orders list/details.
- Stage 3.1: Catalog filters/categories + order status polling.
- Stage 4: Courier panel and delivery-service integration.
- Stage 5: Admin panel (orders/warehouse/couriers management).
- Stage 6 (in progress):
  - Recommendation engine (`/orders/recommendations`) with weighted scoring (`history/together/popular`).
  - Customer catalog recommendations with context-aware "More like this".
  - Order details "Frequently bought together" block.
  - Lightweight client-side view history to improve recommendation context.
- Stage 7.4: Courier route optimization (greedy / tsp-lite up to 5 stops), dynamic ETA recalculation, and live optimized route analytics in admin dashboard.
- Stage 7.5: ETA calibration and confidence windows (courier bias/reliability profiles, bounded ETA range in customer/courier/admin views).
- Stage 8.1: Customer Telegram bot (`services/telegram-bot`) with webhook and order status notifications.
- Stage 8.2: Courier Telegram bot (`apps/tg-courier-bot`) with login, delivery commands, live updates and fallback polling.
- Stage 8.3: Admin Telegram bot (`apps/tg-admin-bot`) with dashboard/orders/couriers control, manual assignment and admin status overrides.
- Stage 9 (in progress):
  - Phase 1 implemented: DB migration fields for unified auth + verification challenges table.
  - Phase 1 implemented: auth-service endpoints for `signup`, verification (`resend`/`code`), admin-only user creation, and profile updates.
  - Phase 2 implemented: unified gateway auth routes (`/login`, `/signup`, `/verify-email`) + role redirects to `/app/customer|courier|admin`.
  - Phase 2 implemented: gateway SPA routing for `/app/*` with frontend basename support and gateway-aware API/WS clients.
  - Phase 3 implemented: profile pages added to customer/courier/admin apps (`/profile`) with name/password update flows via `PATCH /auth/profile` and `PATCH /auth/profile/password`.
  - Phase 3 implemented: gateway runtime auth guards now redirect unauthenticated `/app/*` access to unified `/login` entry point.
  - Phase 3 implemented: local dev role apps keep direct login compatibility on ports `5173/5174/5175` while gateway auth remains centralized.
  - Legacy compatibility preserved for `register/login/me`.

## Unified Auth Planning Artifacts

- ADR: `docs/architecture/auth-unified-adr.md`
- API spec: `docs/api/auth-unified-spec.md`
- SQL migration plan: `docs/architecture/auth-unified-sql-migration-plan.md`
- Test matrix: `docs/architecture/auth-unified-test-matrix.md`
- Rollback plan: `docs/architecture/auth-unified-rollback-plan.md`

Finalized policy decisions for Stage 9:

- Verification format: six-digit numeric code.
- Self-signup role: `Customer` only.
- `Courier`/`Admin` creation: admin-only flow.
- Unverified users: login blocked until verification.
- Token transport: Bearer token only (no cookies).
- Password hashing: unchanged in this rollout.

## PostgreSQL persistence

All backend services now use PostgreSQL as the source of truth (no in-memory storage in service logic):

- `auth-service` -> users are read/written from `users`.
- `warehouse-service` -> categories/products/stock are read/written from `categories` and `products`.
- `orders-service` -> orders and items are read/written from `orders` and `order_items`, including delivery snapshot fields.
- `delivery-service` -> couriers and routes are read/written from `couriers` and `delivery_routes`.

Schema and seed are managed by SQL migration:

- `infra/postgres/migrations/001_init.sql`

Tables created by migration:

- `users`
- `sessions`
- `categories`
- `products`
- `orders`
- `order_items`
- `couriers`
- `delivery_routes`

Each backend service reads PostgreSQL connection from `DATABASE_URL` (fallback default is `postgresql://foodo:foodo@localhost:5432/foodo`).
On startup, services initialize the shared DB client and run migration+seed bootstrap.

## Production Autostart Stack

- Root `docker-compose.yml` now orchestrates the full runtime stack:
  - PostgreSQL, Redis, RabbitMQ
  - backend services (`auth`, `orders`, `warehouse`, `delivery`, `notification`)
  - Telegram services (`telegram-bot`, `tg-courier-bot`, `tg-admin-bot`, `telegram-router`)
  - frontend services (`web-customer`, `web-courier`, `web-admin`) served via Vite preview
  - `nginx-gateway` (HTTP + WS reverse proxy)
- `db-init` init-container runs `infra/postgres/migrations/001_init.sql` automatically on startup (schema + seed).
- All runtime services expose `/health` and have Docker healthchecks.
- Prod helper scripts:
  - `pnpm start:prod`
  - `pnpm stop:prod`
  - `pnpm logs:prod`

## Telegram integration

- Customer bot: `services/telegram-bot` (customer catalog/cart/checkout/orders).
- Courier bot: `apps/tg-courier-bot` (deliveries/details/accept/pickup/deliver).
- Admin bot: `apps/tg-admin-bot` (dashboard/orders/setstatus/couriers/assign/products).
- All bots expose `POST /telegram/webhook` and can auto-configure webhook if URL env var is provided.
- Webhook router: `services/telegram-router` provides path-based routing so all bots can run behind one public ngrok URL:
  - `/telegram/customer/webhook` -> `http://127.0.0.1:3006/telegram/webhook`
  - `/telegram/courier/webhook` -> `http://127.0.0.1:3007/telegram/webhook`
  - `/telegram/admin/webhook` -> `http://127.0.0.1:3009/telegram/webhook`

## Route Optimization (Stage 7.4)

- `delivery-service` contains `route-optimizer/optimizer.service.ts`.
- Optimizer supports:
  - Greedy nearest-neighbor (default).
  - TSP-lite brute-force mode for up to 5 stops.
- `delivery-service` API extensions:
  - `GET /delivery/route/:courierId` -> assigned orders + optimized order + ETA timeline + totals.
  - `PATCH /delivery/:orderId/recalculate-eta` -> forced route recalculation for courier set.
- Recalculation is triggered on:
  - order assignment / manual reassignment,
  - delivery status transitions.
- Optimized ETA is persisted to PostgreSQL (`delivery_routes`) and synced to `orders-service` delivery snapshots, so:
  - `web-courier` shows ordered stops and route timeline,
  - `web-customer` order details show route-aware optimized ETA,
  - `web-admin` dashboard shows route metrics (`avgRouteLength`, `avgEtaAccuracy`) and active optimized assignments.

## ETA Calibration (Stage 7.5)

- Delivery ETA is now calibrated using courier historical performance:
  - `couriers.eta_bias_factor` adjusts predicted ETA to realistic courier speed.
  - `couriers.eta_reliability_score` tracks prediction confidence (0..100).
  - `couriers.completed_deliveries` stores calibration sample size.
- Each delivery route stores confidence range:
  - `delivery_routes.eta_lower_minutes`
  - `delivery_routes.eta_upper_minutes`
  - `delivery_routes.eta_confidence_score`
- Orders snapshot persists calibrated ETA range:
  - `orders.delivery_eta_lower_minutes`
  - `orders.delivery_eta_upper_minutes`
  - `orders.delivery_eta_confidence_score`
- UI integration:
  - `web-customer` order details show optimized ETA range and confidence.
  - `web-courier` route timeline/cards show ETA range + confidence.
  - `web-admin` live assignments include confidence-aware ETA.
