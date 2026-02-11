## FOODO Release {{VERSION}}

### Summary
- Release type: `minor|patch|hotfix`
- Date: `YYYY-MM-DD`
- Tag: `vX.Y.Z`

### Highlights
- 
- 
- 

### Services impacted
- auth-service
- orders-service
- warehouse-service
- delivery-service
- notification-service
- telegram-bot / tg-courier-bot / tg-admin-bot / telegram-router
- web-customer / web-courier / web-admin

### Infra / Ops notes
- 
- 

### Migration notes
- DB migration required: `yes|no`
- Backward compatible: `yes|no`
- Rollback plan: `link to docs/release/checklist.md`

### Verification performed
- [ ] `pnpm typecheck`
- [ ] `pnpm smoke:critical`
- [ ] `pnpm start:prod` + `pnpm health`
- [ ] Manual UI sanity (customer/courier/admin)

### Known issues
- 

