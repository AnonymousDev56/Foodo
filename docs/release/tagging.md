# Tagging and Release Flow

FOODO uses semantic version tags:

- `vMAJOR.MINOR.PATCH`
- Example: `v0.9.0`

## Local release flow

1. Ensure clean working tree:

```bash
git status
```

2. Run release gate checks:

```bash
pnpm release:check
```

3. Create annotated tag:

```bash
pnpm release:tag -- v0.9.0
```

4. Push branch and tag:

```bash
git push origin main
git push origin v0.9.0
```

5. Create GitHub Release from tag:

- Use `.github/RELEASE_TEMPLATE.md`.

## Notes

- `release:tag` refuses to run if:
  - tree is dirty
  - tag format is invalid
  - tag already exists
- This prevents accidental or duplicate releases.

