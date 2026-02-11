# GitHub Actions

Main workflow: `.github/workflows/ci.yml`

CI runs on every push and pull request:

1. `Typecheck and Build`
- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build`

2. `Smoke Critical Flow`
- starts full production stack with `pnpm start:prod`
- disables ngrok/webhook sync in CI (`FOODO_NGROK_AUTOSTART=0`, `FOODO_TELEGRAM_SYNC_WEBHOOKS=0`)
- waits for API health endpoints
- runs `pnpm smoke:critical`
- always runs `pnpm stop:prod` for cleanup
