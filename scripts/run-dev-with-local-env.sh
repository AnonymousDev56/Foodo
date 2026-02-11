#!/usr/bin/env bash
set -euo pipefail

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
  echo "[foodo] Loaded .env.local"
else
  echo "[foodo] .env.local not found (telegram bots may be disabled)"
fi

bash ./scripts/start-ngrok.sh || echo "[foodo] ngrok startup failed (continuing without ngrok)"
bash ./scripts/sync-telegram-webhooks.sh || echo "[foodo] webhook sync failed (continuing without webhook update)"

pnpm -r --parallel --stream \
  --filter @foodo/auth-service \
  --filter @foodo/orders-service \
  --filter @foodo/warehouse-service \
  --filter @foodo/delivery-service \
  --filter @foodo/notification-service \
  --filter @foodo/telegram-bot \
  --filter @foodo/tg-courier-bot \
  --filter @foodo/tg-admin-bot \
  --filter @foodo/telegram-router \
  --filter @foodo/web-customer \
  --filter @foodo/web-courier \
  --filter @foodo/web-admin \
  run dev
