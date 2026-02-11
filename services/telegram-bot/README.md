# FOODO Telegram Bot

Telegram bot service for FOODO customer flow.

## Features

- `POST /telegram/webhook` webhook endpoint
- Commands:
  - `/start` — greeting and quick help
  - `/menu` — show persistent quick-action keyboard
  - `/login` — step-by-step login (email + password)
  - `/catalog` — list products
  - `/add <product_id>` — add one item to cart
  - `/cart` — show current cart
  - `/checkout` — create order
  - `/orders` — list current user orders with statuses
- Command menu is registered via `setMyCommands`.
- `/catalog` also sends inline `➕ Add` buttons for quick cart actions.
- Live order status notifications via `orders-service` WebSocket (`/orders/ws`)

## Required env vars

- `TELEGRAM_BOT_TOKEN` — Bot token from BotFather

## Optional env vars

- `PORT` (default: `3006`)
- `TELEGRAM_WEBHOOK_URL` (example: `https://<your-domain-or-ngrok>`)
- `AUTH_API_URL` (default: `http://127.0.0.1:3001`)
- `WAREHOUSE_API_URL` (default: `http://127.0.0.1:3003`)
- `ORDERS_API_URL` (default: `http://127.0.0.1:3002`)

## Run locally

From repo root:

```bash
pnpm install
TELEGRAM_BOT_TOKEN=<your_bot_token> pnpm --filter @foodo/telegram-bot dev
```

Health check:

```bash
curl http://127.0.0.1:3006/health
```

## Configure Telegram webhook

If `TELEGRAM_WEBHOOK_URL` is set before startup, the service calls `setWebhook` automatically.

Manual setup alternative:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -d "url=https://<your-domain-or-ngrok>/telegram/webhook"
```

Get webhook info:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```

## Notes

- Cart/session state is in-memory per Telegram chat.
- After restart, user should run `/login` again to restore live status notifications.
