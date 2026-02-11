#!/usr/bin/env bash
set -euo pipefail

DOCKER_BIN="${FOODO_DOCKER_BIN:-}"
FALLBACK_WSL_DOCKER_BIN="/mnt/wsl/docker-desktop/cli-tools/usr/bin/docker"
FALLBACK_WINDOWS_DOCKER_EXE="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"

if [[ -z "${DOCKER_BIN}" ]]; then
  if [[ -x "${FALLBACK_WSL_DOCKER_BIN}" ]]; then
    DOCKER_BIN="${FALLBACK_WSL_DOCKER_BIN}"
  elif [[ -x "${FALLBACK_WINDOWS_DOCKER_EXE}" ]]; then
    DOCKER_BIN="${FALLBACK_WINDOWS_DOCKER_EXE}"
  elif command -v docker >/dev/null 2>&1; then
    DOCKER_BIN="$(command -v docker)"
  else
    echo "[foodo] docker CLI is not available for stale container cleanup."
    exit 0
  fi
fi

containers=(
  "foodo-postgres"
  "foodo-redis"
  "foodo-rabbitmq"
  "foodo-db-init"
  "foodo-auth-service"
  "foodo-orders-service"
  "foodo-warehouse-service"
  "foodo-delivery-service"
  "foodo-notification-service"
  "foodo-telegram-bot"
  "foodo-tg-courier-bot"
  "foodo-tg-admin-bot"
  "foodo-telegram-router"
  "foodo-web-customer"
  "foodo-web-courier"
  "foodo-web-admin"
  "foodo-nginx-gateway"
)

for name in "${containers[@]}"; do
  "${DOCKER_BIN}" rm -f "${name}" >/dev/null 2>&1 || true
done
