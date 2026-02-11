#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

COMPOSE_FILE="${FOODO_COMPOSE_FILE:-docker-compose.yml}"

bash ./scripts/docker-compose.sh -f "${COMPOSE_FILE}" down --remove-orphans
bash ./scripts/cleanup-prod-containers.sh || true

if [[ "${FOODO_NGROK_AUTOSTART:-1}" == "1" ]]; then
  bash ./scripts/stop-ngrok.sh || true
fi
