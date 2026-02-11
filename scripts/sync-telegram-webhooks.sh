#!/usr/bin/env bash
set -euo pipefail

if [[ "${FOODO_TELEGRAM_SYNC_WEBHOOKS:-1}" != "1" ]]; then
  echo "[foodo] Telegram webhook sync disabled (FOODO_TELEGRAM_SYNC_WEBHOOKS != 1)"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[foodo] curl is not installed. Skipping Telegram webhook sync."
  exit 0
fi

API_URL="${FOODO_NGROK_API_URL:-http://127.0.0.1:4040/api/tunnels}"
NGROK_WAIT_SECONDS="${FOODO_NGROK_WAIT_SECONDS:-45}"

get_ngrok_url() {
  local response
  response="$(curl -fsS "${API_URL}" 2>/dev/null || true)"
  if [[ -z "${response}" ]]; then
    return 1
  fi

  printf "%s" "${response}" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      try {
        const data = JSON.parse(raw);
        const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
        const tunnel = tunnels.find((item) => item?.proto === "https" && item?.public_url);
        if (tunnel?.public_url) process.stdout.write(String(tunnel.public_url));
      } catch {
        // ignore
      }
    });
  '
}

BASE_URL=""
for _ in $(seq 1 "${NGROK_WAIT_SECONDS}"); do
  BASE_URL="$(get_ngrok_url || true)"
  if [[ -n "${BASE_URL}" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "${BASE_URL}" ]]; then
  echo "[foodo] ngrok URL not found after ${NGROK_WAIT_SECONDS}s. Skipping Telegram webhook sync."
  exit 0
fi

set_hook() {
  local token="$1"
  local path="$2"
  local name="$3"
  if [[ -z "${token}" ]]; then
    echo "[foodo] ${name} token is empty. Skipping."
    return
  fi

  local url="${BASE_URL}${path}"
  local result
  result="$(curl -fsS "https://api.telegram.org/bot${token}/setWebhook?url=${url}" 2>/dev/null || true)"
  if [[ "${result}" == *"\"ok\":true"* ]]; then
    echo "[foodo] ${name} webhook -> ${url}"
  else
    echo "[foodo] failed to set ${name} webhook (${url})"
  fi
}

set_hook "${TELEGRAM_BOT_TOKEN:-}" "/telegram/customer/webhook" "customer bot"
set_hook "${COURIER_TELEGRAM_BOT_TOKEN:-}" "/telegram/courier/webhook" "courier bot"
set_hook "${ADMIN_TELEGRAM_BOT_TOKEN:-}" "/telegram/admin/webhook" "admin bot"
