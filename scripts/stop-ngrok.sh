#!/usr/bin/env bash
set -euo pipefail

PID_FILE="${FOODO_NGROK_PID_FILE:-/tmp/foodo-ngrok.pid}"

if [[ -f "${PID_FILE}" ]]; then
  pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    sleep 0.2
    if kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
    echo "[foodo] stopped ngrok pid ${pid}"
  fi
  rm -f "${PID_FILE}"
fi

pkill -f "ngrok http" 2>/dev/null || true
echo "[foodo] ngrok stop requested"
