#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="${FOODO_COMPOSE_FILE:-docker-compose.yml}"

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
  echo "[foodo] Loaded .env.local"
fi

# Clean stale fixed-name containers left from previous failed runs or other compose contexts.
bash ./scripts/cleanup-prod-containers.sh || true

# Build shared monorepo image once to avoid race/conflict when multiple services reuse same tag.
bash ./scripts/docker-compose.sh -f "${COMPOSE_FILE}" build image-builder
bash ./scripts/docker-compose.sh -f "${COMPOSE_FILE}" up -d --remove-orphans

if [[ "${FOODO_NGROK_AUTOSTART:-1}" == "1" ]]; then
  bash ./scripts/start-ngrok.sh || echo "[foodo] ngrok startup failed (continuing without public tunnel)"
fi

if [[ "${FOODO_TELEGRAM_SYNC_WEBHOOKS:-1}" == "1" ]]; then
  bash ./scripts/sync-telegram-webhooks.sh || echo "[foodo] webhook sync failed (continuing)"
fi

echo "[foodo] Stack is starting. Current status:"
bash ./scripts/docker-compose.sh -f "${COMPOSE_FILE}" ps

echo
echo "[foodo] Frontend URLs:"
echo "customer: http://127.0.0.1:5173"
echo "courier:  http://127.0.0.1:5174"
echo "admin:    http://127.0.0.1:5175"
echo
echo "[foodo] API gateway:"
echo "http://127.0.0.1:8080"
echo
echo "[foodo] Run health check:"
echo "pnpm health"
