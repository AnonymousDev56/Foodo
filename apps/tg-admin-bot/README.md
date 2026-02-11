# FOODO Admin Telegram Bot

Admin-focused Telegram bot for operational control.

## Features

- `POST /telegram/webhook` webhook endpoint
- Admin login flow (`/start` or `/login` -> email -> password)
- Commands:
  - `/dashboard` — live admin metrics
  - `/orders [status]` — orders list
  - `/order <order_id>` — full order info
  - `/setstatus <order_id> <status>` — force status (`pending|cooking|delivery|done`)
  - `/couriers` — couriers and delivery stats
  - `/assign <order_id> <courier_id>` — manual courier assignment
  - `/products` — low-stock products snapshot
  - `/help` — command help
- Live notifications for new/updated orders via `/orders/ws`
- Fallback polling every 15s

## Required env vars

- `ADMIN_TELEGRAM_BOT_TOKEN` — bot token from BotFather

## Optional env vars

- `PORT` (default: `3009`)
- `ADMIN_TELEGRAM_WEBHOOK_URL` (example: `https://<your-ngrok-domain>`)
- `AUTH_API_URL` (default: `http://127.0.0.1:3001`)
- `ORDERS_API_URL` (default: `http://127.0.0.1:3002`)
- `DELIVERY_API_URL` (default: `http://127.0.0.1:3004`)
- `WAREHOUSE_API_URL` (default: `http://127.0.0.1:3003`)

## Run

```bash
pnpm install
ADMIN_TELEGRAM_BOT_TOKEN=<your_token> pnpm --filter @foodo/tg-admin-bot dev
```

Health check:

```bash
curl http://127.0.0.1:3009/health
```
