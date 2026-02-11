# FOODO Telegram Router

Path-based webhook router for running customer and courier Telegram bots behind one public URL.

## Routes

- `POST /telegram/customer/webhook` -> forwards to customer bot (`3006`)
- `POST /telegram/courier/webhook` -> forwards to courier bot (`3007`)
- `POST /telegram/admin/webhook` -> forwards to admin bot (`3009`)
- `GET /health`

## Env vars

- `PORT` (default: `3008`)
- `CUSTOMER_WEBHOOK_TARGET` (default: `http://127.0.0.1:3006/telegram/webhook`)
- `COURIER_WEBHOOK_TARGET` (default: `http://127.0.0.1:3007/telegram/webhook`)
- `ADMIN_WEBHOOK_TARGET` (default: `http://127.0.0.1:3009/telegram/webhook`)

## Run

```bash
pnpm --filter @foodo/telegram-router dev
```

Then expose one tunnel:

```bash
ngrok http 3008
```

Set webhooks:

```bash
curl -sS "https://api.telegram.org/bot<CUSTOMER_TOKEN>/setWebhook?url=<NGROK_URL>/telegram/customer/webhook"
curl -sS "https://api.telegram.org/bot<COURIER_TOKEN>/setWebhook?url=<NGROK_URL>/telegram/courier/webhook"
curl -sS "https://api.telegram.org/bot<ADMIN_TOKEN>/setWebhook?url=<NGROK_URL>/telegram/admin/webhook"
```
