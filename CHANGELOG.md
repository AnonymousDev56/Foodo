# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project uses Semantic Versioning.

## [Unreleased]

### Added
- Release process docs (`docs/release/*`) and release tagging helper script.

## [0.9.0] - 2026-02-11

### Added
- Production autostart flow (`pnpm start:prod`) for full FOODO stack.
- Dockerized microservices and web apps with health checks.
- PostgreSQL persistence with migration and seed bootstrap.
- Critical smoke test flow (`pnpm smoke:critical`) for end-to-end validation.
- Real-time admin dashboard metrics and live update channels.
- Courier route optimization with ETA confidence and route breakdown.
- Telegram bot integration:
  - customer bot
  - courier bot
  - admin bot
  - webhook router service

### Changed
- CI workflow stabilized with dedicated typecheck/build and smoke jobs.
- WSL/Docker helper scripts improved for robust startup and teardown.
- Warehouse admin UX improved with immediate filter refresh behavior.

### Fixed
- CI and runtime instability around `orders-service` startup in containerized runs.
- Docker startup race conditions and intermittent service readiness issues.

