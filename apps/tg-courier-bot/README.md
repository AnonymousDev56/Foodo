# FOODO Courier Telegram Bot

Courier-focused Telegram bot for delivery operations.

## Features

- `POST /telegram/webhook` webhook endpoint
- Courier login flow (`/start` or `/login` -> email -> password)
- Commands:
  - `/deliveries` — list active courier deliveries
  - `/details <order_id>` — full delivery details
  - `/accept <order_id>` — `assigned -> cooking`
  - `/pickup <order_id>` — `cooking -> delivery`
  - `/deliver <order_id>` — `delivery -> done`
  - `/help` — concise command help
- Live updates via `delivery-service` WebSocket (`/delivery/ws`)
- Fallback polling every 15s when updates are missed or WS reconnects

## Required env vars

- `COURIER_TELEGRAM_BOT_TOKEN` — bot token from BotFather

## Optional env vars

- `PORT` (default: `3007`)
- `COURIER_TELEGRAM_WEBHOOK_URL` (example: `https://<your-ngrok-domain>`)
- `AUTH_API_URL` (default: `http://127.0.0.1:3001`)
- `DELIVERY_API_URL` (default: `http://127.0.0.1:3004`)
- `ORDERS_API_URL` (default: `http://127.0.0.1:3002`)

## Run locally

From repo root:

```bash
pnpm install
COURIER_TELEGRAM_BOT_TOKEN=<your_token> pnpm --filter @foodo/tg-courier-bot dev
```

Health check:

```bash
curl http://127.0.0.1:3007/health
```

## Webhook setup

If `COURIER_TELEGRAM_WEBHOOK_URL` is set before startup, webhook is configured automatically.

Manual setup:

```bash
curl -sS "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<your-domain>/telegram/webhook"
curl -sS "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```
