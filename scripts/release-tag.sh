#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  pnpm release:tag -- vX.Y.Z
  pnpm release:tag -- vX.Y.Z "optional tag message"

Rules:
  - Tag must match semantic version format: vMAJOR.MINOR.PATCH
  - Working tree must be clean
  - Tag must not already exist
EOF
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

VERSION="${1:-}"
MESSAGE="${2:-}"

if [[ -z "${VERSION}" ]]; then
  echo "[release] Missing version tag."
  usage
  exit 1
fi

if [[ ! "${VERSION}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "[release] Invalid version tag: ${VERSION}"
  echo "[release] Expected format: vMAJOR.MINOR.PATCH (example: v0.9.0)"
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[release] Not inside a git repository."
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[release] Working tree is not clean. Commit or stash changes first."
  git status --short
  exit 1
fi

if git rev-parse -q --verify "refs/tags/${VERSION}" >/dev/null; then
  echo "[release] Tag already exists: ${VERSION}"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${BRANCH}" != "main" ]]; then
  echo "[release] Warning: creating release tag from branch '${BRANCH}', not 'main'."
fi

if [[ -z "${MESSAGE}" ]]; then
  MESSAGE="FOODO release ${VERSION}"
fi

git tag -a "${VERSION}" -m "${MESSAGE}"

echo "[release] Tag created: ${VERSION}"
echo "[release] Next commands:"
echo "  git push origin ${BRANCH}"
echo "  git push origin ${VERSION}"
