#!/usr/bin/env bash
set -euo pipefail

DOCKER_BIN="${FOODO_DOCKER_BIN:-}"
FALLBACK_WSL_DOCKER_BIN="/mnt/wsl/docker-desktop/cli-tools/usr/bin/docker"
FALLBACK_WINDOWS_DOCKER_EXE="/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe"

if [[ -z "${DOCKER_BIN}" ]]; then
  # In WSL, prefer Docker Desktop CLI path to avoid broken stub docker in PATH.
  if [[ -x "${FALLBACK_WSL_DOCKER_BIN}" ]]; then
    DOCKER_BIN="${FALLBACK_WSL_DOCKER_BIN}"
  elif [[ -x "${FALLBACK_WINDOWS_DOCKER_EXE}" ]]; then
    DOCKER_BIN="${FALLBACK_WINDOWS_DOCKER_EXE}"
  elif command -v docker >/dev/null 2>&1; then
    DOCKER_BIN="$(command -v docker)"
  else
    echo "[foodo] docker CLI is not available in PATH."
    echo "[foodo] Fix: enable Docker Desktop WSL integration or set FOODO_DOCKER_BIN."
    exit 1
  fi
fi

if ! "${DOCKER_BIN}" --version >/dev/null 2>&1; then
  echo "[foodo] docker CLI check failed for: ${DOCKER_BIN}"
  echo "[foodo] Set explicit path, for example:"
  echo "export FOODO_DOCKER_BIN=/mnt/wsl/docker-desktop/cli-tools/usr/bin/docker"
  exit 1
fi

if ! "${DOCKER_BIN}" compose version >/dev/null 2>&1; then
  echo "[foodo] docker compose is not available for: ${DOCKER_BIN}"
  echo "[foodo] Try Docker Desktop restart or use:"
  echo "export FOODO_DOCKER_BIN=\"/mnt/c/Program Files/Docker/Docker/resources/bin/docker.exe\""
  exit 1
fi

if ! "${DOCKER_BIN}" info >/dev/null 2>&1; then
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Start-Process 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'" >/dev/null 2>&1 || true
    echo "[foodo] Docker engine is not ready. Waiting for Docker Desktop..."
    for _ in $(seq 1 30); do
      if "${DOCKER_BIN}" info >/dev/null 2>&1; then
        break
      fi
      sleep 2
    done
  fi
fi

if ! "${DOCKER_BIN}" info >/dev/null 2>&1; then
  echo "[foodo] Docker engine is unavailable (daemon is not running)."
  echo "[foodo] Start Docker Desktop and wait until Engine is running, then retry."
  exit 1
fi

exec "${DOCKER_BIN}" compose "$@"
