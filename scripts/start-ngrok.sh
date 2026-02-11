#!/usr/bin/env bash
set -euo pipefail

if [[ "${FOODO_NGROK_AUTOSTART:-1}" != "1" ]]; then
  echo "[foodo] ngrok autostart disabled (FOODO_NGROK_AUTOSTART != 1)"
  exit 0
fi

if ! command -v ngrok >/dev/null 2>&1; then
  echo "[foodo] ngrok is not installed. Skipping tunnel startup."
  exit 0
fi

PORT="${FOODO_NGROK_PORT:-3008}"
API_URL="${FOODO_NGROK_API_URL:-http://127.0.0.1:4040/api/tunnels}"
LOG_FILE="${FOODO_NGROK_LOG_FILE:-/tmp/foodo-ngrok.log}"
PID_FILE="${FOODO_NGROK_PID_FILE:-/tmp/foodo-ngrok.pid}"

extract_url() {
  local response
  response="$(curl -fsS "${API_URL}" 2>/dev/null || true)"
  if [[ -z "${response}" ]]; then
    return 1
  fi

  local url
  url="$(
    printf "%s" "${response}" | node -e '
      let raw = "";
      process.stdin.on("data", (chunk) => (raw += chunk));
      process.stdin.on("end", () => {
        try {
          const data = JSON.parse(raw);
          const tunnels = Array.isArray(data.tunnels) ? data.tunnels : [];
          const wantedPort = process.argv[1];
          const tunnel = tunnels.find((item) => {
            if (!item || item.proto !== "https" || !item.public_url) return false;
            const addr = String(item?.config?.addr ?? "");
            return addr.includes(`:${wantedPort}`) || addr.endsWith(wantedPort);
          }) ?? tunnels.find((item) => item?.proto === "https" && item?.public_url);

          if (tunnel?.public_url) {
            process.stdout.write(String(tunnel.public_url));
          }
        } catch {
          // ignore
        }
      });
    ' "${PORT}"
  )"

  if [[ -z "${url}" ]]; then
    return 1
  fi

  printf "%s" "${url}"
}

existing_url="$(extract_url || true)"
if [[ -n "${existing_url}" ]]; then
  echo "[foodo] ngrok tunnel already active: ${existing_url}"
  exit 0
fi

if [[ -f "${PID_FILE}" ]]; then
  existing_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
    echo "[foodo] ngrok process already running with PID ${existing_pid}"
  else
    rm -f "${PID_FILE}"
  fi
fi

if [[ ! -f "${PID_FILE}" ]]; then
  nohup ngrok http "${PORT}" >"${LOG_FILE}" 2>&1 &
  echo "$!" >"${PID_FILE}"
  echo "[foodo] started ngrok for port ${PORT} (pid $(cat "${PID_FILE}"))"
fi

for _ in $(seq 1 20); do
  sleep 0.5
  tunnel_url="$(extract_url || true)"
  if [[ -n "${tunnel_url}" ]]; then
    echo "[foodo] ngrok public URL: ${tunnel_url}"
    exit 0
  fi
done

echo "[foodo] ngrok started but URL is not available yet. Check logs: ${LOG_FILE}"
