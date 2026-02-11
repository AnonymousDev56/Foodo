# Release Checklist

This checklist is the release gate for FOODO production tags.

## 1. Pre-flight

- Confirm `main` is green in GitHub Actions.
- Confirm `pnpm typecheck` passes locally.
- Confirm `pnpm smoke:critical` passes locally.
- Confirm no uncommitted changes:
  - `git status` is clean.
- Confirm release version and tag target:
  - example: `v0.9.0`.
- Update `CHANGELOG.md`:
  - move relevant items from `Unreleased` into release section.
  - add release date.

## 2. Production stack sanity

- Run:
  - `pnpm stop:prod`
  - `pnpm start:prod`
- Validate health:
  - `pnpm health`
- Validate key URLs:
  - customer `http://127.0.0.1:5173`
  - courier `http://127.0.0.1:5174`
  - admin `http://127.0.0.1:5175`
  - gateway `http://127.0.0.1:8080/health`

## 3. Release execution

- Create annotated tag via helper:
  - `pnpm release:tag -- v0.9.0`
- Push branch and tag:
  - `git push origin main`
  - `git push origin v0.9.0`
- Open GitHub Release for the tag.
- Paste release notes from `.github/RELEASE_TEMPLATE.md`.

## 4. Post-release checks

- Re-run smoke check on tag commit if needed.
- Verify Docker image build pipeline status.
- Verify bot webhooks still active if ngrok is used in local demo mode.
- Announce release with:
  - version
  - key changes
  - known limitations

## 5. Rollback quick path

If regression is found:

- Identify last stable tag (example: `v0.9.0`).
- Re-deploy previous tag artifacts.
- Re-open hotfix branch from stable tag.
- Prepare patch release (`v0.9.1`).

